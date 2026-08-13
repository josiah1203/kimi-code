/**
 * Governed SSH transport for customer-owned SpiderByte daemons.
 *
 * This module deliberately exposes semantic daemon calls only. The remote
 * command is a fixed SpiderByte daemon entrypoint and the request is a
 * bounded JSON frame; no model-facing API exposes SSHKaos.exec(), a command
 * string, or an arbitrary shell.
 */

import { timingSafeEqual } from 'node:crypto';
import { posix as posixPath } from 'node:path';
import { z } from 'zod';

import type { KaosProcess } from '@spiderbyte/kaos';
import { SSHKaos } from '@spiderbyte/kaos/ssh';
import {
  executionTargetSshConfigSchema,
  executionTargetTestResultSchema,
  type ExecutionTarget,
  type ExecutionTargetAuthenticationMethod,
  type ExecutionTargetSshConfig,
  type ExecutionTargetTestResult,
} from '@spiderbyte/protocol';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { IPlatformSecretStore } from '#/app/secrets/platformSecretStore';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';

import type { WorkspaceExecutionRequest } from './execution';
import {
  platformWorkerResponseSchema,
  type PlatformWorkerResponse,
} from './platformWorker';

import {
  MAX_SSH_DAEMON_FRAME_BYTES,
  SSH_DAEMON_COMMAND,
  SSH_DAEMON_ENV_KEYS,
  SSH_DAEMON_PROTOCOL_VERSION,
  sshDaemonExecuteRequestSchema as executeRequestSchema,
  sshDaemonExecuteResponseSchema as executeResponseSchema,
  sshDaemonProbeRequestSchema as probeRequestSchema,
  sshDaemonProbeResponseSchema as probeResponseSchema,
  sshDaemonResponseSchema,
  type SshDaemonOperation,
  type SshDaemonProbeResponse as ProbeResponse,
  type SshDaemonExecuteResponse as ExecuteResponse,
} from './sshDaemonProtocol';

export interface SshDaemonProbeOptions {
  readonly requestId: string;
  readonly timeoutMs: number;
}

export interface IWorkspaceSshDaemonService {
  readonly _serviceBrand: undefined;
  probe(target: ExecutionTarget, workspaceId: string, options: SshDaemonProbeOptions): Promise<ExecutionTargetTestResult>;
  execute(
    target: ExecutionTarget,
    workspaceId: string,
    input: WorkspaceExecutionRequest,
    signal: AbortSignal,
  ): Promise<PlatformWorkerResponse>;
}

export const IWorkspaceSshDaemonService: ServiceIdentifier<IWorkspaceSshDaemonService> =
  createDecorator<IWorkspaceSshDaemonService>('workspaceSshDaemonService');

export function parseSshTargetConfiguration(target: ExecutionTarget): ExecutionTargetSshConfig {
  if (target.type !== 'ssh') {
    throw new Error('execution target is not an SSH target');
  }
  return validateSshTargetConfiguration({
    endpoint: target.endpoint,
    ssh: target.ssh,
    authenticationMethod: target.authentication_method,
    credentialRef: target.credential_ref,
  });
}

