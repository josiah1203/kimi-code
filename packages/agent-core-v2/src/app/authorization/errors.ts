/** Coded failures for the shared SpiderByte authorization boundary. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const AuthorizationErrors = {
  codes: {
    AUTHORIZATION_PROJECT_NOT_FOUND: 'authorization.project_not_found',
    AUTHORIZATION_DENIED: 'authorization.denied',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(AuthorizationErrors);

export type AuthorizationErrorCode =
  (typeof AuthorizationErrors.codes)[keyof typeof AuthorizationErrors.codes];

export class AuthorizationServiceError extends Error2 {
  constructor(code: AuthorizationErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'AuthorizationServiceError';
  }
}
