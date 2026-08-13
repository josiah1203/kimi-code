/** Workspace execution target registration and lease contracts. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  ExecutionLease,
  ExecutionLeaseAcquireInput,
  ExecutionLeaseReleaseInput,
  ExecutionTarget,
  ExecutionTargetCommandInput,
  ExecutionTargetCreateInput,
  ExecutionTargetTestInput,
  ExecutionTargetTestResult,
  ExecutionTargetUpdateInput,
} from '@spiderbyte/protocol';

export interface WorkspaceExecutionTargetsChangedEvent {
  readonly target: ExecutionTarget;
  readonly kind: 'created' | 'updated' | 'ready' | 'disabled' | 'revoked' | 'health_changed' | 'lease_changed';
  readonly lease?: ExecutionLease;
}

export interface IWorkspaceExecutionTargetService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceExecutionTargetsChangedEvent>;
  list(): Promise<readonly ExecutionTarget[]>;
  get(id: string): Promise<ExecutionTarget | undefined>;
  register(input: ExecutionTargetCreateInput): Promise<ExecutionTarget>;
  update(id: string, input: ExecutionTargetUpdateInput): Promise<ExecutionTarget | undefined>;
  markReady(id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined>;
  disable(id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined>;
  revoke(id: string, input: ExecutionTargetCommandInput): Promise<ExecutionTarget | undefined>;
  test(id: string, input: ExecutionTargetTestInput): Promise<ExecutionTargetTestResult>;
  getLease(targetId: string, leaseId: string): Promise<ExecutionLease | undefined>;
  acquireLease(id: string, input: ExecutionLeaseAcquireInput): Promise<ExecutionLease>;
  releaseLease(id: string, leaseId: string, input: ExecutionLeaseReleaseInput): Promise<ExecutionLease | undefined>;
}

export const IWorkspaceExecutionTargetService: ServiceIdentifier<IWorkspaceExecutionTargetService> =
  createDecorator<IWorkspaceExecutionTargetService>('executionTargetService');
