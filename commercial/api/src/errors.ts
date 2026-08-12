import { CapabilityUnavailableError } from '@spiderbyte/commercial-ports';

export class CommercialApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 503;
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 503,
    code: string,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommercialApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function commercialApiStatusForCode(code: string): CommercialApiError['status'] {
  if (code.includes('authentication') || code.includes('invalid_session')) return 401;
  if (code.includes('not_configured') || code.includes('temporarily_unavailable') || code.includes('not_implemented') || code.includes('unavailable')) return 503;
  if (code.includes('authorization') || code.includes('entitlement_not_included')) return 403;
  if (code.includes('not_found')) return 404;
  if (code.includes('idempotency') || code.includes('duplicate') || code.includes('last_owner')) return 409;
  return 400;
}

export function mapCommercialApiError(error: unknown): CommercialApiError {
  if (error instanceof CommercialApiError) return error;
  if (error instanceof CapabilityUnavailableError) {
    return new CommercialApiError(503, error.code, error.message, error.detail);
  }
  if (error instanceof Error && error.name === 'CommercialApplicationError') {
    const application = error as Error & { readonly code: string; readonly detail?: Record<string, unknown> };
    const status = commercialApiStatusForCode(application.code);
    return new CommercialApiError(status, application.code, application.message, application.detail);
  }
  if (error instanceof Error && ['CommercialBillingError', 'CommercialComputeError', 'CommercialArtifactError', 'CommercialAdminError', 'CommercialEnterpriseError'].includes(error.name)) {
    const typed = error as Error & { readonly code: string; readonly detail?: Record<string, unknown> };
    const status = commercialApiStatusForCode(typed.code);
    return new CommercialApiError(status, typed.code, typed.message, typed.detail);
  }
  return new CommercialApiError(400, 'commercial.invalid_request', 'commercial request failed');
}
