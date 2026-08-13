/** Customer-owned stdio daemon for the governed SSH execution transport. */

import {
  assertSshDaemonExecutionContext,
  isConfinedSshDaemonRoot,
  MAX_SSH_DAEMON_FRAME_BYTES,
  sshDaemonExecuteResponseSchema,
  sshDaemonOperationToWorkerOperation,
  sshDaemonProbeResponseSchema,
  sshDaemonRequestSchema,
  SSH_DAEMON_PROTOCOL_VERSION,
  type SshDaemonExecuteRequest,
  type SshDaemonOperation,
  type SshDaemonRequest,
} from './sshDaemonProtocol';
import {
  createBuiltinMlWorkerExecutor,
  createPlatformWorkerState,
  executePlatformWorkerRequest,
  platformWorkerResponseSchema,
  type PlatformWorkerExecutor,
  type PlatformWorkerRequest,
} from './platformWorker';

const DEFAULT_DAEMON_VERSION = '0.3.1';
const DEFAULT_CAPABILITIES: readonly SshDaemonOperation[] = [
  'execute_analysis',
  'profile_dataset',
  'train_model',
];

export interface SshDaemonStdioOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly currentWorkingDirectory?: string;
  readonly daemonVersion?: string;
  readonly workerId?: string;
  readonly capabilities?: readonly SshDaemonOperation[];
  readonly executor?: PlatformWorkerExecutor;
}

/**
 * Consume exactly one bounded JSON request from stdin and emit exactly one
 * JSON response. The CLI wrapper owns process lifecycle and reports no
 * protocol diagnostics on stdout.
 */
export async function runSshDaemonStdio(options: SshDaemonStdioOptions = {}): Promise<void> {
  const environment = options.environment ?? process.env;
  const daemonVersion = options.daemonVersion ?? environment['SPIDERBYTE_DAEMON_VERSION'] ?? DEFAULT_DAEMON_VERSION;
  const output = options.output ?? process.stdout;
  let request: SshDaemonRequest | undefined;
  try {
    const raw = await readSingleFrame(options.input ?? process.stdin);
    request = sshDaemonRequestSchema.parse(JSON.parse(raw));
    const workspaceId = environment['SPIDERBYTE_WORKSPACE_ID'];
    if (workspaceId === undefined || workspaceId.length === 0) {
      throw new Error('SSH daemon workspace identity is missing');
    }
    if (environment['SPIDERBYTE_PROTOCOL_VERSION'] !== String(SSH_DAEMON_PROTOCOL_VERSION)) {
      throw new Error('SSH daemon environment protocol version is incompatible');
    }
    const currentWorkingDirectory = options.currentWorkingDirectory ?? process.cwd();
    if (!isConfinedSshDaemonRoot(request.workspace_root)) {
      throw new Error('SSH daemon workspace root is not confined');
    }
    assertSshDaemonExecutionContext(request, {
      workspaceId,
      workspaceRoot: request.workspace_root,
      targetId: request.target_id,
    }, currentWorkingDirectory);

    const capabilities = effectiveCapabilities(options.capabilities);
    const response = request.kind === 'probe'
      ? sshDaemonProbeResponseSchema.parse({
        kind: 'probe_result',
        daemon: 'spiderbyte',
        daemon_version: daemonVersion,
        protocol_version: SSH_DAEMON_PROTOCOL_VERSION,
        workspace_id: workspaceId,
        target_id: request.target_id,
        status: 'ready',
        capabilities,
      })
      : await executeSshDaemonRequest(request, workspaceId, daemonVersion, capabilities, options);
    writeFrame(output, response);
  } catch (error) {
    writeFrame(output, {
      kind: 'error',
      daemon: 'spiderbyte',
      daemon_version: daemonVersion,
      protocol_version: SSH_DAEMON_PROTOCOL_VERSION,
      error: safeDaemonError(error),
    });
  }
}

async function executeSshDaemonRequest(
  request: SshDaemonExecuteRequest,
  workspaceId: string,
  daemonVersion: string,
  capabilities: readonly SshDaemonOperation[],
  options: SshDaemonStdioOptions,
): Promise<unknown> {
  const workerOperation = sshDaemonOperationToWorkerOperation(request.operation);
  if (workerOperation === undefined || !capabilities.includes(request.operation)) {
    return sshDaemonExecuteResponseSchema.parse({
      kind: 'execute_result',
      daemon: 'spiderbyte',
      daemon_version: daemonVersion,
      protocol_version: SSH_DAEMON_PROTOCOL_VERSION,
      workspace_id: workspaceId,
      target_id: request.target_id,
      response: {
        status: 'failed',
        output_artifacts: [],
        error: `SSH daemon does not advertise '${request.operation}' capability`,
      },
    });
  }
  const workerRequest: PlatformWorkerRequest = {
    protocol_version: 1,
    workspace_id: workspaceId,
    run_id: request.run_id,
    attempt_id: request.attempt_id,
    project_id: request.project_id,
    request_id: request.request_id,
    target_id: request.target_id,
    lease_id: request.lease_id,
    operation: workerOperation,
    payload: request.payload,
    policy_decision_id: request.policy_decision_id,
    policy_decision_ids: request.policy_decision_ids,
    approval_ids: request.approval_ids,
    artifact_ids: request.artifact_ids,
    provider: request.provider,
    model: request.model,
    user_id: request.user_id,
  };
  const workerCapabilities = [...new Set(capabilities
    .map(sshDaemonOperationToWorkerOperation)
    .filter((operation): operation is NonNullable<typeof operation> => operation !== undefined))];
  const workerResponse = await executePlatformWorkerRequest({
    workerId: options.workerId ?? 'ssh-daemon',
    capabilities: workerCapabilities,
    token: 'stdio-boundary',
    executor: options.executor ?? createBuiltinMlWorkerExecutor(options.workerId ?? 'ssh-daemon'),
  }, workerRequest, createPlatformWorkerState());
  return sshDaemonExecuteResponseSchema.parse({
    kind: 'execute_result',
    daemon: 'spiderbyte',
    daemon_version: daemonVersion,
    protocol_version: SSH_DAEMON_PROTOCOL_VERSION,
    workspace_id: workspaceId,
    target_id: request.target_id,
    response: platformWorkerResponseSchema.parse(workerResponse),
  });
}

function effectiveCapabilities(
  requested: readonly SshDaemonOperation[] | undefined,
): readonly SshDaemonOperation[] {
  const source = requested ?? DEFAULT_CAPABILITIES;
  return [...new Set(source)].filter((capability) => sshDaemonOperationToWorkerOperation(capability) !== undefined);
}

async function readSingleFrame(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_SSH_DAEMON_FRAME_BYTES) throw new Error('SSH daemon request is too large');
    chunks.push(buffer);
  }
  const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error('SSH daemon requires exactly one JSON request frame');
  return lines[0]!;
}

function writeFrame(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function safeDaemonError(error: unknown): string {
  if (error instanceof Error && /(?:missing|incompatible|confined|authorized|exactly one|too large|does not match|running in)/i.test(error.message)) {
    return error.message.slice(0, 500);
  }
  return 'SSH daemon rejected the request';
}
