import { z } from 'zod';

import {
  workspaceIdSchema,
  workspaceLifecycleStateSchema,
} from './workspace';
import { isoDateTimeSchema } from './time';

/**
 * Stable identifiers for the platform contract layer.
 *
 * Existing legacy ids (including `wd_...` workspace ids) remain valid. The
 * platform layer deliberately does not require a particular id generator so
 * that local persistence and remote services can share the same contract.
 */
export const platformIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: 'platform identifiers must contain only letters, numbers, . _ : or -',
  });

export type PlatformIdentifier = z.infer<typeof platformIdentifierSchema>;

export const agentSessionIdSchema = platformIdentifierSchema;
export const runIdSchema = platformIdentifierSchema;
export const artifactIdSchema = platformIdentifierSchema;
export const providerConnectionIdSchema = platformIdentifierSchema;
export const providerSecretRefSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^secret_[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: 'provider secrets must be represented by a secret_<reference> identifier',
  });
export const resourceIdSchema = platformIdentifierSchema;
export const policyDecisionIdSchema = platformIdentifierSchema;
export const usageRecordIdSchema = platformIdentifierSchema;
export const executionTargetIdSchema = platformIdentifierSchema;

export type AgentSessionId = z.infer<typeof agentSessionIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type ProviderConnectionId = z.infer<typeof providerConnectionIdSchema>;
export type ProviderSecretRef = z.infer<typeof providerSecretRefSchema>;

/**
 * Secret-free reference to a concrete provider model.  ProviderConnection is
 * the authority for credentials and endpoint configuration; ModelRef is the
 * stable selection value carried by Runs, wire projections, and clients.
 */
export const modelRefSchema = z.strictObject({
  provider_connection_id: providerConnectionIdSchema,
  // Provider model ids commonly contain `/`, `@`, or other vendor-specific
  // separators, so only length/non-empty validation belongs at this boundary.
  model: z.string().min(1).max(256),
});

export type ModelRef = z.infer<typeof modelRefSchema>;

/** Secret-free active model selection projected to agent/client surfaces. */
export const platformModelSelectionSchema = z.strictObject({
  model_ref: modelRefSchema,
  fallback_connection_ids: z.array(providerConnectionIdSchema).readonly().default([]),
  policy_decision_id: policyDecisionIdSchema.optional(),
});

export type PlatformModelSelection = z.infer<typeof platformModelSelectionSchema>;

/**
 * Opaque sentinel for providers that intentionally do not use a credential
 * (for example, an unauthenticated local OpenAI-compatible endpoint). It is a
 * reference-shaped value for wire compatibility, but it is never stored in
 * the platform secret vault or resolved as credential material.
 */
export const PLATFORM_NO_CREDENTIAL_SECRET_REF = 'secret_none' as ProviderSecretRef;
export type ResourceId = z.infer<typeof resourceIdSchema>;
export type PolicyDecisionId = z.infer<typeof policyDecisionIdSchema>;
export type UsageRecordId = z.infer<typeof usageRecordIdSchema>;
export type ExecutionTargetId = z.infer<typeof executionTargetIdSchema>;

export const platformMetadataSchema = z.record(z.string(), z.unknown());
export type PlatformMetadata = z.infer<typeof platformMetadataSchema>;

export const platformActorSchema = z.enum(['user', 'agent', 'system', 'automation', 'policy']);
export type PlatformActor = z.infer<typeof platformActorSchema>;

export const platformWorkspaceSchema = z.strictObject({
  id: workspaceIdSchema,
  root: z.string().min(1),
  name: z.string().min(1).max(100),
  state: workspaceLifecycleStateSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  last_opened_at: isoDateTimeSchema,
  session_count: z.number().int().nonnegative(),
  metadata: platformMetadataSchema.optional(),
});

export type PlatformWorkspace = z.infer<typeof platformWorkspaceSchema>;

export const agentSessionStateSchema = z.enum([
  'created',
  'active',
  'paused',
  'completed',
  'closed',
]);

export type AgentSessionState = z.infer<typeof agentSessionStateSchema>;

/**
 * Platform projection of the existing session. The v1 Session object
 * remains unchanged at the transport boundary; adapters map it to this
 * durable AgentSession projection.
 */
