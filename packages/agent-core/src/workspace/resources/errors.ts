/**
 * `resources` domain — coded failures for workspace resources and executions.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ResourceErrors = {
  codes: {
    RESOURCE_NOT_FOUND: 'resource.not_found',
    RESOURCE_NAME_TAKEN: 'resource.name_taken',
    RESOURCE_INVALID_STATE: 'resource.invalid_state',
    RESOURCE_SECRET_MATERIAL: 'resource.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ResourceErrors);

export type ResourceErrorCode = (typeof ResourceErrors.codes)[keyof typeof ResourceErrors.codes];

export class ResourceServiceError extends Error2 {
  constructor(code: ResourceErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ResourceServiceError';
  }
}
