import { z } from 'zod';

import {
  accountIdSchema,
  actorRefSchema,
  artifactIdSchema,
  auditEventIdSchema,
  enterpriseConfigIdSchema,
  exportJobIdSchema,
  isoDateTimeSchema,
  legalHoldIdSchema,
  modelAccessPolicyIdSchema,
  organizationIdSchema,
  providerConnectionIdSchema,
  recordFieldsSchema,
  retentionPolicyIdSchema,
  supportGrantIdSchema,
  userIdSchema,
  webhookEndpointIdSchema,
  workspaceIdSchema,
} from './common';

export const providerConnectionStateSchema = z.enum(['configured', 'validated', 'active', 'revoked']);
export const providerConnectionSchema = z.strictObject({
  id: providerConnectionIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  provider: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  state: providerConnectionStateSchema,
  secret_ref: z.string().regex(/^secret_[A-Za-z0-9._:-]+$/),
  endpoint_ref: z.string().url().optional(),
  allowed_models: z.array(z.string().min(1).max(500)).readonly(),
  ...recordFieldsSchema.shape,
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

export const modelAccessPolicySchema = z.strictObject({
  id: modelAccessPolicyIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  provider_connection_id: providerConnectionIdSchema,
  model_patterns: z.array(z.string().min(1).max(500)).min(1).readonly(),
  effect: z.enum(['allow', 'deny']),
  state: z.enum(['active', 'archived']),
  ...recordFieldsSchema.shape,
});
export type ModelAccessPolicy = z.infer<typeof modelAccessPolicySchema>;

export const hostedArtifactStateSchema = z.enum(['pending', 'available', 'deleting', 'deleted', 'blocked']);
export const hostedArtifactSchema = z.strictObject({
  id: artifactIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: z.string().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(500),
  content_address: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  object_ref: z.string().min(1).max(1000),
  media_type: z.string().min(1).max(200),
  size_bytes: z.number().int().nonnegative(),
  state: hostedArtifactStateSchema,
  retention_policy_id: retentionPolicyIdSchema.optional(),
  legal_hold_ids: z.array(legalHoldIdSchema).readonly(),
  deleted_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type HostedArtifact = z.infer<typeof hostedArtifactSchema>;

export const retentionPolicySchema = z.strictObject({
  id: retentionPolicyIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  retention_days: z.number().int().nonnegative(),
  delete_after_expiry: z.boolean(),
  state: z.enum(['active', 'archived']),
  ...recordFieldsSchema.shape,
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const legalHoldSchema = z.strictObject({
  id: legalHoldIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  artifact_ids: z.array(artifactIdSchema).readonly(),
  reason: z.string().trim().min(1).max(2000),
  state: z.enum(['active', 'released']),
  released_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type LegalHold = z.infer<typeof legalHoldSchema>;

export const exportJobSchema = z.strictObject({
  id: exportJobIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  requested_by: actorRefSchema,
  scope: z.enum(['organization', 'workspace', 'billing', 'audit']),
  state: z.enum(['requested', 'running', 'succeeded', 'failed', 'expired']),
  object_ref: z.string().min(1).max(1000).optional(),
  expires_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const auditOutcomeSchema = z.enum(['allowed', 'denied', 'succeeded', 'failed']);
export const auditEventSchema = z.strictObject({
  id: auditEventIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema.optional(),
  workspace_id: workspaceIdSchema.optional(),
  actor: actorRefSchema,
  action: z.string().trim().min(1).max(300),
  target_type: z.string().trim().min(1).max(100),
  target_id: z.string().trim().min(1).max(256),
  outcome: auditOutcomeSchema,
  request_id: z.string().trim().min(1).max(500),
  occurred_at: isoDateTimeSchema,
  sequence: z.number().int().positive(),
  previous_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  integrity_hash: z.string().regex(/^[a-f0-9]{64}$/),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const supportAccessGrantSchema = z.strictObject({
  id: supportGrantIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  granting_actor: actorRefSchema,
  support_actor: actorRefSchema,
  reason: z.string().trim().min(1).max(2000),
  scope: z.array(z.string().min(1).max(500)).min(1).readonly(),
  state: z.enum(['pending_approval', 'active', 'expired', 'revoked']),
  expires_at: isoDateTimeSchema,
  approved_by: actorRefSchema.optional(),
  revoked_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type SupportAccessGrant = z.infer<typeof supportAccessGrantSchema>;

export const webhookEndpointSchema = z.strictObject({
  id: webhookEndpointIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  url: z.string().url(),
  secret_ref: z.string().regex(/^secret_[A-Za-z0-9._:-]+$/),
  event_types: z.array(z.string().min(1).max(200)).min(1).readonly(),
  state: z.enum(['active', 'paused', 'revoked']),
  last_delivery_at: isoDateTimeSchema.optional(),
  failure_count: z.number().int().nonnegative(),
  ...recordFieldsSchema.shape,
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const enterpriseConfigurationSchema = z.strictObject({
  id: enterpriseConfigIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  identity_provider_id: z.string().regex(/^idp_[A-Za-z0-9._:-]{2,127}$/).optional(),
  verified_domain_ids: z.array(z.string().regex(/^domain_[A-Za-z0-9._:-]{2,127}$/)).readonly(),
  group_role_mappings: z.record(z.string().min(1).max(500), z.array(z.string().regex(/^role_[A-Za-z0-9._:-]{2,127}$/)).readonly()),
  enforced_sso: z.boolean(),
  mfa_required: z.boolean(),
  ip_allowlist: z.array(z.string().min(1).max(100)).readonly(),
  api_restrictions: z.array(z.string().min(1).max(200)).readonly(),
  legal_hold_provider_ref: z.string().min(1).max(500).optional(),
  backup_policy_ref: z.string().min(1).max(500).optional(),
  data_residency: z.string().min(1).max(100).optional(),
  encryption_mode: z.enum(['platform_managed', 'customer_managed']).default('platform_managed'),
  kms_key_ref: z.string().min(1).max(500).optional(),
  private_network_ref: z.string().min(1).max(500).optional(),
  deployment_mode: z.enum(['shared', 'regional', 'dedicated']),
  release_channel: z.enum(['stable', 'preview', 'pinned']),
  state: z.enum(['draft', 'configured', 'active', 'restricted']),
  ...recordFieldsSchema.shape,
}).superRefine((value, context) => {
  if (value.encryption_mode === 'customer_managed' && value.kms_key_ref === undefined) {
    context.addIssue({ code: 'custom', path: ['kms_key_ref'], message: 'customer-managed encryption requires a KMS key reference' });
  }
  if (value.enforced_sso && value.identity_provider_id === undefined) {
    context.addIssue({ code: 'custom', path: ['identity_provider_id'], message: 'enforced SSO requires an identity provider' });
  }
  if (value.deployment_mode !== 'shared' && value.data_residency === undefined) {
    context.addIssue({ code: 'custom', path: ['data_residency'], message: 'regional and dedicated deployments require data residency' });
  }
});
export type EnterpriseConfiguration = z.infer<typeof enterpriseConfigurationSchema>;

export const createApiKeyInputSchema = z.object({
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  owner_user_id: userIdSchema.optional(),
  service_account_id: z.string().regex(/^svc_[A-Za-z0-9._:-]{2,127}$/).optional(),
  name: z.string().trim().min(1).max(200),
  scopes: z.array(z.string().min(1).max(200)).min(1).readonly(),
  expires_at: isoDateTimeSchema.optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;

export const createUsageEventInputSchema = z.object({
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  user_id: userIdSchema.optional(),
  resource_type: z.string().trim().min(1).max(100),
  reserved_amount: z.number().finite().nonnegative(),
  actual_amount: z.number().finite().nonnegative(),
  unit: z.enum(['seconds', 'bytes', 'tokens', 'requests', 'units', 'seats', 'minor_currency']),
  idempotency_key: z.string().trim().min(8).max(500),
  source_event_id: z.string().trim().min(1).max(500),
  source: z.enum(['worker', 'provider', 'api', 'storage', 'billing', 'manual_adjustment']),
});
export type CreateUsageEventInput = z.infer<typeof createUsageEventInputSchema>;

export const COMMERCIAL_ACTIONS = [
  'organization.read',
  'organization.manage',
  'workspace.read',
  'workspace.manage',
  'member.read',
  'member.manage',
  'billing.read',
  'billing.manage',
  'usage.read',
  'usage.write',
  'artifact.read',
  'artifact.write',
  'compute.submit',
  'compute.cancel',
  'provider.use',
  'provider.manage',
  'policy.read',
  'policy.manage',
  'audit.read',
  'support.grant',
  'enterprise.manage',
  'license.read',
  'license.manage',
  'seat.manage',
 ] as const;
export const commercialActionSchema = z.enum(COMMERCIAL_ACTIONS);
export type CommercialAction = z.infer<typeof commercialActionSchema>;

export const authorizationDecisionSchema = z.strictObject({
  allowed: z.boolean(),
  action: commercialActionSchema,
  reason: z.string().min(1).max(2000),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema.optional(),
  workspace_id: workspaceIdSchema.optional(),
  actor: actorRefSchema,
  evaluated_at: isoDateTimeSchema,
});
export type AuthorizationDecision = z.infer<typeof authorizationDecisionSchema>;
