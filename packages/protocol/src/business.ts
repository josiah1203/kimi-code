/** SpiderByte Business tenancy, role, and budget contracts. */

import { z } from 'zod';

import { isoDateTimeSchema } from './time';
import {
  platformIdentifierSchema,
  platformMetadataSchema,
  runIdSchema,
} from './platform';
import { workspaceIdSchema } from './workspace';

export const organizationIdSchema = platformIdentifierSchema;
export const projectIdSchema = platformIdentifierSchema;
export const budgetIdSchema = platformIdentifierSchema;
export const budgetReservationIdSchema = platformIdentifierSchema;

export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type BudgetId = z.infer<typeof budgetIdSchema>;
export type BudgetReservationId = z.infer<typeof budgetReservationIdSchema>;

export const businessRoleSchema = z.enum([
  'organization_owner',
  'organization_administrator',
  'billing_administrator',
  'security_policy_administrator',
  'project_administrator',
  'operator',
  'approver',
  'member',
  'viewer',
]);

export type BusinessRole = z.infer<typeof businessRoleSchema>;

export const organizationModeSchema = z.enum(['local', 'hosted']);
export type OrganizationMode = z.infer<typeof organizationModeSchema>;

export const organizationSchema = z.strictObject({
  id: organizationIdSchema,
  name: z.string().min(1).max(200),
  mode: organizationModeSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type Organization = z.infer<typeof organizationSchema>;

export const organizationMemberSchema = z.strictObject({
  organization_id: organizationIdSchema,
  member_id: platformIdentifierSchema,
  role: businessRoleSchema,
  joined_at: isoDateTimeSchema,
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const organizationMemberUpsertInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  organization_id: organizationIdSchema,
  member_id: platformIdentifierSchema,
  role: businessRoleSchema,
});

export type OrganizationMemberUpsertInput = z.infer<typeof organizationMemberUpsertInputSchema>;

export const projectStateSchema = z.enum(['active', 'archived']);
export type ProjectState = z.infer<typeof projectStateSchema>;

export const projectSchema = z.strictObject({
  id: projectIdSchema,
  organization_id: organizationIdSchema,
  name: z.string().min(1).max(200),
  state: projectStateSchema,
  workspace_ids: z.array(workspaceIdSchema),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type Project = z.infer<typeof projectSchema>;

export const projectMemberSchema = z.strictObject({
  project_id: projectIdSchema,
  member_id: platformIdentifierSchema,
  role: businessRoleSchema,
  joined_at: isoDateTimeSchema,
});

export type ProjectMember = z.infer<typeof projectMemberSchema>;

/**
 * A project-owned reference to a platform resource.
 *
 * Bindings deliberately contain only opaque IDs. Provider credentials and
 * other secret material remain owned by SecretStore or the resource service;
 * they must never be copied into a Project or Workspace projection.
 */
export const projectBindingKindSchema = z.enum([
  'llm_connection',
  'execution_connection',
  'data_connection',
  'plugin_connection',
  'source_control_connection',
  'cloud_connection',
  'custom_api_connection',
  'external_agent_connection',
  'model',
  'execution_target',
  'policy',
  'budget',
  'entitlement',
  'artifact_retention',
  'automation',
]);

export type ProjectBindingKind = z.infer<typeof projectBindingKindSchema>;

export const projectBindingRoleSchema = z.enum([
  'default',
  'fallback',
  'allowed',
  'read',
  'write',
  'execute',
  'notify',
  'govern',
  'retain',
]);

export type ProjectBindingRole = z.infer<typeof projectBindingRoleSchema>;

export const projectBindingStateSchema = z.enum(['active', 'disabled']);
export type ProjectBindingState = z.infer<typeof projectBindingStateSchema>;

export const projectBindingSchema = z.strictObject({
  id: platformIdentifierSchema,
  project_id: projectIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  kind: projectBindingKindSchema,
  resource_id: platformIdentifierSchema,
  role: projectBindingRoleSchema,
  state: projectBindingStateSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type ProjectBinding = z.infer<typeof projectBindingSchema>;

export const projectBindingCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  kind: projectBindingKindSchema,
  resource_id: platformIdentifierSchema,
  role: projectBindingRoleSchema,
});

export type ProjectBindingCreateInput = z.input<typeof projectBindingCreateInputSchema>;

export const projectBindingRemoveInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  binding_id: platformIdentifierSchema,
});

export type ProjectBindingRemoveInput = z.infer<typeof projectBindingRemoveInputSchema>;

export const platformIdentityModeSchema = z.enum(['local', 'hosted']);
export type PlatformIdentityMode = z.infer<typeof platformIdentityModeSchema>;

export const platformIdentityStatusSchema = z.strictObject({
  mode: platformIdentityModeSchema,
  authenticated: z.boolean(),
  credential_class: z.literal('account'),
  authority: z.string().url().optional(),
  expires_at: z.number().int().positive().optional(),
});

export type PlatformIdentityStatus = z.infer<typeof platformIdentityStatusSchema>;

export const platformIdentityPkceStartSchema = z.strictObject({
  flow_id: platformIdentifierSchema,
  authorization_url: z.string().url(),
  state: z.string().min(1),
  code_verifier: z.string().min(1),
  redirect_uri: z.string().url(),
  expires_at: isoDateTimeSchema,
});

export type PlatformIdentityPkceStart = z.infer<typeof platformIdentityPkceStartSchema>;

export const platformIdentityPkceCompleteInputSchema = z.strictObject({
  flow_id: platformIdentifierSchema,
  state: z.string().min(1),
  code: z.string().min(1),
});

export type PlatformIdentityPkceCompleteInput = z.infer<typeof platformIdentityPkceCompleteInputSchema>;

export const platformIdentityDeviceStartSchema = z.strictObject({
  flow_id: platformIdentifierSchema,
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});

export type PlatformIdentityDeviceStart = z.infer<typeof platformIdentityDeviceStartSchema>;

export const platformIdentityDevicePollInputSchema = z.strictObject({
  flow_id: platformIdentifierSchema,
});

export type PlatformIdentityDevicePollInput = z.infer<typeof platformIdentityDevicePollInputSchema>;

export const platformIdentityDevicePollResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('authenticated'), identity: platformIdentityStatusSchema }),
  z.strictObject({ status: z.literal('pending'), retry_after: z.number().int().positive() }),
  z.strictObject({ status: z.literal('expired') }),
  z.strictObject({ status: z.literal('denied'), reason: z.string() }),
]);

