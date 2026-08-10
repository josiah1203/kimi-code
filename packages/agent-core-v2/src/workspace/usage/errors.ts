/** Workspace-local usage errors. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const WorkspaceUsageErrors = {
  codes: {
    WORKSPACE_USAGE_NOT_FOUND: 'workspace_usage.not_found',
    WORKSPACE_USAGE_INVALID: 'workspace_usage.invalid',
    WORKSPACE_USAGE_SECRET_MATERIAL: 'workspace_usage.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(WorkspaceUsageErrors);

export type WorkspaceUsageErrorCode =
  (typeof WorkspaceUsageErrors.codes)[keyof typeof WorkspaceUsageErrors.codes];

export class WorkspaceUsageServiceError extends Error2 {
  constructor(code: WorkspaceUsageErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'WorkspaceUsageServiceError';
  }
}
