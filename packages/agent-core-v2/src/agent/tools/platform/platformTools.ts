/**
 * Conversational platform tools.
 *
 * These schemas deliberately describe platform operations rather than Kimi
 * implementation details.  The corresponding tools are activated only when
 * `platform_services` is enabled, so an ordinary Kimi agent keeps the same
 * tool inventory when the experimental platform is off.
 */

import { z } from 'zod';
import {
  datasetFormatSchema,
  executionTargetLocalitySchema,
  executionTargetIdSchema,
  executionTargetTypeSchema,
  providerConnectionProviderSchema,
  providerConnectionScopeSchema,
  providerSecretRefSchema,
  resourceRefSchema,
  runPlanStepSchema,
} from '@moonshot-ai/protocol';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const DatasetToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('inspect'), dataset_id: z.string().min(1) }).strict(),
  z
    .object({
      operation: z.literal('register'),
      name: z.string().min(1).max(500),
      format: datasetFormatSchema.optional(),
      source_path: z.string().min(1).optional(),
      content_base64: z.string().optional(),
      policy_decision_id: z.string().min(1).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('version'),
      dataset_id: z.string().min(1),
      source_path: z.string().min(1).optional(),
      content_base64: z.string().optional(),
      policy_decision_id: z.string().min(1).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('profile'),
      dataset_id: z.string().min(1),
      version: z.number().int().positive().optional(),
      policy_decision_id: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('query'),
      dataset_id: z.string().min(1),
      sql: z.string().min(1).max(50_000),
      version: z.number().int().positive().optional(),
      max_rows: z.number().int().positive().max(1_000).optional(),
      policy_decision_id: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('transform'),
      dataset_id: z.string().min(1),
      sql: z.string().min(1).max(50_000),
      version: z.number().int().positive().optional(),
      max_rows: z.number().int().positive().max(500_000).optional(),
      policy_decision_id: z.string().min(1).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);
export type DatasetToolInput = z.infer<typeof DatasetToolInputSchema>;
export interface IDatasetTool extends AgentTool<DatasetToolInput> { readonly _serviceBrand: undefined }
export const IDatasetTool = createDecorator<IDatasetTool>('datasetTool');

export const RunToolInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    kind: z.string().min(1).max(200).optional(),
    plan: z.array(runPlanStepSchema).optional(),
    input_resources: z.array(resourceRefSchema).optional(),
    execution_target_id: executionTargetIdSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('inspect'), run_id: z.string().min(1) }).strict(),
  z
    .object({ operation: z.enum(['cancel', 'retry', 'rerun', 'resume']), run_id: z.string().min(1) })
    .strict(),
  z.object({
    operation: z.literal('fork'),
    run_id: z.string().min(1),
    plan: z.array(runPlanStepSchema).optional(),
    input_resources: z.array(resourceRefSchema).optional(),
    execution_target_id: executionTargetIdSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
]);
export type RunToolInput = z.infer<typeof RunToolInputSchema>;
export interface IRunTool extends AgentTool<RunToolInput> { readonly _serviceBrand: undefined }
export const IRunTool = createDecorator<IRunTool>('runTool');

export const ProviderToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({
    operation: z.literal('add'),
    name: z.string().min(1).max(200),
    provider: providerConnectionProviderSchema,
    scope: providerConnectionScopeSchema,
    secret_ref: providerSecretRefSchema,
    capabilities: z.array(z.string().min(1)).max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ operation: z.literal('revoke'), connection_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('validate'), connection_id: z.string().min(1), model: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('discover_models'), connection_id: z.string().min(1), force_remote: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('describe_model'), connection_id: z.string().min(1), model: z.string().min(1).optional() }).strict(),
  z.object({
    operation: z.literal('select'),
    connection_id: z.string().min(1),
    model: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    fallback_connection_ids: z.array(z.string().min(1)).max(8).optional(),
  }).strict(),
  z.object({ operation: z.literal('clear') }).strict(),
]);
export type ProviderToolInput = z.infer<typeof ProviderToolInputSchema>;
export interface IProviderTool extends AgentTool<ProviderToolInput> { readonly _serviceBrand: undefined }
export const IProviderTool = createDecorator<IProviderTool>('providerTool');

