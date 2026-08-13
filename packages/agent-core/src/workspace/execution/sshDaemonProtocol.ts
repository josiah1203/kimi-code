/**
 * Versioned stdio contract for a customer-owned SpiderByte daemon reached by
 * the governed SSH transport.
 *
 * The protocol carries semantic operations and bounded JSON frames. It does
 * not carry shell source, private keys, provider credentials, or an arbitrary
 * command field.
 */

import { posix as posixPath } from 'node:path';
import { z } from 'zod';

import {
  platformWorkerResponseSchema,
  type PlatformWorkerOperation,
  type PlatformWorkerRequest,
  type PlatformWorkerResponse,
} from './platformWorker';

export const SSH_DAEMON_PROTOCOL_VERSION = 1 as const;
export const SSH_DAEMON_COMMAND = ['spyderbyte', 'daemon', 'platform-worker', '--stdio'] as const;
export const SSH_DAEMON_ENV_KEYS = ['SPIDERBYTE_PROTOCOL_VERSION', 'SPIDERBYTE_WORKSPACE_ID'] as const;
export const MAX_SSH_DAEMON_FRAME_BYTES = 16 * 1024 * 1024;

export const SSH_DAEMON_CAPABILITIES = [
  'create_run',
  'inspect_run',
  'execute_analysis',
  'profile_dataset',
  'train_model',
  'retrieve_artifact',
  'inspect_logs',
  'cancel_job',
] as const;

const sshDaemonOperationSchema = z.enum(SSH_DAEMON_CAPABILITIES);
export type SshDaemonOperation = z.infer<typeof sshDaemonOperationSchema>;

export const sshDaemonProbeRequestSchema = z.strictObject({
  kind: z.literal('probe'),
  protocol_version: z.literal(SSH_DAEMON_PROTOCOL_VERSION),
  request_id: z.string().min(1).max(256),
  workspace_id: z.string().min(1).max(256),
  target_id: z.string().min(1).max(256),
  workspace_root: z.string().min(1).max(4_096),
});

export const sshDaemonExecuteRequestSchema = z.strictObject({
  kind: z.literal('execute'),
  protocol_version: z.literal(SSH_DAEMON_PROTOCOL_VERSION),
  request_id: z.string().min(1).max(256),
  run_id: z.string().min(1).max(256),
  attempt_id: z.string().min(1).max(256).optional(),
  project_id: z.string().min(1).max(256).optional(),
  workspace_id: z.string().min(1).max(256),
  target_id: z.string().min(1).max(256),
  workspace_root: z.string().min(1).max(4_096),
  lease_id: z.string().min(1).max(256).optional(),
  operation: sshDaemonOperationSchema,
  payload: z.record(z.string(), z.unknown()),
  policy_decision_id: z.string().min(1).max(256).optional(),
  policy_decision_ids: z.array(z.string().min(1).max(256)).max(100).optional(),
  approval_ids: z.array(z.string().min(1).max(256)).max(100).optional(),
  artifact_ids: z.array(z.string().min(1).max(256)).max(100).optional(),
  provider: z.string().min(1).max(160).optional(),
  model: z.string().min(1).max(256).optional(),
  user_id: z.string().min(1).max(256).optional(),
});

export const sshDaemonRequestSchema = z.discriminatedUnion('kind', [
  sshDaemonProbeRequestSchema,
  sshDaemonExecuteRequestSchema,
]);
export type SshDaemonRequest = z.infer<typeof sshDaemonRequestSchema>;
export type SshDaemonProbeRequest = z.infer<typeof sshDaemonProbeRequestSchema>;
export type SshDaemonExecuteRequest = z.infer<typeof sshDaemonExecuteRequestSchema>;

export const sshDaemonProbeResponseSchema = z.strictObject({
  kind: z.literal('probe_result'),
  daemon: z.literal('spiderbyte'),
  daemon_version: z.string().min(1).max(256),
  protocol_version: z.number().int().positive(),
  workspace_id: z.string().min(1).max(256),
  target_id: z.string().min(1).max(256),
  status: z.enum(['ready', 'healthy', 'unhealthy']),
  capabilities: z.array(z.string().min(1).max(256)).max(256),
  available_models: z.array(z.string().min(1).max(256)).max(256).optional(),
  available_providers: z.array(z.string().min(1).max(256)).max(256).optional(),
  resources: z.strictObject({
    cpu_cores: z.number().finite().nonnegative().optional(),
    memory_bytes: z.number().int().nonnegative().optional(),
    gpu_count: z.number().int().nonnegative().optional(),
    gpu_models: z.array(z.string().min(1).max(200)).optional(),
  }).optional(),
});
export type SshDaemonProbeResponse = z.infer<typeof sshDaemonProbeResponseSchema>;

export const sshDaemonExecuteResponseSchema = z.strictObject({
  kind: z.literal('execute_result'),
  daemon: z.literal('spiderbyte'),
  daemon_version: z.string().min(1).max(256),
  protocol_version: z.number().int().positive(),
  workspace_id: z.string().min(1).max(256),
  target_id: z.string().min(1).max(256),
  response: platformWorkerResponseSchema,
});
export type SshDaemonExecuteResponse = z.infer<typeof sshDaemonExecuteResponseSchema>;

export const sshDaemonErrorResponseSchema = z.strictObject({
  kind: z.literal('error'),
  daemon: z.literal('spiderbyte'),
  daemon_version: z.string().min(1).max(256),
  protocol_version: z.number().int().positive(),
  error: z.string().min(1).max(500),
});

export const sshDaemonResponseSchema = z.discriminatedUnion('kind', [
  sshDaemonProbeResponseSchema,
  sshDaemonExecuteResponseSchema,
  sshDaemonErrorResponseSchema,
]);

export function sshDaemonOperationToWorkerOperation(
  operation: SshDaemonOperation,
): PlatformWorkerOperation | undefined {
  switch (operation) {
    case 'execute_analysis':
    case 'profile_dataset':
      return 'analysis';
    case 'train_model':
      return 'training';
    case 'inspect_run':
      return 'evaluation';
    default:
      return undefined;
  }
}

export function isConfinedSshDaemonRoot(root: string): boolean {
  if (/[\u0000-\u001F\u007F]/.test(root)) return false;
  if (!root.startsWith('/') || root === '/') return false;
  const normalized = posixPath.normalize(root);
  return normalized === root && !normalized.split('/').includes('..');
}

export interface SshDaemonExecutionContext {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly targetId: string;
}

export function assertSshDaemonExecutionContext(
  request: SshDaemonRequest,
  context: SshDaemonExecutionContext,
  currentWorkingDirectory: string,
): void {
  if (request.workspace_id !== context.workspaceId) {
    throw new Error('SSH daemon request workspace is not authorized');
  }
  if (request.workspace_root !== context.workspaceRoot) {
    throw new Error('SSH daemon request root does not match the authorized workspace');
  }
  if (request.target_id !== context.targetId) {
    throw new Error('SSH daemon request target does not match the authorized transport');
  }
  if (!isConfinedSshDaemonRoot(request.workspace_root)) {
    throw new Error('SSH daemon workspace root is not confined');
  }
  if (posixPath.resolve(currentWorkingDirectory) !== posixPath.resolve(request.workspace_root)) {
    throw new Error('SSH daemon process is not running in the authorized workspace root');
  }
}

export type { PlatformWorkerRequest, PlatformWorkerResponse };
