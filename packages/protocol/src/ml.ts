import { z } from 'zod';

import {
  artifactIdSchema,
  executionTargetIdSchema,
  platformIdentifierSchema,
  platformMetadataSchema,
  runIdSchema,
} from './platform';
import { isoDateTimeSchema } from './time';
import { workspaceIdSchema } from './workspace';

/** Stable identifiers and value contracts for conversational ML workflows. */

export const experimentIdSchema = platformIdentifierSchema;
export const trainingRunIdSchema = platformIdentifierSchema;
export const evaluationIdSchema = platformIdentifierSchema;
export const modelVersionIdSchema = platformIdentifierSchema;
export const comparisonIdSchema = platformIdentifierSchema;
export const analysisIdSchema = platformIdentifierSchema;

export type ExperimentId = z.infer<typeof experimentIdSchema>;
export type TrainingRunId = z.infer<typeof trainingRunIdSchema>;
export type EvaluationId = z.infer<typeof evaluationIdSchema>;
export type ModelVersionId = z.infer<typeof modelVersionIdSchema>;
export type ComparisonId = z.infer<typeof comparisonIdSchema>;
export type AnalysisId = z.infer<typeof analysisIdSchema>;

export const analysisKindSchema = z.enum(['summary', 'visualization', 'notebook']);
export type AnalysisKind = z.infer<typeof analysisKindSchema>;

export const experimentTaskSchema = z.enum(['classification', 'regression', 'custom']);
export type ExperimentTask = z.infer<typeof experimentTaskSchema>;

export const experimentStateSchema = z.enum([
  'draft',
  'ready',
  'running',
  'completed',
  'failed',
  'archived',
]);
export type ExperimentState = z.infer<typeof experimentStateSchema>;

export const experimentMetricSpecSchema = z.strictObject({
  name: z.string().min(1).max(160),
  higher_is_better: z.boolean().default(true),
  required_minimum: z.number().finite().optional(),
  maximum_regression: z.number().finite().nonnegative().optional(),
});
export type ExperimentMetricSpec = z.input<typeof experimentMetricSpecSchema>;

export const experimentSchema = z.strictObject({
  id: experimentIdSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(500),
  dataset_id: platformIdentifierSchema,
  dataset_version: z.number().int().positive(),
  dataset_artifact_id: artifactIdSchema,
  target: z.string().min(1).max(500),
  features: z.array(z.string().min(1).max(500)).min(1).max(256),
  task: experimentTaskSchema,
  algorithm: z.string().min(1).max(256),
  execution_target_id: executionTargetIdSchema.optional(),
  metrics: z.array(experimentMetricSpecSchema),
  hyperparameters: platformMetadataSchema,
  seed: z.number().int().nonnegative(),
  state: experimentStateSchema,
  run_ids: z.array(runIdSchema),
  training_run_ids: z.array(trainingRunIdSchema),
  model_version_ids: z.array(modelVersionIdSchema),
  latest_run_id: runIdSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type Experiment = z.infer<typeof experimentSchema>;

export const experimentCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  name: z.string().min(1).max(500),
  dataset_id: platformIdentifierSchema,
  dataset_version: z.number().int().positive().optional(),
  dataset_policy_decision_id: platformIdentifierSchema.optional(),
  model_policy_decision_id: platformIdentifierSchema.optional(),
  target: z.string().min(1).max(500),
  features: z.array(z.string().min(1).max(500)).min(1).max(256),
  task: experimentTaskSchema,
  algorithm: z.string().min(1).max(256),
  execution_target_id: executionTargetIdSchema.optional(),
  metrics: z.array(experimentMetricSpecSchema).min(1).max(32),
  hyperparameters: platformMetadataSchema.default({}),
  seed: z.number().int().nonnegative().default(0),
  metadata: platformMetadataSchema.optional(),
});
export type ExperimentCreateInput = z.input<typeof experimentCreateInputSchema>;

export const trainingStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type TrainingStatus = z.infer<typeof trainingStatusSchema>;

export const trainingRunSchema = z.strictObject({
  id: trainingRunIdSchema,
  workspace_id: workspaceIdSchema,
  experiment_id: experimentIdSchema,
  run_id: runIdSchema,
  status: trainingStatusSchema,
  execution_target_id: executionTargetIdSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  executor: z.enum(['local', 'customer-managed', 'customer-cloud', 'managed']),
  dataset_artifact_id: artifactIdSchema,
  metrics: z.record(z.string(), z.number().finite()),
  checkpoint_artifact_ids: z.array(artifactIdSchema),
  model_artifact_id: artifactIdSchema.optional(),
  started_at: isoDateTimeSchema.optional(),
  completed_at: isoDateTimeSchema.optional(),
  error: z.string().max(2_000).optional(),
  environment: platformMetadataSchema.optional(),
  created_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type TrainingRun = z.infer<typeof trainingRunSchema>;

export const trainingStartInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema,
  execution_target_id: executionTargetIdSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  dataset_policy_decision_id: platformIdentifierSchema.optional(),
  model_policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type TrainingStartInput = z.infer<typeof trainingStartInputSchema>;

export const trainingCancelInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  model_policy_decision_id: platformIdentifierSchema.optional(),
});
export type TrainingCancelInput = z.infer<typeof trainingCancelInputSchema>;

export const evaluationRecommendationSchema = z.enum(['promote', 'reject', 'investigate']);
export type EvaluationRecommendation = z.infer<typeof evaluationRecommendationSchema>;

