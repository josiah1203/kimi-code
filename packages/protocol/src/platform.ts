import { z } from 'zod';

import {
  workspaceIdSchema,
  workspaceLifecycleStateSchema,
} from './workspace';
import { isoDateTimeSchema } from './time';

/**
 * Stable identifiers for the platform contract layer.
 *
 * Existing Kimi ids (including `wd_...` workspace ids) remain valid. The
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
export const resourceIdSchema = platformIdentifierSchema;
export const policyDecisionIdSchema = platformIdentifierSchema;
export const usageRecordIdSchema = platformIdentifierSchema;
export const executionTargetIdSchema = platformIdentifierSchema;

export type AgentSessionId = z.infer<typeof agentSessionIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type ProviderConnectionId = z.infer<typeof providerConnectionIdSchema>;
export type ResourceId = z.infer<typeof resourceIdSchema>;
export type PolicyDecisionId = z.infer<typeof policyDecisionIdSchema>;
export type UsageRecordId = z.infer<typeof usageRecordIdSchema>;
export type ExecutionTargetId = z.infer<typeof executionTargetIdSchema>;

export const platformMetadataSchema = z.record(z.string(), z.unknown());

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
 * Platform projection of the existing Kimi session. The v1 Session object
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
});

export type RunTransitionInput = z.infer<typeof runTransitionInputSchema>;

export const providerConnectionProviderSchema = z.enum([
  'kimi',
  'openai',
  'anthropic',
  'google',
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
  secret_ref: platformIdentifierSchema,
  capabilities: z.array(z.string().min(1)),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  validated_at: isoDateTimeSchema.optional(),
  revoked_at: isoDateTimeSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});

export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

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
  'hosted_execution',
  'customer_cloud_execution',
]);

export type UsageMeter = z.infer<typeof usageMeterSchema>;

export const usageUnitSchema = z.enum(['intelligence_percent', 'seconds', 'usd', 'units']);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

/** Customer-facing usage; model/tool token counters remain internal telemetry. */
export const usageRecordSchema = z.strictObject({
  id: usageRecordIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: runIdSchema,
  meter: usageMeterSchema,
  unit: usageUnitSchema,
  amount: z.number().finite().nonnegative(),
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
  'customer-cloud',
  'managed',
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
  credential_ref: platformIdentifierSchema.optional(),
  lease_ref: platformIdentifierSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});

export type ExecutionTarget = z.infer<typeof executionTargetSchema>;

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
]);

export type PlatformEntityType = z.infer<typeof platformEntityTypeSchema>;

export const platformLifecycleEventTypeSchema = z
  .string()
  .regex(
    /^(workspace|agent_session|run|artifact|provider_connection|resource|policy_decision|usage_record|execution_target)\.(created|updated|state_changed|completed|failed|cancelled|archived|revoked)$/,
    {
      message: 'must be a supported <entity>.<lifecycle> event name',
    },
  );

export const platformLifecycleEventSchema = z.strictObject({
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
});

export type PlatformLifecycleEvent = z.infer<typeof platformLifecycleEventSchema>;

/** Every accepted command returns the request id and durable object id. */
export const platformCommandAcceptedSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  object_type: platformEntityTypeSchema,
  object_id: platformIdentifierSchema,
});

export type PlatformCommandAccepted = z.infer<typeof platformCommandAcceptedSchema>;