export const agentSessionSchema = z.strictObject({
  id: agentSessionIdSchema,
  workspace_id: workspaceIdSchema,
  title: z.string().max(500),
  state: agentSessionStateSchema,
  cwd: z.string().min(1),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  active_run_id: runIdSchema.optional(),
  run_count: z.number().int().nonnegative(),
  metadata: platformMetadataSchema.optional(),
});

export type AgentSession = z.infer<typeof agentSessionSchema>;

export const resourceTypeSchema = z.enum([
  'dataset',
  'table',
  'query',
  'notebook',
  'visualization',
  'experiment',
  'model',
  'evaluation',
  'pipeline',
  'endpoint',
]);

export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const resourceStateSchema = z.enum(['draft', 'running', 'ready', 'failed', 'archived']);
export type ResourceState = z.infer<typeof resourceStateSchema>;

export const resourceRefSchema = z.strictObject({
  id: resourceIdSchema,
  type: resourceTypeSchema,
  version: z.number().int().positive().optional(),
});

export type ResourceRef = z.infer<typeof resourceRefSchema>;

export const resourceSchema = z.strictObject({
  id: resourceIdSchema,
  workspace_id: workspaceIdSchema,
  type: resourceTypeSchema,
  name: z.string().min(1).max(500),
  state: resourceStateSchema,
  version: z.number().int().positive(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  artifact_ids: z.array(artifactIdSchema).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type Resource = z.infer<typeof resourceSchema>;

export const resourceCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  type: resourceTypeSchema,
  name: z.string().min(1).max(500),
  metadata: platformMetadataSchema.optional(),
});

export type ResourceCreateInput = z.infer<typeof resourceCreateInputSchema>;

export const resourceUpdateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(500).optional(),
  state: resourceStateSchema.optional(),
  artifact_ids: z.array(artifactIdSchema).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ResourceUpdateInput = z.infer<typeof resourceUpdateInputSchema>;

export const resourceExecuteInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  action: z.string().min(1).max(500),
  parameters: platformMetadataSchema.optional(),
  policy_decision_id: policyDecisionIdSchema.optional(),
});

export type ResourceExecuteInput = z.infer<typeof resourceExecuteInputSchema>;

export const resourceExecutionStatusSchema = z.enum([
  'accepted',
  'awaiting_approval',
  'completed',
  'failed',
]);

export type ResourceExecutionStatus = z.infer<typeof resourceExecutionStatusSchema>;

export const resourceExecutionSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  resource_id: resourceIdSchema,
  run_id: runIdSchema.optional(),
  status: resourceExecutionStatusSchema,
  policy_decision_id: policyDecisionIdSchema.optional(),
  output_artifact_ids: z.array(artifactIdSchema).optional(),
  metrics: platformMetadataSchema.optional(),
  started_at: isoDateTimeSchema,
  completed_at: isoDateTimeSchema.optional(),
  error: z.string().max(2_000).optional(),
});

export type ResourceExecution = z.infer<typeof resourceExecutionSchema>;

export const artifactRefSchema = z.strictObject({
  id: artifactIdSchema,
  version: z.number().int().positive(),
});

export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const artifactKindSchema = z.enum([
  'file',
  'directory',
  'dataset',
  'table',
  'notebook',
  'visualization',
  'model',
  'metrics',
  'log',
  'bundle',
  'other',
]);

export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactSchema = z.strictObject({
  id: artifactIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: runIdSchema.optional(),
  name: z.string().min(1).max(500),
  kind: artifactKindSchema,
  version: z.number().int().positive(),
  content_ref: z.string().min(1),
  media_type: z.string().min(1).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  created_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema.optional(),
  source_artifact_ids: z.array(artifactIdSchema).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type Artifact = z.infer<typeof artifactSchema>;

export const artifactCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  name: z.string().min(1).max(500),
  kind: artifactKindSchema,
  content_base64: z.string(),
  media_type: z.string().min(1).optional(),
  expires_at: isoDateTimeSchema.optional(),
  source_artifact_ids: z.array(artifactIdSchema).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ArtifactCreateInput = z.infer<typeof artifactCreateInputSchema>;

export const artifactExpireInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  expires_at: isoDateTimeSchema,
});