export const ArtifactToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), kind: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('from_run'), run_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('inspect'), artifact_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('lineage'), artifact_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('download'), artifact_id: z.string().min(1), include_content: z.boolean().optional() }).strict(),
]);
export type ArtifactToolInput = z.infer<typeof ArtifactToolInputSchema>;
export interface IArtifactTool extends AgentTool<ArtifactToolInput> { readonly _serviceBrand: undefined }
export const IArtifactTool = createDecorator<IArtifactTool>('artifactTool');

export const GovernanceToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('pending') }).strict(),
  z.object({ operation: z.literal('explain'), decision_id: z.string().min(1) }).strict(),
  z
    .object({
      operation: z.literal('evaluate'),
      capability: z.enum(['shell', 'filesystem', 'network', 'credentials', 'model', 'dataset', 'connector', 'cloud', 'serving', 'deploy']),
      action: z.string().min(1).max(500),
      run_id: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ operation: z.enum(['approve', 'deny']), decision_id: z.string().min(1), reason: z.string().min(1).max(2_000).optional() }).strict(),
]);
export type GovernanceToolInput = z.infer<typeof GovernanceToolInputSchema>;
export interface IGovernanceTool extends AgentTool<GovernanceToolInput> { readonly _serviceBrand: undefined }
export const IGovernanceTool = createDecorator<IGovernanceTool>('governanceTool');

export const ResourceToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), type: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('inspect'), resource_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('create'), type: z.string().min(1), name: z.string().min(1).max(500), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ operation: z.literal('update'), resource_id: z.string().min(1), name: z.string().min(1).max(500).optional(), state: z.enum(['draft', 'running', 'ready', 'failed', 'archived']).optional(), artifact_ids: z.array(z.string().min(1)).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ operation: z.literal('execute'), resource_id: z.string().min(1), action: z.string().min(1).max(500), parameters: z.record(z.string(), z.unknown()).optional(), policy_decision_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('archive'), resource_id: z.string().min(1) }).strict(),
]);
export type ResourceToolInput = z.infer<typeof ResourceToolInputSchema>;
export interface IResourceTool extends AgentTool<ResourceToolInput> { readonly _serviceBrand: undefined }
export const IResourceTool = createDecorator<IResourceTool>('resourceTool');

export const AutomationToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('inspect'), automation_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('history'), automation_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('create'), name: z.string().min(1).max(200), trigger: z.enum(['cron', 'event', 'dependency']), schedule: z.string().min(1).optional(), event_type: z.string().min(1).optional(), depends_on_run_id: z.string().min(1).optional(), agent_session_id: z.string().min(1).optional(), pipeline_id: z.string().min(1).optional(), execution_target_id: z.string().min(1).optional(), prompt: z.string().min(1).max(20_000), approval_required: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('fire'), automation_id: z.string().min(1), policy_decision_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.enum(['pause', 'resume']), automation_id: z.string().min(1) }).strict(),
]);
export type AutomationToolInput = z.infer<typeof AutomationToolInputSchema>;
export interface IAutomationTool extends AgentTool<AutomationToolInput> { readonly _serviceBrand: undefined }
export const IAutomationTool = createDecorator<IAutomationTool>('automationTool');

export const ServingToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list_packages') }).strict(),
  z.object({ operation: z.literal('inspect_package'), package_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('package'), model_version_id: z.string().min(1), execution_target_id: z.string().min(1).optional(), model_policy_decision_id: z.string().min(1).optional(), execution_target_policy_decision_id: z.string().min(1).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ operation: z.literal('list_endpoints') }).strict(),
  z.object({ operation: z.literal('inspect_endpoint'), endpoint_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('deploy'), name: z.string().min(1).max(500), package_id: z.string().min(1), execution_target_id: z.string().min(1).optional(), deploy_policy_decision_id: z.string().min(1).optional(), execution_target_policy_decision_id: z.string().min(1).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ operation: z.enum(['pause', 'resume', 'archive']), endpoint_id: z.string().min(1), execution_target_policy_decision_id: z.string().min(1).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ operation: z.literal('rollback'), endpoint_id: z.string().min(1), package_id: z.string().min(1), deploy_policy_decision_id: z.string().min(1).optional(), execution_target_policy_decision_id: z.string().min(1).optional(), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
]);
export type ServingToolInput = z.infer<typeof ServingToolInputSchema>;
export interface IServingTool extends AgentTool<ServingToolInput> { readonly _serviceBrand: undefined }
export const IServingTool = createDecorator<IServingTool>('servingTool');