export type PlatformIdentityDevicePollResult = z.infer<typeof platformIdentityDevicePollResultSchema>;

export const platformIdentityLogoutResultSchema = z.strictObject({
  logged_out: z.boolean(),
  identity: platformIdentityStatusSchema,
});

export type PlatformIdentityLogoutResult = z.infer<typeof platformIdentityLogoutResultSchema>;

export const platformCapabilitySchema = z.enum([
  'project.read',
  'project.manage',
  'workspace.read',
  'connection.read',
  'connection.manage',
  'connection.use',
  'model.select',
  'data.read',
  'data.write',
  'execution.execute',
  'plugin.install',
  'automation.manage',
  'run.execute',
  'approval.grant',
  'usage.read',
  'budget.manage',
  'audit.read',
  'member.manage',
  'policy.manage',
]);

export type PlatformCapability = z.infer<typeof platformCapabilitySchema>;

export const platformAuthorizationEvaluateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  capability: platformCapabilitySchema,
});

export type PlatformAuthorizationEvaluateInput = z.infer<typeof platformAuthorizationEvaluateInputSchema>;

export const platformAuthorizationDecisionSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  organization_id: organizationIdSchema,
  project_id: projectIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  capability: platformCapabilitySchema,
  allowed: z.boolean(),
  role: businessRoleSchema.optional(),
  reason: z.string().min(1),
});

export type PlatformAuthorizationDecision = z.infer<typeof platformAuthorizationDecisionSchema>;

/** Provider-neutral Business plugin manifest and lifecycle projections. */
export const platformPluginProviderTypeSchema = z.string().min(1).max(64).regex(
  /^[a-z][a-z0-9._-]*$/,
);
export type PlatformPluginProviderType = z.infer<typeof platformPluginProviderTypeSchema>;

export const platformPluginAuthenticationSchema = z.strictObject({
  kind: z.enum(['oauth2', 'device_code', 'api_key', 'bot_token', 'webhook_signature', 'none']),
  scopes: z.array(z.string().min(1).max(200)).default([]),
});

export type PlatformPluginAuthentication = z.infer<typeof platformPluginAuthenticationSchema>;

export const platformPluginWebhookRouteSchema = z.strictObject({
  path: z.string().min(1).max(200),
  events: z.array(z.string().min(1).max(100)).default([]),
});