export function validateSshTargetConfiguration(input: {
  readonly endpoint?: string;
  readonly ssh: unknown;
  readonly authenticationMethod?: ExecutionTargetAuthenticationMethod;
  readonly credentialRef?: string;
}): ExecutionTargetSshConfig {
  const parsed = executionTargetSshConfigSchema.safeParse(input.ssh);
  if (!parsed.success) {
    throw new Error('SSH target configuration is incomplete or invalid');
  }
  const config = parsed.data;
  const normalizedRoot = posixPath.normalize(config.remote_root);
  if (config.host_key_fingerprint.length !== fingerprintLength(config.host_key_hash)) {
    throw new Error(`SSH host-key fingerprint length does not match ${config.host_key_hash}`);
  }
  if (normalizedRoot.split('/').includes('..')) {
    throw new Error('SSH remote_root must not contain parent-directory segments');
  }
  if (normalizedRoot === '/') {
    throw new Error('SSH remote_root must not be the filesystem root');
  }
  if (input.authenticationMethod !== 'ssh_key' && input.authenticationMethod !== 'ssh_agent') {
    throw new Error('SSH targets must use ssh_key or ssh_agent authentication');
  }
  if (input.authenticationMethod === 'ssh_key' && input.credentialRef === undefined) {
    throw new Error('SSH key authentication requires an opaque credential_ref');
  }
  if (input.authenticationMethod === 'ssh_agent' && input.credentialRef !== undefined) {
    throw new Error('SSH agent authentication must not carry a private-key credential_ref');
  }
  if (input.endpoint !== undefined) {
    let endpoint: URL;
    try {
      endpoint = new URL(input.endpoint);
    } catch {
      throw new Error('SSH endpoint must be a valid URL');
    }
    if (endpoint.protocol !== 'ssh:' || endpoint.hostname.toLowerCase() !== config.host.toLowerCase()) {
      throw new Error('SSH endpoint must match the explicit SSH host configuration');
    }
    if ((endpoint.port === '' ? 22 : Number(endpoint.port)) !== config.port) {
      throw new Error('SSH endpoint port must match the explicit SSH port configuration');
    }
  }
  return { ...config, remote_root: normalizedRoot };
}

export function confineSshPath(root: string, candidate: string): string {
  if (/[\u0000-\u001F\u007F]/.test(root) || /[\u0000-\u001F\u007F]/.test(candidate)) {
    throw new Error('SSH path contains control characters');
  }
  const normalizedRoot = posixPath.normalize(root);
  if (!normalizedRoot.startsWith('/') || normalizedRoot.split('/').includes('..')) {
    throw new Error('SSH remote root is not confined');
  }
  const resolved = posixPath.resolve(normalizedRoot, candidate);
  const relative = posixPath.relative(normalizedRoot, resolved);
  if (relative === '..' || relative.startsWith('../') || posixPath.isAbsolute(relative)) {
    throw new Error('SSH path escapes the configured remote root');
  }
  return resolved;
}

export function assertSshPayloadSafe(
  payload: Readonly<Record<string, unknown>>,
  workspaceId: string,
  remoteRoot: string,
): void {
  const seen = new WeakSet<object>();
  visitSshPayload(payload, 'payload', workspaceId, remoteRoot, seen);
}

