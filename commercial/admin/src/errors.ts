export const CommercialAdminCodes = {
  ROLE_NOT_FOUND: 'commercial.admin.role_not_found',
  TEAM_NOT_FOUND: 'commercial.admin.team_not_found',
  GROUP_NOT_FOUND: 'commercial.admin.group_not_found',
  API_KEY_NOT_FOUND: 'commercial.admin.api_key_not_found',
  SERVICE_ACCOUNT_NOT_FOUND: 'commercial.admin.service_account_not_found',
  SUPPORT_GRANT_NOT_FOUND: 'commercial.admin.support_grant_not_found',
  WEBHOOK_NOT_FOUND: 'commercial.admin.webhook_not_found',
  IDEMPOTENCY_REUSED: 'commercial.admin.idempotency_reused',
  INVALID_SECRET_REPLAY: 'commercial.admin.secret_replay_unavailable',
} as const;

export class CommercialAdminError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialAdminError';
    this.code = code;
    this.detail = detail;
  }
}