export type PlatformPluginWebhookRoute = z.infer<typeof platformPluginWebhookRouteSchema>;

export const platformPluginCommandSchema = z.strictObject({
  id: platformIdentifierSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  capability: platformCapabilitySchema.optional(),
});

export type PlatformPluginCommand = z.infer<typeof platformPluginCommandSchema>;

export const platformPluginRateLimitSchema = z.strictObject({
  requests_per_minute: z.number().int().positive(),
  burst: z.number().int().positive().optional(),
});

export type PlatformPluginRateLimit = z.infer<typeof platformPluginRateLimitSchema>;

export const platformPluginManifestSchema = z.strictObject({
  id: platformIdentifierSchema,
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(100),
  provider_type: platformPluginProviderTypeSchema,
  authentication: platformPluginAuthenticationSchema,
  scopes: z.array(z.string().min(1).max(200)).default([]),
  configuration_schema: z.record(z.string(), z.unknown()).default({}),
  required_secret_refs: z.array(platformIdentifierSchema).default([]),
  webhook_routes: z.array(platformPluginWebhookRouteSchema).default([]),
  events: z.array(z.string().min(1).max(100)).default([]),
  commands: z.array(platformPluginCommandSchema).default([]),
  capabilities: z.array(platformCapabilitySchema).default([]),
  run_actions: z.array(z.string().min(1).max(100)).default([]),
  attachment_types: z.array(z.string().min(1).max(100)).default([]),
  rate_limit: platformPluginRateLimitSchema.optional(),
  privacy_requirements: z.array(z.string().min(1).max(500)).default([]),
});

export type PlatformPluginManifest = z.infer<typeof platformPluginManifestSchema>;

export const platformPluginStateSchema = z.enum([
  'installed',
  'configured',
  'authorized',
  'active',
  'paused',
  'revoked',
  'uninstalled',
  'failed',
]);

export type PlatformPluginState = z.infer<typeof platformPluginStateSchema>;

export const platformPluginSchema = z.strictObject({
  id: platformIdentifierSchema,
  project_id: projectIdSchema,
  manifest: platformPluginManifestSchema,
  connection_id: platformIdentifierSchema.optional(),
  state: platformPluginStateSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  last_validation_at: isoDateTimeSchema.optional(),
  revoked_at: isoDateTimeSchema.optional(),
});

export type PlatformPlugin = z.infer<typeof platformPluginSchema>;

export const platformPluginDiscoverInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  manifest: platformPluginManifestSchema,
});

export type PlatformPluginDiscoverInput = z.infer<typeof platformPluginDiscoverInputSchema>;

export const platformPluginInstallInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  manifest: platformPluginManifestSchema,
});

export type PlatformPluginInstallInput = z.infer<typeof platformPluginInstallInputSchema>;

export const platformPluginConfigureInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  plugin_id: platformIdentifierSchema,
  connection_id: platformIdentifierSchema,
});

export type PlatformPluginConfigureInput = z.infer<typeof platformPluginConfigureInputSchema>;

export const platformPluginCommandInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  plugin_id: platformIdentifierSchema,
  action: z.enum(['activate', 'pause', 'revoke', 'uninstall']),
});

export type PlatformPluginCommandInput = z.infer<typeof platformPluginCommandInputSchema>;

export const projectMemberUpsertInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  project_id: projectIdSchema,
  member_id: platformIdentifierSchema,
  role: businessRoleSchema,
});

export type ProjectMemberUpsertInput = z.infer<typeof projectMemberUpsertInputSchema>;

export const organizationCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  name: z.string().min(1).max(200),
  mode: organizationModeSchema.default('local'),
  metadata: platformMetadataSchema.optional(),
});

export type OrganizationCreateInput = z.input<typeof organizationCreateInputSchema>;

export const projectCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  organization_id: organizationIdSchema,
  name: z.string().min(1).max(200),
  metadata: platformMetadataSchema.optional(),
});

export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;

export const projectWorkspaceBindInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
});

export type ProjectWorkspaceBindInput = z.infer<typeof projectWorkspaceBindInputSchema>;

export const budgetScopeSchema = z.enum([
  'organization',
  'project',
  'workspace',
  'user',
  'provider_model',
  'execution_target',
  'run',
]);

export type BudgetScope = z.infer<typeof budgetScopeSchema>;