class WorkspaceSshDaemonService extends Disposable implements IWorkspaceSshDaemonService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IPlatformSecretStore private readonly secrets: IPlatformSecretStore,
    @IWorkspaceArtifactService private readonly artifacts: IWorkspaceArtifactService,
  ) {
    super();
  }

  async probe(
    target: ExecutionTarget,
    workspaceId: string,
    options: SshDaemonProbeOptions,
  ): Promise<ExecutionTargetTestResult> {
    const checkedAt = new Date().toISOString();
    try {
      if (target.workspace_id !== workspaceId) {
        throw new Error('execution target is not authorized for this workspace');
      }
      const config = parseSshTargetConfiguration(target);
      const response = await this.runFrame<ProbeResponse>(
        target,
        config,
        workspaceId,
        probeRequestSchema.parse({
          kind: 'probe',
          protocol_version: SSH_DAEMON_PROTOCOL_VERSION,
          request_id: options.requestId,
          workspace_id: workspaceId,
          target_id: target.id,
          workspace_root: config.remote_root,
        }),
        options.timeoutMs,
        undefined,
        probeResponseSchema,
      );
      const compatibility = versionCompatibility(target, response.protocol_version);
      const healthy = response.status !== 'unhealthy' && compatibility.compatible === true;
      return executionTargetTestResultSchema.parse({
        target_id: target.id,
        workspace_id: workspaceId,
        status: healthy ? 'healthy' : 'unhealthy',
        checked_at: checkedAt,
        message: healthy ? `SpiderByte SSH daemon ${response.daemon_version} is ready` : compatibility.message,
        capabilities: response.capabilities,
        available_models: response.available_models,
        available_providers: response.available_providers,
        resources: response.resources,
        version_compatibility: compatibility,
      });
    } catch (error) {
      return executionTargetTestResultSchema.parse({
        target_id: target.id,
        workspace_id: workspaceId,
        status: 'unavailable',
        checked_at: checkedAt,
        message: safeSshErrorMessage(error),
      });
    }
  }

  async execute(
    target: ExecutionTarget,
    workspaceId: string,
    input: WorkspaceExecutionRequest,
    signal: AbortSignal,
  ): Promise<PlatformWorkerResponse> {
    if (target.workspace_id !== workspaceId) {
      throw new Error('execution target is not authorized for this workspace');
    }
    const config = parseSshTargetConfiguration(target);
    assertSshPayloadSafe(input.payload, workspaceId, config.remote_root);
    const payload = await this.materializeInputArtifacts(input.payload, workspaceId);
    assertSshPayloadSafe(payload, workspaceId, config.remote_root);
    const frame = executeRequestSchema.parse({
      kind: 'execute',
      protocol_version: SSH_DAEMON_PROTOCOL_VERSION,
      request_id: input.request_id,
      run_id: input.run_id,
      attempt_id: input.attempt_id,
      project_id: input.project_id,
      workspace_id: workspaceId,
      target_id: target.id,
      workspace_root: config.remote_root,
      lease_id: input.lease_id,
      operation: semanticOperation(input.operation),
      payload,
      policy_decision_id: input.policy_decision_id,
      policy_decision_ids: input.policy_decision_ids,
      approval_ids: input.approval_ids,
      artifact_ids: input.artifact_ids,
      provider: input.provider,
      model: input.model,
      user_id: input.user_id,
    });
    if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > MAX_SSH_DAEMON_FRAME_BYTES) {
      throw new Error('SSH daemon request is too large');
    }
    const response = await this.runFrame<ExecuteResponse>(
      target,
      config,
      workspaceId,
      frame,
      config.command_timeout_ms,
      signal,
      executeResponseSchema,
    );
    if (response.protocol_version !== SSH_DAEMON_PROTOCOL_VERSION) {
      throw new Error('SSH daemon protocol version is incompatible');
    }
    if (response.workspace_id !== workspaceId || response.target_id !== target.id) {
      throw new Error('SSH daemon returned a response for another workspace or target');
    }
    return platformWorkerResponseSchema.parse(response.response);
  }

  private async runFrame<T>(
    target: ExecutionTarget,
    config: ExecutionTargetSshConfig,
    workspaceId: string,
    frame: object,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let ssh: SSHKaos;
    try {
      ssh = await SSHKaos.create(await this.sshOptions(target, config));
    } catch {
      throw new Error('SSH daemon connection failed');
    }
    let process: KaosProcess | undefined;
    try {
      process = await ssh.execWithEnv([...SSH_DAEMON_COMMAND], buildSshDaemonEnvironment(workspaceId));
      process.stdin.end(`${JSON.stringify(frame)}\n`);
      const stdout = readLimited(process.stdout, MAX_SSH_DAEMON_FRAME_BYTES);
      const stderr = readLimited(process.stderr, 64 * 1024);
      const exit = process.wait();
      const [rawStdout, _rawStderr, exitCode] = await raceWithTimeout(
        Promise.all([stdout, stderr, exit]),
        timeoutMs,
        signal,
        async () => {
          await process?.kill('SIGTERM').catch(() => {});
          process?.dispose();
        },
      );
      if (exitCode !== 0) {
        throw new Error('remote SpiderByte daemon exited unsuccessfully');
      }
      const lines = rawStdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      if (lines.length !== 1) throw new Error('remote SpiderByte daemon returned malformed output');
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[0]!);
      } catch {
        throw new Error('remote SpiderByte daemon returned invalid JSON');
      }
      const daemonResponse = sshDaemonResponseSchema.parse(parsed);
      if (daemonResponse.kind === 'error') throw new Error(daemonResponse.error);
      return schema.parse(daemonResponse);
    } finally {
      process?.dispose();
      await ssh.close().catch(() => {});
    }
  }

  private async sshOptions(
    target: ExecutionTarget,
    config: ExecutionTargetSshConfig,
  ): Promise<Parameters<typeof SSHKaos.create>[0]> {
    const authentication = target.authentication_method;
    const privateKey = authentication === 'ssh_key' && target.credential_ref !== undefined
      ? await this.secrets.get(target.credential_ref)
      : undefined;
    if (authentication === 'ssh_key' && privateKey === undefined) {
      throw new Error('SSH private-key credential is unavailable');
    }
    if (authentication === 'ssh_agent' && (config.agent_socket ?? process.env['SSH_AUTH_SOCK']) === undefined) {
      throw new Error('SSH agent authentication requires an SSH_AUTH_SOCK or explicit agent_socket');
    }
    const fingerprint = config.host_key_fingerprint.toLowerCase();
    return {
      host: config.host,
      port: config.port,
      username: config.user,
      keyContents: privateKey === undefined ? undefined : [privateKey],
      cwd: config.remote_root,
      hostHash: config.host_key_hash,
      hostKeyVerifier: (observed: string) => verifySshHostFingerprint(observed, fingerprint, config.host_key_hash),
      extraOptions: {
        agent: authentication === 'ssh_agent'
          ? config.agent_socket ?? process.env['SSH_AUTH_SOCK']
          : undefined,
        readyTimeout: config.connection_timeout_ms,
      },
    };
  }

  private async materializeInputArtifacts(
    payload: Readonly<Record<string, unknown>>,
    workspaceId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const ids = [...new Set(collectArtifactIds(payload))];
    if (ids.length === 0) return payload;
    const inputArtifacts: Array<{
      readonly artifact_id: string;
      readonly name: string;
      readonly kind: string;
      readonly media_type?: string;
      readonly content_base64: string;
    }> = [];
    let totalBytes = 0;
    for (const id of ids) {
      const artifact = await this.artifacts.get(id);
      const download = await this.artifacts.download(id);
      if (artifact === undefined || artifact.workspace_id !== workspaceId || download === undefined) {
        throw new Error('SSH execution payload references an unavailable workspace artifact');
      }
      const bytes = Buffer.from(download.content_base64, 'base64').byteLength;
      totalBytes += bytes;
      if (totalBytes > MAX_SSH_DAEMON_FRAME_BYTES) {
        throw new Error('SSH daemon input artifacts exceed the maximum transfer size');
      }
      inputArtifacts.push({
        artifact_id: artifact.id,
        name: artifact.name,
        kind: artifact.kind,
        media_type: artifact.media_type,
        content_base64: download.content_base64,
      });
    }
    return { ...payload, input_artifacts: inputArtifacts };
  }
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceSshDaemonService,
  WorkspaceSshDaemonService,
  ScopeActivation.OnDemand,
  'sshDaemon',
);