export type ArtifactExpireInput = z.infer<typeof artifactExpireInputSchema>;

export const artifactDownloadSchema = z.strictObject({
  artifact: artifactSchema,
  content_base64: z.string(),
});

export type ArtifactDownload = z.infer<typeof artifactDownloadSchema>;

/** A bounded byte-range response for large reports, tables, and model files. */
export const artifactDownloadRangeInputSchema = z.strictObject({
  start: z.number().int().nonnegative().default(0),
  end: z.number().int().nonnegative().optional(),
});

export type ArtifactDownloadRangeInput = z.infer<typeof artifactDownloadRangeInputSchema>;

export const artifactDownloadChunkSchema = z.strictObject({
  artifact: artifactSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  content_base64: z.string(),
  complete: z.boolean(),
});

export type ArtifactDownloadChunk = z.infer<typeof artifactDownloadChunkSchema>;

export const artifactLineageSchema = z.strictObject({
  artifact: artifactSchema,
  upstream_artifacts: z.array(artifactSchema),
  downstream_artifacts: z.array(artifactSchema),
  downstream_run_ids: z.array(runIdSchema),
});

export type ArtifactLineage = z.infer<typeof artifactLineageSchema>;

export const runStatusSchema = z.enum([
  'queued',
  'planning',
  'awaiting_approval',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

export const runPlanStepStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'failed',
  'skipped',
]);

export const runPlanStepSchema = z.strictObject({
  id: platformIdentifierSchema,
  title: z.string().min(1).max(500),
  status: runPlanStepStatusSchema,
});

export type RunPlanStep = z.infer<typeof runPlanStepSchema>;

export const runSchema = z.strictObject({
  id: runIdSchema,
  workspace_id: workspaceIdSchema,
  agent_session_id: agentSessionIdSchema,
  request_id: platformIdentifierSchema.optional(),
  parent_run_id: runIdSchema.optional(),
  status: runStatusSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  started_at: isoDateTimeSchema.optional(),
  completed_at: isoDateTimeSchema.optional(),
  plan: z.array(runPlanStepSchema).optional(),
  input_resources: z.array(resourceRefSchema).optional(),
  output_artifacts: z.array(artifactRefSchema).optional(),
  policy_decision_ids: z.array(policyDecisionIdSchema).optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  status_reason: z.string().max(2_000).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type Run = z.infer<typeof runSchema>;

/** Input for the first durable Run command. Mutations carry a request id. */
export const runCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  parent_run_id: runIdSchema.optional(),
  plan: z.array(runPlanStepSchema).optional(),
  input_resources: z.array(resourceRefSchema).optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type RunCreateInput = z.infer<typeof runCreateInputSchema>;

/** State transition command; the service enforces the legal transition graph. */
export const runTransitionInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  status: runStatusSchema,
  status_reason: z.string().max(2_000).optional(),
  plan: z.array(runPlanStepSchema).optional(),
  input_resources: z.array(resourceRefSchema).optional(),
  output_artifacts: z.array(artifactRefSchema).optional(),
  policy_decision_ids: z.array(policyDecisionIdSchema).optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type RunTransitionInput = z.infer<typeof runTransitionInputSchema>;

export const runActionInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  metadata: platformMetadataSchema.optional(),
});

export type RunActionInput = z.infer<typeof runActionInputSchema>;

export const runForkInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  plan: z.array(runPlanStepSchema).optional(),
  input_resources: z.array(resourceRefSchema).optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type RunForkInput = z.infer<typeof runForkInputSchema>;

export const providerConnectionProviderSchema = z.enum([
  'kimi',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'openai-compatible',
  'local',
  'custom',
]);

export type ProviderConnectionProvider = z.infer<typeof providerConnectionProviderSchema>;

export const providerConnectionScopeSchema = z.enum(['workspace', 'member']);
export const providerConnectionStateSchema = z.enum([
  'configured',
  'validated',
  'active',
  'revoked',
]);

export type ProviderConnectionState = z.infer<typeof providerConnectionStateSchema>;

