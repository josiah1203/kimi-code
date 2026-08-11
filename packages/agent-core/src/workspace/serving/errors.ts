/** `serving` domain — coded failures for packaging and endpoint lifecycle. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ServingErrors = {
  codes: {
    SERVING_NOT_FOUND: 'serving.not_found',
    SERVING_PACKAGE_NOT_FOUND: 'serving.package_not_found',
    SERVING_MODEL_NOT_FOUND: 'serving.model_not_found',
    SERVING_ARTIFACT_INVALID: 'serving.artifact_invalid',
    SERVING_POLICY_REQUIRED: 'serving.policy_required',
    SERVING_POLICY_DENIED: 'serving.policy_denied',
    SERVING_TARGET_UNAVAILABLE: 'serving.target_unavailable',
    SERVING_INVALID_STATE: 'serving.invalid_state',
    SERVING_NAME_TAKEN: 'serving.name_taken',
    SERVING_ACTION_INVALID: 'serving.action_invalid',
    SERVING_SECRET_MATERIAL: 'serving.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ServingErrors);

export type ServingErrorCode = (typeof ServingErrors.codes)[keyof typeof ServingErrors.codes];

export class ServingServiceError extends Error2 {
  constructor(code: ServingErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ServingServiceError';
  }
}
