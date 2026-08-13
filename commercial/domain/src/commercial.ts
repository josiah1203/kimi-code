import { z } from 'zod';

import {
  accountIdSchema,
  allowanceIdSchema,
  budgetIdSchema,
  commandContextSchema,
  entitlementIdSchema,
  isoDateTimeSchema,
  licenseActivationIdSchema,
  licenseIdSchema,
  licenseSeatIdSchema,
  organizationIdSchema,
  planIdSchema,
  recordFieldsSchema,
  spendLimitIdSchema,
  subscriptionIdSchema,
  usageEventIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from './common';

export const editionSchema = z.enum(['free', 'team', 'business', 'enterprise']);
export type Edition = z.infer<typeof editionSchema>;

export const licenseDeploymentRestrictionSchema = z.strictObject({
  deployment_id: z.string().min(1).max(256).optional(),
  host_fingerprint: z.string().min(16).max(256).regex(/^[A-Fa-f0-9:-]+$/).optional(),
  allowed_domains: z.array(z.string().min(1).max(253)).max(100).optional(),
});
export type LicenseDeploymentRestriction = z.infer<typeof licenseDeploymentRestrictionSchema>;

/** Signed payload issued by a commercial license authority. */
export const offlineLicenseSchema = z.strictObject({
  id: licenseIdSchema,
  organization_id: organizationIdSchema,
  plan: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  seat_count: z.number().int().positive(),
  enabled_capabilities: z.array(z.string().trim().min(1).max(200)).max(500),
  issued_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema,
  grace_period_days: z.number().int().min(0).max(3650),
  license_version: z.number().int().positive(),
  key_id: z.string().trim().min(1).max(200),
  deployment_restrictions: licenseDeploymentRestrictionSchema.optional(),
  signature: z.string().min(32).max(1024).regex(/^[A-Za-z0-9_-]+$/),
}).superRefine((value, context) => {
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'license must expire after issuance' });
  }
});
export type OfflineLicense = z.infer<typeof offlineLicenseSchema>;

