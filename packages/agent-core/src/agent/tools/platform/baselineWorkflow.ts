/**
 * The smallest complete local ML workflow exposed by the conversational
 * agent.  This module deliberately composes the existing workspace services;
 * it does not create a second dataset, experiment, model, or Run authority.
 */

import type {
  Analysis,
  Artifact,
  Dataset,
  DatasetProfile,
  Evaluation,
  Experiment,
  ExperimentMetricSpec,
  ModelVersion,
  TrainingRun,
} from '@spiderbyte/protocol';

import type { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import type { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import type { IWorkspaceMlService } from '#/workspace/ml/ml';

export interface BaselineWorkflowInput {
  readonly requestPrefix: string;
  readonly runId: string;
  readonly datasetId?: string;
  readonly datasetName?: string;
  readonly format?: 'csv' | 'jsonl';
  readonly sourcePath?: string;
  readonly contentBase64?: string;
  readonly datasetVersion?: number;
  readonly datasetPolicyDecisionId?: string;
  readonly modelPolicyDecisionId?: string;
  readonly executionTargetPolicyDecisionId?: string;
  readonly target: string;
  readonly features: readonly string[];
  readonly task: 'classification' | 'regression';
  readonly algorithm?: string;
  readonly experimentName?: string;
  readonly modelName?: string;
  readonly executionTargetId?: string;
  readonly metrics: readonly ExperimentMetricSpec[];
  readonly hyperparameters?: Readonly<Record<string, unknown>>;
  readonly seed?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Called after ingestion so a restart can replay from the durable dataset. */
  readonly onDatasetResolved?: (dataset: Dataset) => Promise<void> | void;
}

export interface BaselineWorkflowResult {
  readonly dataset: Dataset;
  readonly profile: DatasetProfile;
  readonly analysis: Analysis;
  readonly experiment: Experiment;
  readonly training: TrainingRun;
  readonly evaluation: Evaluation;
  readonly model: ModelVersion;
  readonly artifacts: readonly Artifact[];
}

/**
 * The chat transcript is a projection of the durable workflow records. Keep
 * the conversational response small while leaving the complete domain
 * objects available through Run and artifact inspection.
 */
export function baselineWorkflowProjection(
  workflow: BaselineWorkflowResult,
): Readonly<Record<string, unknown>> {
  return {
    dataset: {
      id: workflow.dataset.id,
      name: workflow.dataset.name,
      format: workflow.dataset.format,
      version: workflow.profile.version,
      row_count: workflow.profile.row_count,
    },
    profile: {
      artifact_id: workflow.profile.artifact_id,
      row_count: workflow.profile.row_count,
      column_count: workflow.profile.columns.length,
    },
    analysis: {
      id: workflow.analysis.id,
      kind: workflow.analysis.kind,
      report_artifact_id: workflow.analysis.report_artifact_id,
      visualization_artifact_ids: workflow.analysis.visualization_artifact_ids,
      notebook_artifact_id: workflow.analysis.notebook_artifact_id,
    },
    experiment: {
      id: workflow.experiment.id,
      name: workflow.experiment.name,
      state: workflow.experiment.state,
      task: workflow.experiment.task,
      algorithm: workflow.experiment.algorithm,
      metrics: workflow.experiment.metrics,
    },
    training: {
      id: workflow.training.id,
      status: workflow.training.status,
      executor: workflow.training.executor,
      metrics: workflow.training.metrics,
      model_artifact_id: workflow.training.model_artifact_id,
      checkpoint_artifact_ids: workflow.training.checkpoint_artifact_ids,
    },
    evaluation: {
      id: workflow.evaluation.id,
      recommendation: workflow.evaluation.recommendation,
      metrics: workflow.evaluation.metrics,
      sample_size: workflow.evaluation.sample_size,
      artifact_id: workflow.evaluation.artifact_id,
      limitations: workflow.evaluation.limitations,
    },
    model: {
      id: workflow.model.id,
      model_name: workflow.model.model_name,
      version: workflow.model.version,
      stage: workflow.model.stage,
      artifact_id: workflow.model.artifact_id,
      metrics: workflow.model.metrics,
      lineage_artifact_ids: workflow.model.lineage_artifact_ids,
    },
    artifacts: workflow.artifacts.map((artifact) => ({ id: artifact.id, version: artifact.version })),
  };
}

export interface BaselineWorkflowServices {
  readonly datasets: IWorkspaceDatasetService;
  readonly ml: IWorkspaceMlService;
  readonly artifacts: IWorkspaceArtifactService;
}

export async function executeBaselineWorkflow(
  services: BaselineWorkflowServices,
  input: BaselineWorkflowInput,
  onProgress?: (text: string) => void,
): Promise<BaselineWorkflowResult> {
  const {
    datasets,
    ml,
    artifacts,
  } = services;
  const request = (suffix: string): string => `${input.requestPrefix}:${suffix}`;
  const report = (text: string): void => onProgress?.(text);

  let dataset: Dataset | undefined;
  if (input.datasetId !== undefined) {
    report('Resolving the dataset…');
    dataset = await datasets.get(input.datasetId);
    if (dataset === undefined) throw new Error(`Dataset not found: ${input.datasetId}`);
  } else {
    if (input.datasetName === undefined || (input.sourcePath === undefined && input.contentBase64 === undefined)) {
      throw new Error('A dataset_id or a local CSV/JSONL source is required; executable notebook input is unavailable.');
    }
    if (input.sourcePath !== undefined && input.contentBase64 !== undefined) {
      throw new Error('Provide either source_path or content_base64, not both.');
    }
    report('Registering the local dataset…');
    dataset = await datasets.create({
      request_id: request('dataset:create'),
      name: input.datasetName,
      format: input.format ?? 'csv',
      source_path: input.sourcePath,
      content_base64: input.contentBase64,
      run_id: input.runId,
      policy_decision_id: input.datasetPolicyDecisionId,
      metadata: input.metadata,
    });
  }

  const version = input.datasetVersion ?? dataset.current_version;
  if (!dataset.versions.some((candidate) => candidate.version === version)) {
    throw new Error(`Dataset version not found: ${dataset.id}@${version}`);
  }
  await input.onDatasetResolved?.(dataset);

  report('Profiling the dataset…');
  const profile = await datasets.profile(dataset.id, {
    request_id: request('dataset:profile'),
    run_id: input.runId,
    version,
    policy_decision_id: input.datasetPolicyDecisionId,
  });
  if (profile === undefined) throw new Error(`Dataset not found: ${dataset.id}`);

  report('Generating the analysis report and visualization…');
  const analysis = await ml.analyze({
    request_id: request('ml:analysis'),
    run_id: input.runId,
    dataset_id: dataset.id,
    dataset_version: version,
    execution_target_id: input.executionTargetId,
    execution_target_policy_decision_id: input.executionTargetPolicyDecisionId,
    dataset_policy_decision_id: input.datasetPolicyDecisionId,
    kind: 'visualization',
    metadata: input.metadata,
  });
  if (analysis === undefined) throw new Error('Dataset analysis could not be created.');

  const algorithm = input.algorithm ?? (input.task === 'classification' ? 'nearest_centroid' : 'linear_regression');
  const experimentName = input.experimentName ?? `${dataset.name} baseline`;
  report(`Creating experiment ${experimentName}…`);
  const experiment = await ml.createExperiment({
    request_id: request('ml:experiment'),
    run_id: input.runId,
    name: experimentName,
    dataset_id: dataset.id,
    dataset_version: version,
    dataset_policy_decision_id: input.datasetPolicyDecisionId,
    model_policy_decision_id: input.modelPolicyDecisionId,
    target: input.target,
    features: [...input.features],
    task: input.task,
    algorithm,
    execution_target_id: input.executionTargetId,
    metrics: [...input.metrics],
    hyperparameters: input.hyperparameters,
    seed: input.seed,
    metadata: input.metadata,
  });

  report('Training the local baseline model…');
  const training = await ml.startTraining(experiment.id, {
    request_id: request('ml:training'),
    run_id: input.runId,
    execution_target_id: input.executionTargetId,
    execution_target_policy_decision_id: input.executionTargetPolicyDecisionId,
    dataset_policy_decision_id: input.datasetPolicyDecisionId,
    model_policy_decision_id: input.modelPolicyDecisionId,
    metadata: input.metadata,
  });
  if (training === undefined) throw new Error(`Experiment not found: ${experiment.id}`);
  if (training.status !== 'succeeded' || training.model_artifact_id === undefined) {
    throw new Error(`Baseline training did not succeed: ${training.error ?? training.status}`);
  }

  report('Evaluating the trained model…');
  const evaluation = await ml.evaluate({
    request_id: request('ml:evaluation'),
    run_id: input.runId,
    experiment_id: experiment.id,
    dataset_id: dataset.id,
    dataset_version: version,
    execution_target_id: input.executionTargetId,
    execution_target_policy_decision_id: input.executionTargetPolicyDecisionId,
    dataset_policy_decision_id: input.datasetPolicyDecisionId,
    model_policy_decision_id: input.modelPolicyDecisionId,
    candidate_model_artifact_id: training.model_artifact_id,
    metrics: [...input.metrics],
    limitations: ['Evaluation uses the requested dataset version; provide a holdout dataset for a separate validation split.'],
    metadata: input.metadata,
  });
  if (evaluation === undefined) throw new Error('Model evaluation could not be created.');

  report('Registering the model and recording lineage…');
  const model = await ml.registerModel({
    request_id: request('ml:model'),
    run_id: input.runId,
    model_policy_decision_id: input.modelPolicyDecisionId,
    model_name: input.modelName ?? `${dataset.name}-baseline`,
    artifact_id: training.model_artifact_id,
    experiment_id: experiment.id,
    training_run_id: training.id,
    evaluation_id: evaluation.id,
    metrics: training.metrics,
    metadata: input.metadata,
  });
  if (model === undefined) throw new Error('Model registration could not be completed.');

  const artifactIds = [
    dataset.versions.find((candidate) => candidate.version === version)?.artifact_id,
    profile.artifact_id,
    analysis.report_artifact_id,
    ...analysis.visualization_artifact_ids,
    analysis.notebook_artifact_id,
    ...training.checkpoint_artifact_ids,
    training.model_artifact_id,
    evaluation.artifact_id,
    model.artifact_id,
    ...model.lineage_artifact_ids,
  ].filter((id): id is string => id !== undefined);
  const uniqueArtifactIds = [...new Set(artifactIds)];
  const outputArtifacts = (await Promise.all(uniqueArtifactIds.map((id) => artifacts.get(id)))).filter(
    (artifact): artifact is Artifact => artifact !== undefined,
  );
  report('The local ML workflow is complete.');
  return {
    dataset,
    profile,
    analysis,
    experiment,
    training,
    evaluation,
    model,
    artifacts: outputArtifacts,
  };
}
