export const CommercialBillingCodes = {
  PLAN_NOT_FOUND: 'commercial.billing.plan_not_found',
  PLAN_NOT_ACTIVE: 'commercial.billing.plan_not_active',
  SUBSCRIPTION_NOT_FOUND: 'commercial.billing.subscription_not_found',
  ENTITLEMENT_NOT_INCLUDED: 'commercial.billing.entitlement_not_included',
  ENTITLEMENT_NOT_CONFIGURED: 'commercial.billing.entitlement_not_configured',
  ENTITLEMENT_UNAVAILABLE: 'commercial.billing.entitlement_unavailable',
  USAGE_IDEMPOTENCY_REUSED: 'commercial.billing.usage_idempotency_reused',
  IDEMPOTENCY_REUSED: 'commercial.billing.idempotency_reused',
  DUPLICATE_SOURCE_EVENT: 'commercial.billing.duplicate_source_event',
  USAGE_NOT_FOUND: 'commercial.billing.usage_not_found',
  INVALID_USAGE_RECONCILIATION: 'commercial.billing.invalid_usage_reconciliation',
  BUDGET_EXHAUSTED: 'commercial.billing.budget_exhausted',
  UNPRICED_BUDGET_USAGE: 'commercial.billing.unpriced_budget_usage',
  BILLING_PERIOD_INVALID: 'commercial.billing.billing_period_invalid',
} as const;

export type CommercialBillingCode = (typeof CommercialBillingCodes)[keyof typeof CommercialBillingCodes];

export class CommercialBillingError extends Error {
  readonly code: CommercialBillingCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: CommercialBillingCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'CommercialBillingError';
    this.code = code;
    this.detail = detail;
  }
}
