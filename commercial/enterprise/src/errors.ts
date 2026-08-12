export const CommercialEnterpriseCodes = {
  CONFIGURATION_INVALID: 'commercial.enterprise.configuration_invalid',
  IDENTITY_PROVIDER_NOT_FOUND: 'commercial.enterprise.identity_provider_not_found',
  DOMAIN_NOT_FOUND: 'commercial.enterprise.domain_not_found',
  DOMAIN_NOT_VERIFIED: 'commercial.enterprise.domain_not_verified',
  SCIM_USER_NOT_FOUND: 'commercial.enterprise.scim_user_not_found',
  IDEMPOTENCY_REUSED: 'commercial.enterprise.idempotency_reused',
} as const;

export class CommercialEnterpriseError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialEnterpriseError';
    this.code = code;
    this.detail = detail;
  }
}