export const evaluationMetricSchema = z.strictObject({
  name: z.string().min(1).max(160),
  candidate: z.number().finite(),
  baseline: z.number().finite().optional(),
  regression: z.number().finite().optional(),
  passed: z.boolean(),
});
export type EvaluationMetric = z.infer<typeof evaluationMetricSchema>;

export const evaluationSchema = z.strictObject({
  id: evaluationIdSchema,
  workspace_id: workspaceIdSchema,
  experiment_id: experimentIdSchema.optional(),
  run_id: runIdSchema,
  dataset_artifact_id: artifactIdSchema,
  candidate_model_artifact_id: artifactIdSchema,
  baseline_model_artifact_id: artifactIdSchema.optional(),
  benchmark_id: z.string().min(1).max(160),
  benchmark_version: z.number().int().positive(),
  sample_size: z.number().int().nonnegative(),
  input_digest: z.string().regex(/^[a-f0-9]{64}$/),
  metrics: z.array(evaluationMetricSchema),
  recommendation: evaluationRecommendationSchema,
  artifact_id: artifactIdSchema,
  limitations: z.array(z.string().min(1).max(500)),
  created_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const evaluationCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema,
  experiment_id: experimentIdSchema.optional(),
  dataset_id: platformIdentifierSchema,
  dataset_version: z.number().int().positive().optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  dataset_policy_decision_id: platformIdentifierSchema.optional(),
  model_policy_decision_id: platformIdentifierSchema.optional(),
  candidate_model_artifact_id: artifactIdSchema,
  baseline_model_artifact_id: artifactIdSchema.optional(),
  benchmark_id: z.string().min(1).max(160).default('dataset_holdout'),
  benchmark_version: z.number().int().positive().default(1),
  minimum_sample_size: z.number().int().positive().max(1_000_000).default(1),
  metrics: z.array(experimentMetricSpecSchema).optional(),
  limitations: z.array(z.string().min(1).max(500)).default([]),
  metadata: platformMetadataSchema.optional(),
});
export type EvaluationCreateInput = z.input<typeof evaluationCreateInputSchema>;

export const modelStageSchema = z.enum(['candidate', 'validated', 'production', 'archived']);
export type ModelStage = z.infer<typeof modelStageSchema>;

export const modelVersionSchema = z.strictObject({
  id: modelVersionIdSchema,
  workspace_id: workspaceIdSchema,
  model_name: z.string().min(1).max(256),
  version: z.number().int().positive(),
  stage: modelStageSchema,
  artifact_id: artifactIdSchema,
  experiment_id: experimentIdSchema,
  training_run_id: trainingRunIdSchema,
  evaluation_id: evaluationIdSchema.optional(),
  metrics: z.record(z.string(), z.number().finite()),
  lineage_artifact_ids: z.array(artifactIdSchema).min(1),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type ModelVersion = z.infer<typeof modelVersionSchema>;

export const modelRegisterInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  model_policy_decision_id: platformIdentifierSchema.optional(),
  model_name: z.string().min(1).max(256),
  artifact_id: artifactIdSchema,
  experiment_id: experimentIdSchema,
  training_run_id: trainingRunIdSchema,
  evaluation_id: evaluationIdSchema.optional(),
  metrics: z.record(z.string(), z.number().finite()).default({}),
  metadata: platformMetadataSchema.optional(),
});
export type ModelRegisterInput = z.input<typeof modelRegisterInputSchema>;

export const modelStageInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  model_policy_decision_id: platformIdentifierSchema.optional(),
  stage: modelStageSchema,
  metadata: platformMetadataSchema.optional(),
});
export type ModelStageInput = z.infer<typeof modelStageInputSchema>;

export const experimentComparisonSchema = z.strictObject({
  id: comparisonIdSchema,
  workspace_id: workspaceIdSchema,
  experiment_ids: z.array(experimentIdSchema).min(2),
  metrics: z.record(z.string(), z.record(z.string(), z.number().finite())),
  artifact_id: artifactIdSchema,
  created_at: isoDateTimeSchema,
});
export type ExperimentComparison = z.infer<typeof experimentComparisonSchema>;

export const experimentCompareInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  experiment_ids: z.array(experimentIdSchema).min(2).max(100),
  run_id: runIdSchema,
  model_policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type ExperimentCompareInput = z.infer<typeof experimentCompareInputSchema>;

export const analysisSchema = z.strictObject({
  id: analysisIdSchema,
  workspace_id: workspaceIdSchema,
  run_id: runIdSchema,
  dataset_id: platformIdentifierSchema,
  dataset_version: z.number().int().positive(),
  dataset_artifact_id: artifactIdSchema,
  kind: analysisKindSchema,
  row_count: z.number().int().nonnegative(),
  column_count: z.number().int().nonnegative(),
  report_artifact_id: artifactIdSchema,
  visualization_artifact_ids: z.array(artifactIdSchema),
  notebook_artifact_id: artifactIdSchema.optional(),
  input_digest: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const analysisCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema,
  dataset_id: platformIdentifierSchema,
  dataset_version: z.number().int().positive().optional(),
  execution_target_id: executionTargetIdSchema.optional(),
  execution_target_policy_decision_id: platformIdentifierSchema.optional(),
  dataset_policy_decision_id: platformIdentifierSchema.optional(),
  kind: analysisKindSchema.default('summary'),
  columns: z.array(z.string().min(1).max(500)).max(256).optional(),
  group_by: z.string().min(1).max(500).optional(),
  metadata: platformMetadataSchema.optional(),
});
export type AnalysisCreateInput = z.input<typeof analysisCreateInputSchema>;