/**
 * Provider connections contain references to secrets, never secret material.
 * The strict object is intentional: adding `api_key`, `token`, or equivalent
 * fields to this public projection must fail contract validation.
 */
export const providerConnectionSchema = z.strictObject({
  id: providerConnectionIdSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(200),
  provider: providerConnectionProviderSchema,
  scope: providerConnectionScopeSchema,
  state: providerConnectionStateSchema,
  secret_ref: providerSecretRefSchema,
  capabilities: z.array(z.string().min(1)),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  validated_at: isoDateTimeSchema.optional(),
  revoked_at: isoDateTimeSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

export const providerModelSchema = z.strictObject({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(500).optional(),
  capabilities: z.array(z.string().min(1)),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderModel = z.infer<typeof providerModelSchema>;

export const providerModelDiscoverySchema = z.strictObject({
  connection_id: providerConnectionIdSchema,
  models: z.array(providerModelSchema),
  discovered_at: isoDateTimeSchema,
});

export type ProviderModelDiscovery = z.infer<typeof providerModelDiscoverySchema>;

export const providerConnectionCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200),
  provider: providerConnectionProviderSchema,
  scope: providerConnectionScopeSchema,
  secret_ref: providerSecretRefSchema,
  capabilities: z.array(z.string().min(1)).default([]),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderConnectionCreateInput = z.input<typeof providerConnectionCreateInputSchema>;

/**
 * Setup input is accepted only at the command edge. The resulting connection
 * projection contains an opaque `secret_*` reference, never this field.
 */
export const providerConnectionCreateWithSecretInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200),
  provider: providerConnectionProviderSchema,
  scope: providerConnectionScopeSchema,
  secret: z.string().min(1).max(64 * 1024),
  capabilities: z.array(z.string().min(1)).default([]),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderConnectionCreateWithSecretInput = z.input<
  typeof providerConnectionCreateWithSecretInputSchema
>;

export const providerConnectionUpdateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200).optional(),
  secret_ref: providerSecretRefSchema.optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderConnectionUpdateInput = z.infer<typeof providerConnectionUpdateInputSchema>;

/** Secret replacement input is transient command data and is never returned. */
export const providerConnectionUpdateWithSecretInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200).optional(),
  secret: z.string().min(1).max(64 * 1024),
  capabilities: z.array(z.string().min(1)).optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderConnectionUpdateWithSecretInput = z.infer<
  typeof providerConnectionUpdateWithSecretInputSchema
>;

export const providerConnectionCommandInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
});

export type ProviderConnectionCommandInput = z.infer<typeof providerConnectionCommandInputSchema>;

export const capabilitySchema = z.enum([
  'shell',
  'filesystem',
  'network',
  'credentials',
  'dataset',
  'connector',
  'model',
  'cloud',
  'serving',
  'deploy',
]);

export type Capability = z.infer<typeof capabilitySchema>;

export const policyRuleEffectSchema = z.enum(['allow', 'deny', 'approval_required']);
export type PolicyRuleEffect = z.infer<typeof policyRuleEffectSchema>;

export const policyRuleSchema = z.strictObject({
  capability: capabilitySchema,
  effect: policyRuleEffectSchema,
  action: z.string().min(1).max(500).optional(),
  reason: z.string().min(1).max(2_000),
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;

export const policyEvaluateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  capability: capabilitySchema,
  action: z.string().min(1).max(500),
  requested_by: platformActorSchema,
  metadata: platformMetadataSchema.optional(),
});

export type PolicyEvaluateInput = z.infer<typeof policyEvaluateInputSchema>;

export const policyDecisionResolveInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  decided_by: platformActorSchema,
  reason: z.string().min(1).max(2_000).optional(),
});

export type PolicyDecisionResolveInput = z.infer<typeof policyDecisionResolveInputSchema>;

export const policyDecisionAuditInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  audit_ref: platformIdentifierSchema.optional(),
});

export type PolicyDecisionAuditInput = z.infer<typeof policyDecisionAuditInputSchema>;

export const policyRulesUpdateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  rules: z.array(policyRuleSchema),
});

