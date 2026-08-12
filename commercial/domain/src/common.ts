import { z } from 'zod';

const ID_RE = /^[a-z][a-z0-9_:-]{1,127}$/;
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function prefixedIdentifier(prefix: string): z.ZodString {
  return z.string().min(prefix.length + 2).max(160).regex(
    new RegExp(`^${escapeRegExp(prefix)}[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$`),
    `identifier must start with ${prefix}`,
  );
}

export const commercialIdentifierSchema = z
  .string()
  .min(2)
  .max(160)
  .regex(ID_RE, 'commercial identifiers must use lowercase letters, numbers, _, :, or -');

export const accountIdSchema = prefixedIdentifier('acct_');
export const userIdSchema = prefixedIdentifier('usr_');
export const sessionIdSchema = prefixedIdentifier('ses_');
export const organizationIdSchema = prefixedIdentifier('org_');
export const workspaceIdSchema = prefixedIdentifier('cws_');
export const teamIdSchema = prefixedIdentifier('team_');
export const groupIdSchema = prefixedIdentifier('group_');
export const membershipIdSchema = prefixedIdentifier('mem_');
export const roleIdSchema = prefixedIdentifier('role_');
export const permissionIdSchema = prefixedIdentifier('perm_');
export const invitationIdSchema = prefixedIdentifier('invite_');
export const serviceAccountIdSchema = prefixedIdentifier('svc_');
export const apiKeyIdSchema = prefixedIdentifier('key_');
export const identityProviderIdSchema = prefixedIdentifier('idp_');
export const verifiedDomainIdSchema = prefixedIdentifier('domain_');
export const planIdSchema = prefixedIdentifier('plan_');
export const subscriptionIdSchema = prefixedIdentifier('sub_');
export const entitlementIdSchema = prefixedIdentifier('ent_');
export const quotaIdSchema = prefixedIdentifier('quota_');
export const allowanceIdSchema = prefixedIdentifier('allow_');
export const usageEventIdSchema = prefixedIdentifier('usageevt_');
export const ledgerEntryIdSchema = prefixedIdentifier('ledger_');
export const reservationIdSchema = prefixedIdentifier('reserve_');
export const executionIdSchema = prefixedIdentifier('exec_');
export const invoiceIdSchema = prefixedIdentifier('inv_');
export const budgetIdSchema = prefixedIdentifier('budget_');
export const spendLimitIdSchema = prefixedIdentifier('limit_');
export const providerConnectionIdSchema = prefixedIdentifier('conn_');
export const modelAccessPolicyIdSchema = prefixedIdentifier('modelpolicy_');
export const artifactIdSchema = prefixedIdentifier('hartifact_');
export const retentionPolicyIdSchema = prefixedIdentifier('retain_');
export const legalHoldIdSchema = prefixedIdentifier('hold_');
export const exportJobIdSchema = prefixedIdentifier('export_');
export const auditEventIdSchema = prefixedIdentifier('audit_');
export const supportGrantIdSchema = prefixedIdentifier('support_');
export const webhookEndpointIdSchema = prefixedIdentifier('webhook_');
export const enterpriseConfigIdSchema = prefixedIdentifier('enterprise_');

