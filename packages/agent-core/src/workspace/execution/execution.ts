/**
 * `execution` domain — workspace-scoped adapter contracts for governed
 * local and customer-managed execution targets.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { ArtifactKind, ExecutionTargetId, PlatformMetadata } from '@spiderbyte/protocol';

export type WorkspaceExecutionOperation = 'analysis' | 'training' | 'evaluation' | 'comparison' | 'serving';

export interface WorkspaceExecutionArtifactInput {
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly content_base64: string;
  readonly media_type?: string;
  readonly source_artifact_ids?: readonly string[];
  readonly metadata?: PlatformMetadata;
}

export interface WorkspaceExecutionRequest {
  readonly request_id: string;
  readonly run_id: string;
  readonly attempt_id?: string;
  readonly project_id?: string;
  readonly target_id: ExecutionTargetId;
  readonly lease_id?: string;
  readonly operation: WorkspaceExecutionOperation;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly policy_decision_id?: string;
  readonly policy_decision_ids?: readonly string[];
  readonly approval_ids?: readonly string[];
  readonly artifact_ids?: readonly string[];
  readonly provider?: string;
  readonly model?: string;
  readonly user_id?: string;
}

export interface WorkspaceExecutionResult {
  readonly status: 'succeeded' | 'failed';
  readonly output_artifact_ids: readonly string[];
  readonly metrics?: Readonly<Record<string, number>>;
  readonly metadata?: PlatformMetadata;
  readonly error?: string;
}

export interface IWorkspaceExecutionService {
  readonly _serviceBrand: undefined;
  execute(input: WorkspaceExecutionRequest): Promise<WorkspaceExecutionResult>;
  cancel(requestId: string): Promise<boolean>;
}

export const IWorkspaceExecutionService: ServiceIdentifier<IWorkspaceExecutionService> =
  createDecorator<IWorkspaceExecutionService>('workspaceExecutionService');