export type PolicyRulesUpdateInput = z.infer<typeof policyRulesUpdateInputSchema>;

export const policyDecisionStateSchema = z.enum([
  'requested',
  'evaluated',
  'approved',
  'denied',
  'audited',
]);

export type PolicyDecisionState = z.infer<typeof policyDecisionStateSchema>;

export const policyDecisionOutcomeSchema = z.enum(['allow', 'deny', 'approval_required']);
export type PolicyDecisionOutcome = z.infer<typeof policyDecisionOutcomeSchema>;

export const policyDecisionSchema = z.strictObject({
  id: policyDecisionIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: runIdSchema.optional(),
  capability: capabilitySchema,
  action: z.string().min(1).max(500),
  state: policyDecisionStateSchema,
  outcome: policyDecisionOutcomeSchema.optional(),
  reason: z.string().min(1).max(2_000),
  requested_by: platformActorSchema,
  decided_by: platformActorSchema.optional(),
  requested_at: isoDateTimeSchema,
  evaluated_at: isoDateTimeSchema.optional(),
  resolved_at: isoDateTimeSchema.optional(),
  expires_at: isoDateTimeSchema.optional(),
  audit_ref: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const usageMeterSchema = z.enum([
  'intelligence',
  'model',
  'execution',
  'artifact_storage',
  'plugin_usage',
]);

export type UsageMeter = z.infer<typeof usageMeterSchema>;

export const usageUnitSchema = z.enum(['intelligence_percent', 'seconds', 'usd', 'units']);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

export const usageSourceSchema = z.enum(['byok', 'local', 'self_hosted']);
export type UsageSource = z.infer<typeof usageSourceSchema>;

/** Customer-facing usage; model/tool token counters remain internal telemetry. */
export const usageRecordSchema = z.strictObject({
  id: usageRecordIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: runIdSchema,
  meter: usageMeterSchema,
  unit: usageUnitSchema,
  amount: z.number().finite().nonnegative(),
  source: usageSourceSchema.optional().default('local'),
  execution_target_id: executionTargetIdSchema.optional(),
  recorded_at: isoDateTimeSchema,
  period_start: isoDateTimeSchema.optional(),
  period_end: isoDateTimeSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

export const executionTargetTypeSchema = z.enum([
  'local',
  'customer-managed',
]);

export type ExecutionTargetType = z.infer<typeof executionTargetTypeSchema>;

export const executionTargetStateSchema = z.enum([
  'configured',
  'ready',
  'draining',
  'disabled',
]);

export type ExecutionTargetState = z.infer<typeof executionTargetStateSchema>;

export const executionTargetLocalitySchema = z.enum([
  'local',
  'customer-region',
  'provider-region',
  'unknown',
]);

export type ExecutionTargetLocality = z.infer<typeof executionTargetLocalitySchema>;

export const executionTargetSchema = z.strictObject({
  id: executionTargetIdSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(200),
  type: executionTargetTypeSchema,
  state: executionTargetStateSchema,
  locality: executionTargetLocalitySchema,
  region: z.string().min(1).optional(),
  capabilities: z.array(z.string().min(1)),
  credential_ref: providerSecretRefSchema.optional(),
  lease_ref: platformIdentifierSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type ExecutionTarget = z.infer<typeof executionTargetSchema>;

export const executionTargetCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200),
  type: executionTargetTypeSchema,
  locality: executionTargetLocalitySchema,
  region: z.string().min(1).optional(),
  capabilities: z.array(z.string().min(1)).default([]),
  credential_ref: providerSecretRefSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ExecutionTargetCreateInput = z.input<typeof executionTargetCreateInputSchema>;

export const executionTargetUpdateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200).optional(),
  state: executionTargetStateSchema.optional(),
  locality: executionTargetLocalitySchema.optional(),
  region: z.string().min(1).optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  credential_ref: providerSecretRefSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ExecutionTargetUpdateInput = z.infer<typeof executionTargetUpdateInputSchema>;

export const executionTargetCommandInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
});

export type ExecutionTargetCommandInput = z.infer<typeof executionTargetCommandInputSchema>;

export const executionLeaseStateSchema = z.enum([
  'awaiting_approval',
  'active',
  'released',
  'expired',
]);

export type ExecutionLeaseState = z.infer<typeof executionLeaseStateSchema>;

export const executionLeaseSchema = z.strictObject({
  id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
  target_id: executionTargetIdSchema,
  run_id: runIdSchema.optional(),
  lease_ref: platformIdentifierSchema,
  state: executionLeaseStateSchema,
  issued_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema,
  released_at: isoDateTimeSchema.optional(),
  policy_decision_id: policyDecisionIdSchema.optional(),
});

export type ExecutionLease = z.infer<typeof executionLeaseSchema>;

export const executionLeaseAcquireInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  duration_seconds: z.number().int().positive().max(86_400).default(900),
  policy_decision_id: policyDecisionIdSchema.optional(),
});