export const licenseActivationStateSchema = z.enum(['active', 'grace', 'expired', 'revoked', 'invalid']);
export type LicenseActivationState = z.infer<typeof licenseActivationStateSchema>;
export const licenseActivationSchema = z.strictObject({
  id: licenseActivationIdSchema,
  license_id: licenseIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  state: licenseActivationStateSchema,
  activated_at: isoDateTimeSchema,
  last_evaluated_at: isoDateTimeSchema,
  verified_at: isoDateTimeSchema,
  verification_source: z.enum(['signature', 'cached']),
  license_digest: z.string().regex(/^[a-f0-9]{64}$/),
  deployment_id: z.string().min(1).max(256).optional(),
  revoked_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type LicenseActivation = z.infer<typeof licenseActivationSchema>;

export const licenseSeatStateSchema = z.enum(['active', 'revoked']);
export const licenseSeatSchema = z.strictObject({
  id: licenseSeatIdSchema,
  license_id: licenseIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  user_id: userIdSchema,
  state: licenseSeatStateSchema,
  assigned_at: isoDateTimeSchema,
  revoked_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type LicenseSeat = z.infer<typeof licenseSeatSchema>;

export const planStateSchema = z.enum(['draft', 'active', 'retired']);
export const planValueSchema = z.union([z.boolean(), z.number().finite(), z.string().max(500)]);
export const planSchema = z.strictObject({
  id: planIdSchema,
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  name: z.string().trim().min(1).max(100),
  edition: editionSchema,
  state: planStateSchema,
  entitlements: z.record(z.string().min(1).max(200), planValueSchema),
  ...recordFieldsSchema.shape,
});
export type Plan = z.infer<typeof planSchema>;

export const subscriptionStateSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'grace',
  'restricted',
  'canceled',
  'expired',
]);
export const subscriptionSchema = z.strictObject({
  id: subscriptionIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  plan_id: planIdSchema,
  state: subscriptionStateSchema,
  current_period_start: isoDateTimeSchema,
  current_period_end: isoDateTimeSchema,
  grace_until: isoDateTimeSchema.optional(),
  external_customer_ref: z.string().min(1).max(500).optional(),
  canceled_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const entitlementStatusSchema = z.enum([
  'included',
  'not_included',
  'not_configured',
  'configured',
  'temporarily_unavailable',
  'not_implemented',
]);
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>;
export const entitlementSourceSchema = z.enum(['plan', 'contract', 'override', 'adapter']);
export const entitlementSchema = z.strictObject({
  id: entitlementIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  key: z.string().trim().min(1).max(200),
  status: entitlementStatusSchema,
  value: planValueSchema.optional(),
  source: entitlementSourceSchema,
  effective_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Entitlement = z.infer<typeof entitlementSchema>;

export const quotaSchema = z.strictObject({
  id: z.string().regex(/^quota_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  key: z.string().trim().min(1).max(200),
  limit: z.number().finite().nonnegative(),
  used: z.number().finite().nonnegative(),
  unit: z.string().trim().min(1).max(50),
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  state: z.enum(['available', 'exhausted', 'restricted']),
  ...recordFieldsSchema.shape,
});
export type Quota = z.infer<typeof quotaSchema>;

export const allowanceSchema = z.strictObject({
  id: allowanceIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  resource_type: z.string().trim().min(1).max(100),
  quantity: z.number().finite().nonnegative(),
  consumed: z.number().finite().nonnegative(),
  unit: z.string().trim().min(1).max(50),
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  state: z.enum(['available', 'exhausted', 'expired', 'restricted']),
  ...recordFieldsSchema.shape,
});
export type Allowance = z.infer<typeof allowanceSchema>;

export const budgetScopeSchema = z.enum(['organization', 'workspace', 'user', 'service_account', 'project', 'department']);
export const budgetStateSchema = z.enum(['active', 'paused', 'exhausted', 'expired', 'archived']);
export const budgetSchema = z.strictObject({
  id: budgetIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  scope: budgetScopeSchema,
  scope_id: z.string().min(1).max(160),
  meter: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(50),
  currency: z.string().regex(/^[A-Z]{3}$/),
  limit_minor: z.number().int().nonnegative(),
  reserved_minor: z.number().int().nonnegative(),
  consumed_minor: z.number().int().nonnegative(),
  soft_limit_percent: z.number().finite().min(0).max(100),
  state: budgetStateSchema,
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  ...recordFieldsSchema.shape,
});
export type Budget = z.infer<typeof budgetSchema>;

export const spendLimitSchema = z.strictObject({
  id: spendLimitIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  scope: budgetScopeSchema,
  scope_id: z.string().min(1).max(160),
  amount_minor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  enforcement: z.enum(['soft', 'hard']),
  state: z.enum(['active', 'paused', 'expired', 'archived']),
  ...recordFieldsSchema.shape,
});
export type SpendLimit = z.infer<typeof spendLimitSchema>;

export const usageUnitSchema = z.enum(['seconds', 'bytes', 'tokens', 'requests', 'units', 'seats', 'minor_currency']);
export const usageSourceSchema = z.enum(['worker', 'provider', 'api', 'storage', 'billing', 'manual_adjustment']);
export const usageEventStateSchema = z.enum(['received', 'reserved', 'consumed', 'reconciled', 'adjusted', 'rejected']);
export const adjustmentStateSchema = z.enum(['none', 'pending', 'applied', 'reversed']);
export const usagePriceBasisSchema = z.strictObject({
  unit_price_minor: z.number().int().nonnegative(),
  multiplier: z.number().finite().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  price_book_id: z.string().min(1).max(160),
});
export type UsagePriceBasis = z.infer<typeof usagePriceBasisSchema>;

export const usageEventSchema = z.strictObject({
  id: usageEventIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  user_id: userIdSchema.optional(),
  service_account_id: z.string().regex(/^svc_[A-Za-z0-9._:-]{2,127}$/).optional(),
  run_id: z.string().min(1).max(256).optional(),
  attempt_id: z.string().min(1).max(256).optional(),
  provider: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(500).optional(),
  compute_provider: z.string().min(1).max(200).optional(),
  resource_type: z.string().trim().min(1).max(100),
  reserved_amount: z.number().finite().nonnegative(),
  actual_amount: z.number().finite().nonnegative(),
  unit: usageUnitSchema,
  price_basis: usagePriceBasisSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  occurred_at: isoDateTimeSchema,
  idempotency_key: z.string().trim().min(8).max(500),
  source_event_id: z.string().trim().min(1).max(500),
  source: usageSourceSchema,
  adjustment_status: adjustmentStateSchema,
  state: usageEventStateSchema,
  ...recordFieldsSchema.shape,
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

export const ledgerEntrySchema = z.strictObject({
  id: z.string().regex(/^ledger_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  usage_event_id: usageEventIdSchema,
  kind: z.enum(['reservation', 'charge', 'release', 'credit', 'debit', 'adjustment']),
  direction: z.enum(['debit', 'credit']),
  quantity: z.number().finite().nonnegative(),
  unit: usageUnitSchema,
  amount_minor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  state: z.enum(['pending', 'posted', 'reconciled', 'reversed']),
  occurred_at: isoDateTimeSchema,
  posted_at: isoDateTimeSchema.optional(),
  reversed_by_id: z.string().regex(/^ledger_[A-Za-z0-9._:-]{2,127}$/).optional(),
  ...recordFieldsSchema.shape,
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const billingPeriodSchema = z.strictObject({
  id: z.string().regex(/^period_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  start_at: isoDateTimeSchema,
  end_at: isoDateTimeSchema,
  state: z.enum(['open', 'closing', 'closed', 'reopened']),
  closed_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type BillingPeriod = z.infer<typeof billingPeriodSchema>;

export const invoiceStateSchema = z.enum(['draft', 'open', 'paid', 'past_due', 'void', 'uncollectible']);
export const invoiceSchema = z.strictObject({
  id: z.string().regex(/^inv_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  billing_period_id: z.string().regex(/^period_[A-Za-z0-9._:-]{2,127}$/),
  state: invoiceStateSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal_minor: z.number().int().nonnegative(),
  tax_minor: z.number().int().nonnegative(),
  total_minor: z.number().int().nonnegative(),
  amount_due_minor: z.number().int().nonnegative(),
  external_invoice_ref: z.string().min(1).max(500).optional(),
  due_at: isoDateTimeSchema.optional(),
  paid_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const paymentStatusSchema = z.strictObject({
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  state: z.enum(['unknown', 'pending', 'succeeded', 'failed', 'requires_action', 'canceled']),
  provider: z.string().min(1).max(100),
  external_payment_ref: z.string().min(1).max(500).optional(),
  failure_code: z.string().min(1).max(200).optional(),
  checked_at: isoDateTimeSchema,
});
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const creditBalanceSchema = z.strictObject({
  id: z.string().regex(/^credit_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  available_minor: z.number().int().nonnegative(),
  reserved_minor: z.number().int().nonnegative(),
  state: z.enum(['active', 'frozen', 'expired']),
  expires_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type CreditBalance = z.infer<typeof creditBalanceSchema>;

export const planChangeInputSchema = commandContextSchema.extend({
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  plan_id: planIdSchema,
  effective_at: isoDateTimeSchema.optional(),
});
export type PlanChangeInput = z.infer<typeof planChangeInputSchema>;