export const budgetMeterSchema = z.enum([
  'managed_llm',
  'managed_compute',
  'customer_cloud_execution',
  'artifact_storage',
  'plugin_usage',
]);

export type BudgetMeter = z.infer<typeof budgetMeterSchema>;

export const budgetUnitSchema = z.enum(['usd', 'seconds', 'units']);
export type BudgetUnit = z.infer<typeof budgetUnitSchema>;

export const budgetStateSchema = z.enum([
  'available',
  'reserved',
  'consumed',
  'reconciled',
  'exceeded',
  'released',
  'blocked',
]);

export type BudgetState = z.infer<typeof budgetStateSchema>;

export const budgetThresholdsSchema = z.strictObject({
  warning_percent: z.number().finite().min(0).max(100).default(50),
  notification_percent: z.number().finite().min(0).max(100).default(80),
  approval_percent: z.number().finite().min(0).max(100).default(90),
  hard_limit_percent: z.number().finite().min(0).max(100).default(100),
});

export type BudgetThresholds = z.infer<typeof budgetThresholdsSchema>;

export const budgetSchema = z.strictObject({
  id: budgetIdSchema,
  scope: budgetScopeSchema,
  scope_id: platformIdentifierSchema,
  meter: budgetMeterSchema,
  unit: budgetUnitSchema,
  limit: z.number().finite().nonnegative(),
  reserved: z.number().finite().nonnegative(),
  consumed: z.number().finite().nonnegative(),
  state: budgetStateSchema,
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  thresholds: budgetThresholdsSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type Budget = z.infer<typeof budgetSchema>;

export const budgetConfigureInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  scope: budgetScopeSchema,
  scope_id: platformIdentifierSchema,
  meter: budgetMeterSchema,
  unit: budgetUnitSchema,
  limit: z.number().finite().nonnegative(),
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  thresholds: budgetThresholdsSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type BudgetConfigureInput = z.input<typeof budgetConfigureInputSchema>;

export const budgetReservationStateSchema = z.enum([
  'requested',
  'estimated',
  'reserved',
  'approval_required',
  'consumed',
  'reconciled',
  'released',
  'exceeded',
  'blocked',
]);

export type BudgetReservationState = z.infer<typeof budgetReservationStateSchema>;

export const budgetReservationSchema = z.strictObject({
  id: budgetReservationIdSchema,
  budget_id: budgetIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: runIdSchema,
  request_id: platformIdentifierSchema,
  scope: budgetScopeSchema,
  scope_id: platformIdentifierSchema,
  meter: budgetMeterSchema,
  unit: budgetUnitSchema,
  estimated_amount: z.number().finite().nonnegative(),
  reserved_amount: z.number().finite().nonnegative(),
  actual_amount: z.number().finite().nonnegative().optional(),
  state: budgetReservationStateSchema,
  policy_decision_id: platformIdentifierSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type BudgetReservation = z.infer<typeof budgetReservationSchema>;

export const budgetReserveInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  run_id: runIdSchema,
  scope: budgetScopeSchema,
  scope_id: platformIdentifierSchema,
  meter: budgetMeterSchema,
  unit: budgetUnitSchema,
  amount: z.number().finite().nonnegative(),
  budget_id: budgetIdSchema.optional(),
  policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type BudgetReserveInput = z.infer<typeof budgetReserveInputSchema>;

export const budgetReservationResultSchema = z.strictObject({
  reservation: budgetReservationSchema,
  status: z.enum(['reserved', 'approval_required', 'blocked', 'unbudgeted']),
  warnings: z.array(z.string()),
});

export type BudgetReservationResult = z.infer<typeof budgetReservationResultSchema>;

export const budgetReleaseInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  reservation_id: budgetReservationIdSchema,
});

export type BudgetReleaseInput = z.infer<typeof budgetReleaseInputSchema>;

export const budgetReconcileInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  reservation_id: budgetReservationIdSchema,
  actual_amount: z.number().finite().nonnegative(),
});

export type BudgetReconcileInput = z.infer<typeof budgetReconcileInputSchema>;

export const budgetStatusSchema = z.strictObject({
  workspace_id: workspaceIdSchema,
  budgets: z.array(budgetSchema),
  reservations: z.array(budgetReservationSchema),
  warnings: z.array(z.string()),
  updated_at: isoDateTimeSchema,
});

export type BudgetStatus = z.infer<typeof budgetStatusSchema>;