export type ExecutionLeaseAcquireInput = z.input<typeof executionLeaseAcquireInputSchema>;

export const executionLeaseReleaseInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
});

export type ExecutionLeaseReleaseInput = z.infer<typeof executionLeaseReleaseInputSchema>;

export const automationTriggerSchema = z.enum(['cron', 'event', 'dependency']);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const automationStateSchema = z.enum(['enabled', 'paused', 'disabled']);
export type AutomationState = z.infer<typeof automationStateSchema>;

export const automationRetryPolicySchema = z.strictObject({
  max_attempts: z.number().int().min(1).max(20).default(1),
  backoff_seconds: z.number().int().nonnegative().max(86_400).default(60),
});

export type AutomationRetryPolicy = z.input<typeof automationRetryPolicySchema>;

export const automationSchema = z.strictObject({
  id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(200),
  trigger: automationTriggerSchema,
  schedule: z.string().min(1).optional(),
  event_type: z.string().min(1).optional(),
  depends_on_run_id: runIdSchema.optional(),
  agent_session_id: agentSessionIdSchema.optional(),
  pipeline_id: platformIdentifierSchema.optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  prompt: z.string().min(1).max(20_000),
  state: automationStateSchema,
  approval_required: z.boolean(),
  retry_policy: automationRetryPolicySchema,
  last_run_id: runIdSchema.optional(),
  next_run_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type Automation = z.infer<typeof automationSchema>;

export const automationCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200),
  trigger: automationTriggerSchema,
  schedule: z.string().min(1).optional(),
  event_type: z.string().min(1).optional(),
  depends_on_run_id: runIdSchema.optional(),
  agent_session_id: agentSessionIdSchema.optional(),
  pipeline_id: platformIdentifierSchema.optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  prompt: z.string().min(1).max(20_000),
  approval_required: z.boolean().default(true),
  retry_policy: automationRetryPolicySchema.default({ max_attempts: 1, backoff_seconds: 60 }),
  metadata: platformMetadataSchema.optional(),
});

export type AutomationCreateInput = z.input<typeof automationCreateInputSchema>;

export const automationUpdateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(200).optional(),
  state: automationStateSchema.optional(),
  schedule: z.string().min(1).optional(),
  prompt: z.string().min(1).max(20_000).optional(),
  pipeline_id: platformIdentifierSchema.optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  approval_required: z.boolean().optional(),
  retry_policy: automationRetryPolicySchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type AutomationUpdateInput = z.infer<typeof automationUpdateInputSchema>;

export const automationFireInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor: platformActorSchema.default('automation'),
  /** A previously evaluated decision used to resume an approval-gated fire. */
  policy_decision_id: policyDecisionIdSchema.optional(),
  /** Internal scheduler cursor used to associate an automatic retry. */
  retry_of_request_id: platformIdentifierSchema.optional(),
});

export type AutomationFireInput = z.input<typeof automationFireInputSchema>;

export const automationFireResultSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  automation_id: platformIdentifierSchema,
  status: z.enum(['queued', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'rejected']),
  run_id: runIdSchema.optional(),
  pipeline_run_id: platformIdentifierSchema.optional(),
  policy_decision_id: policyDecisionIdSchema.optional(),
  retry_of_request_id: platformIdentifierSchema.optional(),
  retry_at: isoDateTimeSchema.optional(),
  attempt: z.number().int().positive(),
  fired_at: isoDateTimeSchema,
  error: z.string().max(2_000).optional(),
});

