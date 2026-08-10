import { z } from 'zod';

import { artifactIdSchema, executionTargetIdSchema, platformIdentifierSchema, platformMetadataSchema, runIdSchema } from './platform';
import { isoDateTimeSchema } from './time';
import { workspaceIdSchema } from './workspace';

export const pipelineIdSchema = platformIdentifierSchema;
export const pipelineRunIdSchema = platformIdentifierSchema;
export type PipelineId = z.infer<typeof pipelineIdSchema>;
export type PipelineRunId = z.infer<typeof pipelineRunIdSchema>;

export const pipelineStepKindSchema = z.enum(['analysis', 'training', 'evaluation', 'comparison']);
export type PipelineStepKind = z.infer<typeof pipelineStepKindSchema>;

export const pipelineStepSchema = z.strictObject({
  id: platformIdentifierSchema,
  name: z.string().min(1).max(500),
  kind: pipelineStepKindSchema,
  config: platformMetadataSchema,
  depends_on: z.array(platformIdentifierSchema).default([]),
});
export type PipelineStep = z.infer<typeof pipelineStepSchema>;

export const pipelineStateSchema = z.enum(['ready', 'running', 'completed', 'failed', 'archived']);
export type PipelineState = z.infer<typeof pipelineStateSchema>;

export const pipelineSchema = z.strictObject({
  id: pipelineIdSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(500),
  steps: z.array(pipelineStepSchema).min(1).max(100),
  state: pipelineStateSchema,
  run_ids: z.array(runIdSchema),
  pipeline_run_ids: z.array(pipelineRunIdSchema),
  latest_run_id: runIdSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type Pipeline = z.infer<typeof pipelineSchema>;

export const pipelineCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(500),
  steps: z.array(pipelineStepSchema).min(1).max(100),
  metadata: platformMetadataSchema.optional(),
});
export type PipelineCreateInput = z.input<typeof pipelineCreateInputSchema>;

export const pipelineStepRunSchema = z.strictObject({
  step_id: platformIdentifierSchema,
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  output_artifact_ids: z.array(artifactIdSchema).default([]),
  started_at: isoDateTimeSchema.optional(),
  completed_at: isoDateTimeSchema.optional(),
  error: z.string().max(2_000).optional(),
});
export type PipelineStepRun = z.infer<typeof pipelineStepRunSchema>;

export const pipelineRunStatusSchema = z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']);
export type PipelineRunStatus = z.infer<typeof pipelineRunStatusSchema>;

export const pipelineRunSchema = z.strictObject({
  id: pipelineRunIdSchema,
  workspace_id: workspaceIdSchema,
  pipeline_id: pipelineIdSchema,
  run_id: runIdSchema,
  status: pipelineRunStatusSchema,
  step_runs: z.array(pipelineStepRunSchema),
  execution_target_id: executionTargetIdSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  output_artifact_ids: z.array(artifactIdSchema),
  created_at: isoDateTimeSchema,
  started_at: isoDateTimeSchema.optional(),
  completed_at: isoDateTimeSchema.optional(),
  error: z.string().max(2_000).optional(),
  metadata: platformMetadataSchema.optional(),
});
export type PipelineRun = z.infer<typeof pipelineRunSchema>;

export const pipelineRunInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema,
  execution_target_id: executionTargetIdSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type PipelineRunInput = z.infer<typeof pipelineRunInputSchema>;

export const pipelineCancelInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
});
export type PipelineCancelInput = z.infer<typeof pipelineCancelInputSchema>;
