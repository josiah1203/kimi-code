/** SpiderByte hosted identity errors. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const PlatformIdentityErrors = {
  codes: {
    IDENTITY_HOSTED_NOT_CONFIGURED: 'identity.hosted_not_configured',
    IDENTITY_FLOW_NOT_FOUND: 'identity.flow_not_found',
    IDENTITY_FLOW_EXPIRED: 'identity.flow_expired',
    IDENTITY_STATE_MISMATCH: 'identity.state_mismatch',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(PlatformIdentityErrors);

export type PlatformIdentityErrorCode =
  (typeof PlatformIdentityErrors.codes)[keyof typeof PlatformIdentityErrors.codes];

export class PlatformIdentityServiceError extends Error2 {
  constructor(code: PlatformIdentityErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'PlatformIdentityServiceError';
  }
}
