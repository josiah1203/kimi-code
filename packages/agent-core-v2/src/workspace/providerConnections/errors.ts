/**
 * `providerConnections` domain — coded failures for the workspace provider registry.
 */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ProviderConnectionErrors = {
  codes: {
    PROVIDER_CONNECTION_NOT_FOUND: 'provider_connection.not_found',
    PROVIDER_CONNECTION_NAME_TAKEN: 'provider_connection.name_taken',
    PROVIDER_CONNECTION_REVOKED: 'provider_connection.revoked',
    PROVIDER_CONNECTION_INVALID_STATE: 'provider_connection.invalid_state',
    PROVIDER_CONNECTION_SECRET_MATERIAL: 'provider_connection.secret_material',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ProviderConnectionErrors);

export type ProviderConnectionErrorCode =
  (typeof ProviderConnectionErrors.codes)[keyof typeof ProviderConnectionErrors.codes];

export class ProviderConnectionError extends Error2 {
  constructor(code: ProviderConnectionErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ProviderConnectionError';
  }
}

export class ProviderConnectionSecretError extends ProviderConnectionError {
  constructor(key: string) {
    super(
      ProviderConnectionErrors.codes.PROVIDER_CONNECTION_SECRET_MATERIAL,
      `provider connection metadata cannot contain secret material in '${key}'`,
      { key },
    );
    this.name = 'ProviderConnectionSecretError';
  }
}
