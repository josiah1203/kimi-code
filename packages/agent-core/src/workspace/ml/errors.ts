/** `ml` domain — coded failures for experiment and model workflows. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const MlErrors = {
  codes: {
    ML_NOT_FOUND: 'ml.not_found',
    ML_INVALID_INPUT: 'ml.invalid_input',
    ML_INVALID_STATE: 'ml.invalid_state',
    ML_POLICY_REQUIRED: 'ml.policy_required',
    ML_EXECUTOR_UNAVAILABLE: 'ml.executor_unavailable',
    ML_EXECUTION_FAILED: 'ml.execution_failed',
    ML_ARTIFACT_INVALID: 'ml.artifact_invalid',
    ML_LINEAGE_INVALID: 'ml.lineage_invalid',
    ML_SECRET_MATERIAL: 'ml.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(MlErrors);

export type MlErrorCode = (typeof MlErrors.codes)[keyof typeof MlErrors.codes];

export class MlServiceError extends Error2 {
  constructor(code: MlErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'MlServiceError';
  }
}