const metricSpec = z.object({
  name: z.string().min(1).max(160),
  higher_is_better: z.boolean().optional(),
  required_minimum: z.number().finite().optional(),
  maximum_regression: z.number().finite().nonnegative().optional(),
}).strict();

/**
 * Conversational ML operations deliberately stay at the service boundary:
 * they reference durable datasets, artifacts, Runs, and model versions rather
 * than accepting executable code or arbitrary file/database access.
 */
export const MlToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list_analyses') }).strict(),
  z.object({ operation: z.literal('inspect_analysis'), analysis_id: z.string().min(1) }).strict(),
  z.object({
    operation: z.literal('baseline_workflow'),
    dataset_id: z.string().min(1).optional(),
    dataset_name: z.string().min(1).max(500).optional(),
    format: datasetFormatSchema.optional(),
    source_path: z.string().min(1).optional(),
    content_base64: z.string().optional(),
    dataset_version: z.number().int().positive().optional(),
    dataset_policy_decision_id: z.string().min(1).optional(),
    model_policy_decision_id: z.string().min(1).optional(),
    execution_target_policy_decision_id: z.string().min(1).optional(),
    target: z.string().min(1).max(500),
    features: z.array(z.string().min(1).max(500)).min(1).max(256),
    task: z.enum(['classification', 'regression']),
    algorithm: z.string().min(1).max(256).optional(),
    experiment_name: z.string().min(1).max(500).optional(),
    model_name: z.string().min(1).max(256).optional(),
    execution_target_id: z.string().min(1).optional(),
    metrics: z.array(metricSpec).min(1).max(32).optional(),
    hyperparameters: z.record(z.string(), z.unknown()).optional(),
    seed: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    operation: z.literal('analyze'),
    dataset_id: z.string().min(1),
    dataset_version: z.number().int().positive().optional(),
    execution_target_id: z.string().min(1).optional(),
    execution_target_policy_decision_id: z.string().min(1).optional(),
    dataset_policy_decision_id: z.string().min(1).optional(),
    kind: z.enum(['summary', 'visualization', 'notebook']).optional(),
    columns: z.array(z.string().min(1).max(500)).max(256).optional(),
    group_by: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ operation: z.literal('list_experiments') }).strict(),
  z.object({ operation: z.literal('inspect_experiment'), experiment_id: z.string().min(1) }).strict(),
  z.object({
    operation: z.literal('create_experiment'),
    name: z.string().min(1).max(500),
    dataset_id: z.string().min(1),
    dataset_version: z.number().int().positive().optional(),
    dataset_policy_decision_id: z.string().min(1).optional(),
    model_policy_decision_id: z.string().min(1).optional(),
    target: z.string().min(1).max(500),
    features: z.array(z.string().min(1).max(500)).min(1).max(256),
    task: z.enum(['classification', 'regression', 'custom']),
    algorithm: z.string().min(1).max(256),
    execution_target_id: z.string().min(1).optional(),
    metrics: z.array(metricSpec).min(1).max(32),
    hyperparameters: z.record(z.string(), z.unknown()).optional(),
    seed: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ operation: z.literal('validate_experiment'), experiment_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('list_training_runs'), experiment_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('inspect_training_run'), training_run_id: z.string().min(1) }).strict(),
  z.object({
    operation: z.literal('train'),
    experiment_id: z.string().min(1),
    execution_target_id: z.string().min(1).optional(),
    execution_target_policy_decision_id: z.string().min(1).optional(),
    dataset_policy_decision_id: z.string().min(1).optional(),
    model_policy_decision_id: z.string().min(1).optional(),
  }).strict(),
  z.object({ operation: z.literal('cancel_training'), training_run_id: z.string().min(1), model_policy_decision_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('list_evaluations'), experiment_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('inspect_evaluation'), evaluation_id: z.string().min(1) }).strict(),
  z.object({
    operation: z.literal('evaluate'),
    experiment_id: z.string().min(1).optional(),
    dataset_id: z.string().min(1),
    dataset_version: z.number().int().positive().optional(),
    execution_target_id: z.string().min(1).optional(),
    execution_target_policy_decision_id: z.string().min(1).optional(),
    dataset_policy_decision_id: z.string().min(1).optional(),
    model_policy_decision_id: z.string().min(1).optional(),
    candidate_model_artifact_id: z.string().min(1),
    baseline_model_artifact_id: z.string().min(1).optional(),
    benchmark_id: z.string().min(1).max(160).optional(),
    benchmark_version: z.number().int().positive().optional(),
    minimum_sample_size: z.number().int().positive().max(1_000_000).optional(),
    metrics: z.array(metricSpec).max(32).optional(),
    limitations: z.array(z.string().min(1).max(500)).optional(),
  }).strict(),
  z.object({ operation: z.literal('compare'), experiment_ids: z.array(z.string().min(1)).min(2).max(100), model_policy_decision_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('list_models'), model_name: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('inspect_model'), model_id: z.string().min(1) }).strict(),
  z.object({
    operation: z.literal('register_model'),
    model_name: z.string().min(1).max(256),
    artifact_id: z.string().min(1),
    experiment_id: z.string().min(1),
    training_run_id: z.string().min(1),
    model_policy_decision_id: z.string().min(1).optional(),
    evaluation_id: z.string().min(1).optional(),
    metrics: z.record(z.string(), z.number().finite()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    operation: z.literal('stage_model'),
    model_id: z.string().min(1),
    stage: z.enum(['candidate', 'validated', 'production', 'archived']),
    model_policy_decision_id: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
]);
export type MlToolInput = z.infer<typeof MlToolInputSchema>;
export interface IMlTool extends AgentTool<MlToolInput> { readonly _serviceBrand: undefined }
export const IMlTool = createDecorator<IMlTool>('mlTool');

export const PipelineToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('inspect'), pipeline_id: z.string().min(1) }).strict(),
  z.object({
    operation: z.literal('create'),
    name: z.string().min(1).max(500),
    steps: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(500),
      kind: z.enum(['analysis', 'training', 'evaluation', 'comparison']),
      config: z.record(z.string(), z.unknown()),
      depends_on: z.array(z.string().min(1)).optional(),
    }).strict()).min(1).max(100),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ operation: z.literal('list_runs'), pipeline_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('inspect_run'), pipeline_run_id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('run'), pipeline_id: z.string().min(1), execution_target_id: z.string().min(1).optional(), execution_target_policy_decision_id: z.string().min(1).optional(), policy_decision_id: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('cancel'), pipeline_run_id: z.string().min(1) }).strict(),
]);
export type PipelineToolInput = z.infer<typeof PipelineToolInputSchema>;
export interface IPipelineTool extends AgentTool<PipelineToolInput> { readonly _serviceBrand: undefined }
export const IPipelineTool = createDecorator<IPipelineTool>('pipelineTool');

