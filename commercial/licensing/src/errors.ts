export const CommercialLicensingCodes = {
  LICENSE_NOT_FOUND: 'commercial.licensing.license_not_found',
  LICENSE_INVALID_SIGNATURE: 'commercial.licensing.invalid_signature',
  LICENSE_VERIFICATION_UNAVAILABLE: 'commercial.licensing.verification_unavailable',
  LICENSE_EXPIRED: 'commercial.licensing.expired',
  LICENSE_NOT_YET_VALID: 'commercial.licensing.not_yet_valid',
  LICENSE_DEPLOYMENT_MISMATCH: 'commercial.licensing.deployment_mismatch',
  LICENSE_ORGANIZATION_MISMATCH: 'commercial.licensing.organization_mismatch',
  LICENSE_REVOKED: 'commercial.licensing.revoked',
  CAPABILITY_NOT_INCLUDED: 'commercial.licensing.capability_not_included',
  USER_NOT_FOUND: 'commercial.licensing.user_not_found',
  USER_ALREADY_ASSIGNED: 'commercial.licensing.user_already_assigned',
  SEAT_NOT_FOUND: 'commercial.licensing.seat_not_found',
  SEAT_LIMIT_REACHED: 'commercial.licensing.seat_limit_reached',
  IDEMPOTENCY_REUSED: 'commercial.licensing.idempotency_reused',
  RENEWAL_UNAVAILABLE: 'commercial.licensing.renewal_unavailable',
} as const;

export type CommercialLicensingCode = (typeof CommercialLicensingCodes)[keyof typeof CommercialLicensingCodes];

export class CommercialLicensingError extends Error {
  readonly code: CommercialLicensingCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: CommercialLicensingCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialLicensingError';
    this.code = code;
    this.detail = detail;
  }
}