function fingerprintLength(hash: ExecutionTargetSshConfig['host_key_hash']): number {
  return hash === 'md5' ? 32 : hash === 'sha256' ? 64 : 128;
}

export function verifySshHostFingerprint(
  observed: string,
  expected: string,
  hash: ExecutionTargetSshConfig['host_key_hash'],
): boolean {
  if (!/^[a-f0-9]+$/i.test(observed) || observed.length !== fingerprintLength(hash) || observed.length !== expected.length) return false;
  const left = Buffer.from(observed.toLowerCase(), 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return timingSafeEqual(left, right);
}

function versionCompatibility(
  target: ExecutionTarget,
  observed: number,
): { readonly required_protocol_version?: number; readonly observed_protocol_version: number; readonly compatible: boolean; readonly message: string } {
  const required = target.version_compatibility?.required_protocol_version;
  const compatible = required === undefined || required === observed;
  return {
    required_protocol_version: required,
    observed_protocol_version: observed,
    compatible,
    message: compatible ? 'SSH daemon protocol version is compatible' : `expected protocol version ${required}`,
  };
}

export function sshDaemonVersionCompatibility(
  target: ExecutionTarget,
  observed: number,
): ReturnType<typeof versionCompatibility> {
  return versionCompatibility(target, observed);
}

export function buildSshDaemonEnvironment(workspaceId: string): Record<string, string> {
  const environment = {
    SPIDERBYTE_PROTOCOL_VERSION: String(SSH_DAEMON_PROTOCOL_VERSION),
    SPIDERBYTE_WORKSPACE_ID: workspaceId,
  };
  if (Object.keys(environment).some((key) => !SSH_DAEMON_ENV_KEYS.includes(key as typeof SSH_DAEMON_ENV_KEYS[number]))) {
    throw new Error('SSH daemon environment contains an unsupported variable');
  }
  return environment;
}

function semanticOperation(operation: WorkspaceExecutionRequest['operation']): SshDaemonOperation {
  switch (operation) {
    case 'analysis':
      return 'execute_analysis';
    case 'training':
      return 'train_model';
    case 'evaluation':
    case 'comparison':
      return 'inspect_run';
    case 'serving':
      return 'retrieve_artifact';
  }
}

function visitSshPayload(
  value: unknown,
  path: string,
  workspaceId: string,
  remoteRoot: string,
  seen: WeakSet<object>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSshPayload(item, `${path}[${index}]`, workspaceId, remoteRoot, seen));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'workspace_id' && typeof nested === 'string' && nested !== workspaceId) {
      throw new Error('SSH request workspace does not match the authorized workspace');
    }
    if (isPathField(key) && typeof nested === 'string') {
      confineSshPath(remoteRoot, nested);
    }
    visitSshPayload(nested, `${path}.${key}`, workspaceId, remoteRoot, seen);
  }
}

