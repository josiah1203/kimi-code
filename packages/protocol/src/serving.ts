/** Durable model packaging and serving endpoint contracts. */

import { z } from 'zod';

import {
  artifactIdSchema,
  attemptIdSchema,
  executionTargetIdSchema,
  platformIdentifierSchema,
  platformMetadataSchema,
  runIdSchema,
} from './platform';
import { isoDateTimeSchema } from './time';
import { workspaceIdSchema } from './workspace';

export const modelPackageIdSchema = platformIdentifierSchema;
export const servingEndpointIdSchema = platformIdentifierSchema;
export type ModelPackageId = z.infer<typeof modelPackageIdSchema>;
export type ServingEndpointId = z.infer<typeof servingEndpointIdSchema>;

export const modelPackageStateSchema = z.enum(['awaiting_approval', 'ready', 'failed', 'archived']);
export type ModelPackageState = z.infer<typeof modelPackageStateSchema>;

export const modelPackageSchema = z.strictObject({
  id: modelPackageIdSchema,
  workspace_id: workspaceIdSchema,
  model_version_id: platformIdentifierSchema,
  model_artifact_id: artifactIdSchema,
  bundle_artifact_id: artifactIdSchema.optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  state: modelPackageStateSchema,
  policy_decision_id: platformIdentifierSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  error: z.string().max(2_000).optional(),
  metadata: platformMetadataSchema.optional(),
});
export type ModelPackage = z.infer<typeof modelPackageSchema>;

export const modelPackageCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  model_version_id: platformIdentifierSchema,
  execution_target_id: executionTargetIdSchema.optional(),
  model_policy_decision_id: platformIdentifierSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type ModelPackageCreateInput = z.input<typeof modelPackageCreateInputSchema>;

export const servingEndpointStateSchema = z.enum([
  'awaiting_approval',
  'draft',
  'deploying',
  'ready',
  'failed',
  'paused',
  'archived',
]);
export type ServingEndpointState = z.infer<typeof servingEndpointStateSchema>;

export const servingEndpointSchema = z.strictObject({
  id: servingEndpointIdSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(500),
  model_package_id: modelPackageIdSchema,
  model_version_id: platformIdentifierSchema,
  bundle_artifact_id: artifactIdSchema.optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  lease_id: platformIdentifierSchema.optional(),
  deployment_run_id: runIdSchema,
  state: servingEndpointStateSchema,
  endpoint_url: z.string().url().or(z.string().startsWith('local://')).optional(),
  lineage_artifact_ids: z.array(artifactIdSchema).min(1),
  policy_decision_id: platformIdentifierSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  rollback_of_endpoint_id: servingEndpointIdSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  error: z.string().max(2_000).optional(),
  metadata: platformMetadataSchema.optional(),
});
export type ServingEndpoint = z.infer<typeof servingEndpointSchema>;

export const servingEndpointCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema,
  attempt_id: attemptIdSchema.optional(),
  name: z.string().min(1).max(500),
  model_package_id: modelPackageIdSchema,
  execution_target_id: executionTargetIdSchema.optional(),
  deploy_policy_decision_id: platformIdentifierSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type ServingEndpointCreateInput = z.input<typeof servingEndpointCreateInputSchema>;

export const servingEndpointActionSchema = z.enum(['pause', 'resume', 'archive', 'rollback']);
export type ServingEndpointAction = z.infer<typeof servingEndpointActionSchema>;

export const servingEndpointActionInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  attempt_id: attemptIdSchema.optional(),
  deploy_policy_decision_id: platformIdentifierSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  model_package_id: modelPackageIdSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type ServingEndpointActionInput = z.input<typeof servingEndpointActionInputSchema>;
