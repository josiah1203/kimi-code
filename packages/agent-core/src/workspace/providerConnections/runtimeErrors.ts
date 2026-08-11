/** `providerConnections` domain — coded failures from provider runtime calls. */

import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';
import { Error2 } from '#/_base/errors/errors';
import type { ErrorCode } from '#/errors';

export const ProviderRuntimeErrors = {
  codes: {
    PROVIDER_RUNTIME_CONNECTION_NOT_FOUND: 'provider_runtime.connection_not_found',
    PROVIDER_RUNTIME_INVALID_CONFIGURATION: 'provider_runtime.invalid_configuration',
    PROVIDER_RUNTIME_SECRET_MISSING: 'provider_runtime.secret_missing',
    PROVIDER_RUNTIME_UNSUPPORTED: 'provider_runtime.unsupported',
    PROVIDER_RUNTIME_REQUEST_FAILED: 'provider_runtime.request_failed',
    PROVIDER_RUNTIME_DISCOVERY_FAILED: 'provider_runtime.discovery_failed',
    PROVIDER_RUNTIME_POLICY_REQUIRED: 'provider_runtime.policy_required',
    PROVIDER_RUNTIME_POLICY_DENIED: 'provider_runtime.policy_denied',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(ProviderRuntimeErrors);

export type ProviderRuntimeErrorCode =
  (typeof ProviderRuntimeErrors.codes)[keyof typeof ProviderRuntimeErrors.codes];

export class ProviderRuntimeError extends Error2 {
  constructor(code: ProviderRuntimeErrorCode, message: string, details?: Record<string, unknown>) {
    super(code as ErrorCode, message, { details });
    this.name = 'ProviderRuntimeError';
  }
}
