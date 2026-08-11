/**
 * `commercial` domain — coded failures for membership, entitlements, and usage.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const CommercialErrors = {
  codes: {
    COMMERCIAL_MEMBER_NOT_FOUND: 'commercial.member_not_found',
    COMMERCIAL_MEMBERSHIP_DENIED: 'commercial.membership_denied',
    COMMERCIAL_OWNER_REQUIRED: 'commercial.owner_required',
    COMMERCIAL_ENTITLEMENT_NOT_FOUND: 'commercial.entitlement_not_found',
    COMMERCIAL_ENTITLEMENT_DISABLED: 'commercial.entitlement_disabled',
    COMMERCIAL_ENTITLEMENT_EXCEEDED: 'commercial.entitlement_exceeded',
    COMMERCIAL_USAGE_NOT_FOUND: 'commercial.usage_not_found',
    COMMERCIAL_USAGE_INVALID: 'commercial.usage_invalid',
    COMMERCIAL_SECRET_MATERIAL: 'commercial.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(CommercialErrors);

export type CommercialErrorCode = (typeof CommercialErrors.codes)[keyof typeof CommercialErrors.codes];

export class CommercialServiceError extends Error2 {
  constructor(code: CommercialErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'CommercialServiceError';
  }
}