export const ExecutionTargetToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('inspect'), target_id: executionTargetIdSchema }).strict(),
  z.object({
    operation: z.literal('register'),
    name: z.string().min(1).max(200),
    type: executionTargetTypeSchema,
    locality: executionTargetLocalitySchema,
    region: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)).max(128).optional(),
    credential_ref: providerSecretRefSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    operation: z.literal('update'),
    target_id: executionTargetIdSchema,
    name: z.string().min(1).max(200).optional(),
    state: z.enum(['configured', 'ready', 'disabled']).optional(),
    locality: executionTargetLocalitySchema.optional(),
    region: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)).max(128).optional(),
    credential_ref: providerSecretRefSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ operation: z.literal('mark_ready'), target_id: executionTargetIdSchema }).strict(),
  z.object({ operation: z.literal('disable'), target_id: executionTargetIdSchema }).strict(),
  z.object({
    operation: z.literal('acquire_lease'),
    target_id: executionTargetIdSchema,
    run_id: z.string().min(1).optional(),
    duration_seconds: z.number().int().positive().max(86_400).optional(),
    policy_decision_id: z.string().min(1).optional(),
  }).strict(),
  z.object({
    operation: z.literal('release_lease'),
    target_id: executionTargetIdSchema,
    lease_id: z.string().min(1),
  }).strict(),
]);
export type ExecutionTargetToolInput = z.infer<typeof ExecutionTargetToolInputSchema>;
export interface IExecutionTargetTool extends AgentTool<ExecutionTargetToolInput> { readonly _serviceBrand: undefined }
export const IExecutionTargetTool = createDecorator<IExecutionTargetTool>('executionTargetTool');
