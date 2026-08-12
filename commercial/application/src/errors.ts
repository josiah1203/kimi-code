export const CommercialApplicationCodes = {
  AUTHENTICATION_REQUIRED: 'commercial.authentication_required',
  AUTHORIZATION_DENIED: 'commercial.authorization_denied',
  ACCOUNT_NOT_FOUND: 'commercial.account_not_found',
  USER_NOT_FOUND: 'commercial.user_not_found',
  ORGANIZATION_NOT_FOUND: 'commercial.organization_not_found',
  WORKSPACE_NOT_FOUND: 'commercial.workspace_not_found',
  MEMBERSHIP_NOT_FOUND: 'commercial.membership_not_found',
  INVITATION_NOT_FOUND: 'commercial.invitation_not_found',
  INVITATION_EXPIRED: 'commercial.invitation_expired',
  INVITATION_EMAIL_MISMATCH: 'commercial.invitation_email_mismatch',
  ROLE_NOT_FOUND: 'commercial.role_not_found',
  IDEMPOTENCY_REUSED: 'commercial.idempotency_reused',
  IDEMPOTENCY_REPLAY_SECRET_UNAVAILABLE: 'commercial.idempotency_replay_secret_unavailable',
  LAST_OWNER_REQUIRED: 'commercial.last_owner_required',
  INVALID_STATE: 'commercial.invalid_state',
} as const;

export type CommercialApplicationCode =
  (typeof CommercialApplicationCodes)[keyof typeof CommercialApplicationCodes];

export class CommercialApplicationError extends Error {
  readonly code: CommercialApplicationCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: CommercialApplicationCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialApplicationError';
    this.code = code;
    this.detail = detail;
  }
}
