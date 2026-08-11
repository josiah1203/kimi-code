/**
 * `execution` domain — coded failures from worker adapter dispatch and
 * remote artifact ingestion.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ExecutionErrors = {
  codes: {
    EXECUTION_TARGET_NOT_FOUND: 'execution.target_not_found',
    EXECUTION_TARGET_UNAVAILABLE: 'execution.target_unavailable',
    EXECUTION_WORKER_REQUEST_FAILED: 'execution.worker_request_failed',
    EXECUTION_WORKER_INVALID_RESPONSE: 'execution.worker_invalid_response',
    EXECUTION_ARTIFACT_INVALID: 'execution.artifact_invalid',
    EXECUTION_SECRET_MATERIAL: 'execution.secret_material',
    EXECUTION_REQUEST_REUSED: 'execution.request_reused',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ExecutionErrors);

export type ExecutionErrorCode = (typeof ExecutionErrors.codes)[keyof typeof ExecutionErrors.codes];

export class ExecutionServiceError extends Error2 {
  constructor(code: ExecutionErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ExecutionServiceError';
  }
}