function collectArtifactIds(
  value: unknown,
  output: string[] = [],
  key?: string,
  seen = new WeakSet<object>(),
): string[] {
  if (key?.endsWith('_artifact_id') && typeof value === 'string') output.push(value);
  if (key?.endsWith('_artifact_ids') && Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string') output.push(item);
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return output;
    seen.add(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactIds(item, output, undefined, seen);
  } else if (value !== null && typeof value === 'object') {
    for (const [nestedKey, nested] of Object.entries(value)) {
      collectArtifactIds(nested, output, nestedKey, seen);
    }
  }
  return output;
}

function isPathField(key: string): boolean {
  return /(?:^|_)(?:path|cwd|directory|root)$/i.test(key) || /(?:^|_)(?:path|cwd|directory|root)_/i.test(key);
}

async function readLimited(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('remote SpiderByte daemon output is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function raceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    abortListener = () => {
      void onAbort();
      reject(new Error('SSH daemon command was cancelled'));
    };
    if (signal?.aborted === true) abortListener();
    else signal?.addEventListener('abort', abortListener, { once: true });
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onAbort();
      reject(new Error('SSH daemon command timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, abort, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener);
  }
}

function safeSshErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/timed out/i.test(error.message)) return 'SSH daemon command timed out';
    if (/cancelled/i.test(error.message)) return 'SSH daemon command was cancelled';
    if (/path escapes|workspace|configuration|fingerprint|authentication|endpoint|root/i.test(error.message)) {
      return error.message.slice(0, 500);
    }
  }
  return 'SSH daemon connection failed';
}

export { SSH_DAEMON_COMMAND, SSH_DAEMON_ENV_KEYS, SSH_DAEMON_PROTOCOL_VERSION };
