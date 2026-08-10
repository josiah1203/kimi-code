/**
 * `executionTargets` domain — coded failures for target registration and leases.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ExecutionTargetErrors = {
  codes: {
    EXECUTION_TARGET_NOT_FOUND: 'execution_target.not_found',
    EXECUTION_TARGET_NAME_TAKEN: 'execution_target.name_taken',
    EXECUTION_TARGET_INVALID_STATE: 'execution_target.invalid_state',
    EXECUTION_TARGET_LEASE_BUSY: 'execution_target.lease_busy',
    EXECUTION_TARGET_LEASE_NOT_FOUND: 'execution_target.lease_not_found',
    EXECUTION_TARGET_POLICY_DENIED: 'execution_target.policy_denied',
    EXECUTION_TARGET_CREDENTIAL_INVALID: 'execution_target.credential_invalid',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ExecutionTargetErrors);

export type ExecutionTargetErrorCode =
  (typeof ExecutionTargetErrors.codes)[keyof typeof ExecutionTargetErrors.codes];

export class ExecutionTargetServiceError extends Error2 {
  constructor(code: ExecutionTargetErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ExecutionTargetServiceError';
  }
}