export type AccountId = z.infer<typeof accountIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type SessionId = z.infer<typeof sessionIdSchema>;
export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type TeamId = z.infer<typeof teamIdSchema>;
export type GroupId = z.infer<typeof groupIdSchema>;
export type MembershipId = z.infer<typeof membershipIdSchema>;
export type RoleId = z.infer<typeof roleIdSchema>;
export type PermissionId = z.infer<typeof permissionIdSchema>;
export type InvitationId = z.infer<typeof invitationIdSchema>;
export type ServiceAccountId = z.infer<typeof serviceAccountIdSchema>;
export type ApiKeyId = z.infer<typeof apiKeyIdSchema>;
export type IdentityProviderId = z.infer<typeof identityProviderIdSchema>;
export type VerifiedDomainId = z.infer<typeof verifiedDomainIdSchema>;
export type PlanId = z.infer<typeof planIdSchema>;
export type SubscriptionId = z.infer<typeof subscriptionIdSchema>;
export type EntitlementId = z.infer<typeof entitlementIdSchema>;
export type QuotaId = z.infer<typeof quotaIdSchema>;
export type AllowanceId = z.infer<typeof allowanceIdSchema>;
export type UsageEventId = z.infer<typeof usageEventIdSchema>;
export type LedgerEntryId = z.infer<typeof ledgerEntryIdSchema>;
export type ReservationId = z.infer<typeof reservationIdSchema>;
export type ExecutionId = z.infer<typeof executionIdSchema>;
export type InvoiceId = z.infer<typeof invoiceIdSchema>;
export type BudgetId = z.infer<typeof budgetIdSchema>;
export type SpendLimitId = z.infer<typeof spendLimitIdSchema>;
export type ProviderConnectionId = z.infer<typeof providerConnectionIdSchema>;
export type ModelAccessPolicyId = z.infer<typeof modelAccessPolicyIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type RetentionPolicyId = z.infer<typeof retentionPolicyIdSchema>;
export type LegalHoldId = z.infer<typeof legalHoldIdSchema>;
export type ExportJobId = z.infer<typeof exportJobIdSchema>;
export type AuditEventId = z.infer<typeof auditEventIdSchema>;
export type SupportGrantId = z.infer<typeof supportGrantIdSchema>;
export type WebhookEndpointId = z.infer<typeof webhookEndpointIdSchema>;
export type EnterpriseConfigId = z.infer<typeof enterpriseConfigIdSchema>;

export const isoDateTimeSchema = z.string().refine((value) => {
  if (!ISO_8601_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}, 'must be a valid ISO 8601 datetime');

export type IsoDateTime = string;

export function nowIsoDateTime(): IsoDateTime {
  return new Date().toISOString();
}

export const actorKindSchema = z.enum(['user', 'service_account', 'system', 'support']);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const actorRefSchema = z.strictObject({
  kind: actorKindSchema,
  id: commercialIdentifierSchema,
});
export type ActorRef = z.infer<typeof actorRefSchema>;

export const recordFieldsSchema = z.strictObject({
  version: z.number().int().positive(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  created_by: actorRefSchema,
  updated_by: actorRefSchema,
  archived_at: isoDateTimeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const commandContextSchema = z.strictObject({
  request_id: commercialIdentifierSchema,
  actor: actorRefSchema,
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type CommandContext = z.infer<typeof commandContextSchema>;

export const principalSchema = z.strictObject({
  subject_id: commercialIdentifierSchema,
  account_id: accountIdSchema,
  user_id: userIdSchema.optional(),
  service_account_id: serviceAccountIdSchema.optional(),
  session_id: sessionIdSchema.optional(),
  organization_ids: z.array(organizationIdSchema).readonly(),
  scopes: z.array(z.string().min(1).max(200)).readonly(),
  auth_method: z.enum(['session', 'api_key', 'service_account', 'development']),
  issued_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema,
});
export type Principal = z.infer<typeof principalSchema>;

export const capabilityKeySchema = z.enum([
  'identity',
  'hosted_database',
  'payment',
  'hosted_compute',
  'hosted_artifacts',
  'sso',
  'scim',
  'webhooks',
  'customer_managed_keys',
  'private_networking',
]);
export type CapabilityKey = z.infer<typeof capabilityKeySchema>;

export const capabilityAvailabilitySchema = z.enum([
  'available',
  'not_included',
  'not_configured',
  'temporarily_unavailable',
  'not_implemented',
]);
export type CapabilityAvailability = z.infer<typeof capabilityAvailabilitySchema>;

export const capabilityStatusSchema = z.strictObject({
  capability: capabilityKeySchema,
  availability: capabilityAvailabilitySchema,
  adapter: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(2000),
  checked_at: isoDateTimeSchema,
});
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;

export function assertSafeMetadata(metadata: Record<string, unknown> | undefined): void {
  if (metadata === undefined) return;
  const sensitive = /(?:api.?key|access.?token|refresh.?token|id.?token|password|private.?key|authorization|credential(?!_ref)|secret(?!_ref)|cookie)/i;
  for (const [key, value] of Object.entries(metadata)) {
    if (sensitive.test(key)) throw new Error(`sensitive metadata key is not allowed: ${key}`);
    if (typeof value === 'string' && !/^secret_[A-Za-z0-9._:-]+$/.test(value) && sensitive.test(value)) {
      throw new Error(`sensitive metadata value is not allowed: ${key}`);
    }
  }
}

export const activeStateSchema = z.enum(['active', 'suspended', 'revoked', 'archived']);
export type ActiveState = z.infer<typeof activeStateSchema>;