export type AutomationFireResult = z.infer<typeof automationFireResultSchema>;

export const usageRecordCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  actor_id: platformIdentifierSchema,
  run_id: runIdSchema,
  meter: usageMeterSchema,
  unit: usageUnitSchema,
  amount: z.number().finite().nonnegative(),
  source: usageSourceSchema.optional().default('local'),
  execution_target_id: executionTargetIdSchema.optional(),
  period_start: isoDateTimeSchema.optional(),
  period_end: isoDateTimeSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type UsageRecordCreateInput = z.input<typeof usageRecordCreateInputSchema>;

export const usageSummarySchema = z.strictObject({
  workspace_id: workspaceIdSchema,
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  intelligence_percent: z.number().finite().nonnegative(),
  model_units: z.number().finite().nonnegative().default(0),
  execution_seconds: z.number().finite().nonnegative().default(0),
  artifact_storage_units: z.number().finite().nonnegative().default(0),
  plugin_usage_units: z.number().finite().nonnegative().default(0),
  record_count: z.number().int().nonnegative(),
});

export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const usageSummaryQuerySchema = z.strictObject({
  period_start: isoDateTimeSchema.optional(),
  period_end: isoDateTimeSchema.optional(),
});

export type UsageSummaryQuery = z.infer<typeof usageSummaryQuerySchema>;

export const platformReplayQuerySchema = z.strictObject({
  after_sequence: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export type PlatformReplayQuery = z.input<typeof platformReplayQuerySchema>;

export const platformEntityTypeSchema = z.enum([
  'workspace',
  'agent_session',
  'run',
  'artifact',
  'provider_connection',
  'resource',
  'policy_decision',
  'usage_record',
  'execution_target',
  'automation',
  'experiment',
  'training_run',
  'evaluation',
  'model',
  'comparison',
  'analysis',
  'pipeline',
  'pipeline_run',
  'model_package',
  'serving_endpoint',
]);

export type PlatformEntityType = z.infer<typeof platformEntityTypeSchema>;

export const platformLifecycleEventTypeSchema = z
  .string()
  .regex(
    /^(workspace|agent_session|run|artifact|provider_connection|resource|policy_decision|usage_record|execution_target|automation|experiment|training_run|evaluation|model|comparison|analysis|pipeline|pipeline_run|model_package|serving_endpoint)\.(created|updated|state_changed|completed|failed|cancelled|archived|revoked|validated|activated|evaluated|approved|denied|audited|fired)$/,
    {
      message: 'must be a supported <entity>.<lifecycle> event name',
    },
  );

export const platformLifecycleEventSchema = z
  .strictObject({
    event_id: platformIdentifierSchema,
    event_type: platformLifecycleEventTypeSchema,
    entity_type: platformEntityTypeSchema,
    entity_id: platformIdentifierSchema,
    workspace_id: workspaceIdSchema,
    sequence: z.number().int().nonnegative(),
    occurred_at: isoDateTimeSchema,
    request_id: platformIdentifierSchema.optional(),
    actor: platformActorSchema,
    state: z.string().min(1).optional(),
    payload: platformMetadataSchema.optional(),
  })
  .superRefine((event, ctx) => {
    const entityType = event.event_type.slice(0, event.event_type.indexOf('.'));
    if (entityType !== event.entity_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entity_type'],
        message: `must match the event_type entity prefix (${entityType})`,
      });
    }
  });

export type PlatformLifecycleEvent = z.infer<typeof platformLifecycleEventSchema>;

export const platformReplayPageSchema = z.strictObject({
  events: z.array(platformLifecycleEventSchema),
  next_sequence: z.number().int().nonnegative(),
  has_more: z.boolean(),
});

export type PlatformReplayPage = z.infer<typeof platformReplayPageSchema>;

/** Every accepted command returns the request id and durable object id. */
export const platformCommandAcceptedSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  object_type: platformEntityTypeSchema,
  object_id: platformIdentifierSchema,
});

export type PlatformCommandAccepted = z.infer<typeof platformCommandAcceptedSchema>;
