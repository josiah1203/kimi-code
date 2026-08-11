/**
 * `ml` domain — durable local-first ML workflow execution.
 *
 * Persists experiments, training runs, evaluations, comparisons, and model
 * versions through `IAtomicDocumentStore`; reads datasets and model bytes
 * through `datasets` and `artifacts`; and gates mutating work through
 * `policy`. The built-in executor implements reproducible constant,
 * linear-regression, and nearest-centroid models locally, while every output
 * remains a content-addressed artifact with explicit lineage. Bound at
 * Workspace scope.
 */

import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { ISessionProcessRunner, type IProcess } from '#/session/process/processRunner';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  evaluationCreateInputSchema,
  evaluationMetricSchema,
  evaluationRecommendationSchema,
  evaluationSchema,
  analysisCreateInputSchema,
  analysisSchema,
  experimentCompareInputSchema,
  experimentCreateInputSchema,
  experimentSchema,
  modelRegisterInputSchema,
  modelStageInputSchema,
  modelVersionSchema,
  nowIsoDateTime,
  trainingCancelInputSchema,
  trainingRunSchema,
  trainingStartInputSchema,
  type Evaluation,
  type EvaluationCreateInput,
  type Artifact,
  type Analysis,
  type AnalysisCreateInput,
  type Experiment,
  type ExperimentComparison,
  type ExperimentCompareInput,
  type ExperimentCreateInput,
  type ModelRegisterInput,
  type ModelStageInput,
  type ModelVersion,
  type TrainingCancelInput,
  type TrainingRun,
  type TrainingStartInput,
  type ExecutionTarget,
  type DatasetFormat,
} from '@spiderbyte/protocol';

import {
  IWorkspaceMlService,
  type WorkspaceMlChangedEvent,
} from './ml';
import { MlErrors, MlServiceError } from './errors';
import {
  configuredLocalTrainingExecutor,
  executeLocalTraining,
  type LocalTrainingExecutorConfig,
  type LocalTrainingResult,
} from './localTrainingExecutor';

const DOCUMENT_VERSION = 1;
const ML_KEY = 'ml.json';
const MAX_MODEL_BYTES = 2 * 1024 * 1024;

const remoteAnalysisReportSchema = z.object({
  row_count: z.number().int().nonnegative(),
  column_count: z.number().int().nonnegative(),
  input_digest: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough();

const remoteEvaluationReportSchema = z.object({
  sample_size: z.number().int().nonnegative(),
  input_digest: z.string().regex(/^[a-f0-9]{64}$/),
  metrics: z.array(evaluationMetricSchema),
  recommendation: evaluationRecommendationSchema,
  limitations: z.array(z.string().min(1).max(500)).default([]),
}).passthrough();

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  experiments: z.array(experimentSchema),
  training_runs: z.array(trainingRunSchema),
  evaluations: z.array(evaluationSchema),
  comparisons: z.array(z.any()),
  analyses: z.array(analysisSchema).default([]),
  models: z.array(modelVersionSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type MlDocument = {
  readonly version: 1;
  readonly experiments: readonly Experiment[];
  readonly training_runs: readonly TrainingRun[];
  readonly evaluations: readonly Evaluation[];
  readonly comparisons: readonly ExperimentComparison[];
  readonly analyses: readonly Analysis[];
  readonly models: readonly ModelVersion[];
  readonly requests: Readonly<Record<string, string>>;
};

interface CsvRow {
  readonly [key: string]: string;
}

interface BaselineModel {
  readonly schema_version: 1;
  readonly task: 'classification' | 'regression';
  readonly algorithm: string;
  readonly model_type?: 'constant' | 'linear_regression' | 'nearest_centroid';
  readonly target: string;
  readonly features: readonly string[];
  readonly prediction?: string | number;
  readonly intercept?: number;
  readonly weights?: readonly number[];
  readonly centroids?: Readonly<Record<string, readonly number[]>>;
  readonly training_rows: number;
  readonly metrics: Readonly<Record<string, number>>;
}

interface EvaluationModel extends BaselineModel {}

export class WorkspaceMlService extends Disposable implements IWorkspaceMlService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceMlChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceMlChangedEvent>());
  private readonly scope: string;
  private experiments: readonly Experiment[] = [];
  private trainingRuns: readonly TrainingRun[] = [];
  private evaluations: readonly Evaluation[] = [];
  private comparisons: readonly ExperimentComparison[] = [];
  private analyses: readonly Analysis[] = [];
  private models: readonly ModelVersion[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly activeLocalProcesses = new Map<string, IProcess>();
  private readonly cancellationRequests = new Set<string>();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspaceArtifactService private readonly artifacts: IWorkspaceArtifactService,
    @IWorkspaceDatasetService private readonly datasets: IWorkspaceDatasetService,
    @IWorkspaceExecutionTargetService private readonly executionTargets: IWorkspaceExecutionTargetService,
    @IWorkspaceExecutionService private readonly execution: IWorkspaceExecutionService,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
    @ISessionProcessRunner private readonly processes?: ISessionProcessRunner,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async listExperiments(): Promise<readonly Experiment[]> {
    await this.ready;
    return [...this.experiments];
  }

  async getExperiment(id: string): Promise<Experiment | undefined> {
    await this.ready;
    return this.experiments.find((experiment) => experiment.id === id);
  }

  async listAnalyses(): Promise<readonly Analysis[]> {
    await this.ready;
    return [...this.analyses];
  }

  async getAnalysis(id: string): Promise<Analysis | undefined> {
    await this.ready;
    return this.analyses.find((analysis) => analysis.id === id);
  }

  async analyze(input: AnalysisCreateInput): Promise<Analysis | undefined> {
    const command = analysisCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.analyses.find((analysis) => analysis.id === existingId);
      await this.requirePolicy(
        command.request_id,
        command.run_id,
        `dataset.analyze:${command.dataset_id}`,
        'dataset',
        command.dataset_policy_decision_id,
      );
      const dataset = await this.datasets.get(command.dataset_id);
      if (dataset === undefined) {
        throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `dataset not found: ${command.dataset_id}`);
      }
      const versionNumber = command.dataset_version ?? dataset.current_version;
      const version = dataset.versions.find((candidate) => candidate.version === versionNumber);
      if (version === undefined) {
        throw new MlServiceError(
          MlErrors.codes.ML_NOT_FOUND,
          `dataset version not found: ${command.dataset_id}@${versionNumber}`,
        );
      }
      const executionTarget = await this.prepareExecutionTarget(
        command.execution_target_id,
        command.request_id,
        command.run_id,
        command.execution_target_policy_decision_id,
      );
      if (executionTarget !== undefined && executionTarget.target.type !== 'local') {
        const analysisId = `analysis_${ulid()}`;
        try {
          const remote = await this.execution.execute({
            request_id: `${command.request_id}:worker`,
            run_id: command.run_id,
            target_id: executionTarget.target.id,
            lease_id: executionTarget.leaseId,
            operation: 'analysis',
            policy_decision_id: command.execution_target_policy_decision_id,
            payload: {
              analysis_id: analysisId,
              dataset_id: command.dataset_id,
              dataset_version: versionNumber,
              dataset_artifact_id: version.artifact_id,
              kind: command.kind,
              columns: command.columns,
              group_by: command.group_by,
              metadata: command.metadata,
            },
          });
          if (remote.status !== 'succeeded') {
            throw new MlServiceError(
              MlErrors.codes.ML_EXECUTION_FAILED,
              remote.error ?? `remote analysis failed on execution target ${executionTarget.target.id}`,
              { executionTargetId: executionTarget.target.id },
            );
          }
          assertSafeMetadata(remote.metadata);
          const outputArtifacts = await this.requireArtifacts(remote.output_artifact_ids);
          const reportArtifact = outputArtifacts.find((artifact) => artifact.kind === 'metrics');
          if (reportArtifact === undefined) {
            throw new MlServiceError(
              MlErrors.codes.ML_ARTIFACT_INVALID,
              'remote analysis did not return a metrics report artifact',
              { executionTargetId: executionTarget.target.id },
            );
          }
          const reportDownload = await this.artifacts.download(reportArtifact.id);
          if (reportDownload === undefined) {
            throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'remote analysis report artifact is unavailable');
          }
          const report = parseRemoteAnalysisReport(
            decodeArtifactText(reportDownload.content_base64, MAX_MODEL_BYTES),
          );
          const visualizationArtifactIds = outputArtifacts
            .filter((artifact) => artifact.kind === 'visualization')
            .map((artifact) => artifact.id);
          const notebookArtifactId = outputArtifacts.find((artifact) => artifact.kind === 'notebook')?.id;
          const createdAt = nowIsoDateTime();
          const result = analysisSchema.parse({
            id: analysisId,
            workspace_id: this.context.workspaceId,
            run_id: command.run_id,
            dataset_id: command.dataset_id,
            dataset_version: versionNumber,
            dataset_artifact_id: version.artifact_id,
            kind: command.kind,
            row_count: report.row_count,
            column_count: report.column_count,
            report_artifact_id: reportArtifact.id,
            visualization_artifact_ids: visualizationArtifactIds,
            notebook_artifact_id: notebookArtifactId,
            input_digest: report.input_digest,
            created_at: createdAt,
            metadata: mergeRemoteMetadata(command.metadata, remote.metadata, {
              execution_target_id: executionTarget.target.id,
              execution_target_type: executionTarget.target.type,
              execution_operation: 'analysis',
            }),
          });
          await this.replace({
            experiments: this.experiments,
            training_runs: this.trainingRuns,
            evaluations: this.evaluations,
            comparisons: this.comparisons,
            analyses: [...this.analyses, result],
            models: this.models,
            requests: { ...this.requests, [command.request_id]: result.id },
          });
          await this.events.append({
            event_type: 'analysis.completed',
            entity_type: 'analysis',
            entity_id: result.id,
            request_id: command.request_id,
            actor: 'agent',
            state: result.kind,
            payload: {
              dataset_id: result.dataset_id,
              report_artifact_id: result.report_artifact_id,
              visualization_artifact_ids: result.visualization_artifact_ids,
              execution_target_id: executionTarget.target.id,
            },
          });
          this.changes.fire({ kind: 'analysis_created', analysis: result });
          return result;
        } finally {
          await this.releaseExecutionTarget(executionTarget, command.request_id);
        }
      }
      const download = await this.artifacts.download(version.artifact_id);
      if (download === undefined) {
        throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'analysis dataset artifact is unavailable');
      }
      const rows = parseDataset(decodeArtifactText(download.content_base64, MAX_MODEL_BYTES), dataset.format);
      const availableColumns = Object.keys(rows[0] ?? {});
      const selectedColumns = command.columns === undefined
        ? availableColumns
        : command.columns;
      for (const column of selectedColumns) {
        if (!availableColumns.includes(column)) {
          throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, `analysis column is not present in the dataset: ${column}`);
        }
      }
      if (command.group_by !== undefined && !availableColumns.includes(command.group_by)) {
        throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, `group_by column is not present in the dataset: ${command.group_by}`);
      }
      const summary = summarizeRows(rows, selectedColumns, command.group_by);
      const analysisId = `analysis_${ulid()}`;
      const reportArtifact = await this.createArtifact({
        request_id: `${command.request_id}:report`,
        run_id: command.run_id,
        name: `${dataset.name}.analysis.json`,
        kind: 'metrics',
        content: JSON.stringify({
          analysis_id: analysisId,
          dataset_id: command.dataset_id,
          version: versionNumber,
          kind: command.kind,
          row_count: rows.length,
          columns: summary,
          group_by: command.group_by,
        }),
        sourceArtifactIds: [version.artifact_id],
        metadata: { analysis_id: analysisId, dataset_id: command.dataset_id },
      });
      const visualizationArtifact = await this.createArtifact({
        request_id: `${command.request_id}:visualization`,
        run_id: command.run_id,
        name: `${dataset.name}.analysis.svg`,
        kind: 'visualization',
        mediaType: 'image/svg+xml',
        content: renderAnalysisSvg(dataset.name, summary),
        sourceArtifactIds: [version.artifact_id, reportArtifact.id],
        metadata: { analysis_id: analysisId, visualization: true },
      });
      let notebookArtifactId: string | undefined;
      if (command.kind === 'notebook') {
        const notebook = await this.createArtifact({
          request_id: `${command.request_id}:notebook`,
          run_id: command.run_id,
          name: `${dataset.name}.analysis.ipynb.json`,
          kind: 'notebook',
          content: JSON.stringify({
            cells: [
              { cell_type: 'markdown', source: [`# Analysis of ${dataset.name}`] },
              { cell_type: 'code', source: ['# Native local analysis result; no executable code is persisted.'], outputs: [summary] },
            ],
            metadata: { dataset_id: command.dataset_id, version: versionNumber },
          }),
          sourceArtifactIds: [version.artifact_id, reportArtifact.id],
          metadata: { analysis_id: analysisId, notebook: true },
        });
        notebookArtifactId = notebook.id;
      }
      const createdAt = nowIsoDateTime();
      const inputDigest = createHash('sha256')
        .update(JSON.stringify({ dataset_artifact_id: version.artifact_id, kind: command.kind, columns: selectedColumns, group_by: command.group_by }))
        .digest('hex');
      const result = analysisSchema.parse({
        id: analysisId,
        workspace_id: this.context.workspaceId,
        run_id: command.run_id,
        dataset_id: command.dataset_id,
        dataset_version: versionNumber,
        dataset_artifact_id: version.artifact_id,
        kind: command.kind,
        row_count: rows.length,
        column_count: selectedColumns.length,
        report_artifact_id: reportArtifact.id,
        visualization_artifact_ids: [visualizationArtifact.id],
        notebook_artifact_id: notebookArtifactId,
        input_digest: inputDigest,
        created_at: createdAt,
        metadata: command.metadata,
      });
      await this.replace({
        experiments: this.experiments,
        training_runs: this.trainingRuns,
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: [...this.analyses, result],
        models: this.models,
        requests: { ...this.requests, [command.request_id]: result.id },
      });
      await this.events.append({
        event_type: 'analysis.completed',
        entity_type: 'analysis',
        entity_id: result.id,
        request_id: command.request_id,
        actor: 'agent',
        state: result.kind,
        payload: {
          dataset_id: result.dataset_id,
          report_artifact_id: result.report_artifact_id,
          visualization_artifact_ids: result.visualization_artifact_ids,
        },
      });
      this.changes.fire({ kind: 'analysis_created', analysis: result });
      return result;
    });
  }

  async createExperiment(input: ExperimentCreateInput): Promise<Experiment> {
    const command = experimentCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    assertSafeMetadata(command.hyperparameters);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.requireExperiment(existingId);
      await this.requirePolicy(command.request_id, command.run_id, `dataset.read:${command.dataset_id}`, 'dataset', command.dataset_policy_decision_id);
      await this.requirePolicy(
        command.request_id,
        command.run_id,
        `experiment.create:${command.name}`,
        'model',
        command.model_policy_decision_id,
      );
      const dataset = await this.datasets.get(command.dataset_id);
      if (dataset === undefined) {
        throw new MlServiceError(
          MlErrors.codes.ML_NOT_FOUND,
          `dataset not found: ${command.dataset_id}`,
          { datasetId: command.dataset_id },
        );
      }
      const versionNumber = command.dataset_version ?? dataset.current_version;
      const version = dataset.versions.find((candidate) => candidate.version === versionNumber);
      if (version === undefined) {
        throw new MlServiceError(
          MlErrors.codes.ML_NOT_FOUND,
          `dataset version not found: ${command.dataset_id}@${versionNumber}`,
          { datasetId: command.dataset_id, version: versionNumber },
        );
      }
      const configuredTarget = command.execution_target_id === undefined
        ? undefined
        : await this.executionTargets.get(command.execution_target_id);
      if (command.execution_target_id !== undefined && configuredTarget === undefined) {
        throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `execution target not found: ${command.execution_target_id}`, {
          executionTargetId: command.execution_target_id,
        });
      }
      validateExperimentFields(
        command,
        version.columns.map((column) => column.name),
        configuredTarget?.type !== 'local',
        configuredLocalExecutor() !== undefined,
      );
      const now = nowIsoDateTime();
      const experiment = experimentSchema.parse({
        id: `experiment_${ulid()}`,
        workspace_id: this.context.workspaceId,
        name: command.name,
        dataset_id: command.dataset_id,
        dataset_version: versionNumber,
        dataset_artifact_id: version.artifact_id,
        target: command.target,
        features: command.features,
        task: command.task,
        algorithm: command.algorithm,
        execution_target_id: command.execution_target_id,
        metrics: command.metrics,
        hyperparameters: command.hyperparameters,
        seed: command.seed,
        state: 'ready',
        run_ids: command.run_id === undefined ? [] : [command.run_id],
        training_run_ids: [],
        model_version_ids: [],
        latest_run_id: command.run_id,
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      await this.replace({
        experiments: [...this.experiments, experiment],
        training_runs: this.trainingRuns,
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: this.models,
        requests: { ...this.requests, [command.request_id]: experiment.id },
      });
      await this.events.append({
        event_type: 'experiment.created',
        entity_type: 'experiment',
        entity_id: experiment.id,
        request_id: command.request_id,
        actor: 'agent',
        state: experiment.state,
        payload: {
          dataset_id: experiment.dataset_id,
          dataset_version: experiment.dataset_version,
          task: experiment.task,
        },
      });
      this.changes.fire({ kind: 'experiment_created', experiment });
      return experiment;
    });
  }

  async validateExperiment(id: string, requestId: string): Promise<Experiment | undefined> {
    return this.enqueue(async () => {
      await this.ready;
      const current = this.experiments.find((experiment) => experiment.id === id);
      if (current === undefined) return undefined;
      const mapped = this.requests[requestId];
      if (mapped !== undefined) return this.requireExperiment(mapped);
      const dataset = await this.datasets.get(current.dataset_id);
      const version = dataset?.versions.find((candidate) => candidate.version === current.dataset_version);
      if (dataset === undefined || version === undefined) {
        throw new MlServiceError(MlErrors.codes.ML_LINEAGE_INVALID, `experiment dataset is unavailable: ${id}`, {
          experimentId: id,
        });
      }
      const configuredTarget = current.execution_target_id === undefined
        ? undefined
        : await this.executionTargets.get(current.execution_target_id);
      validateExperimentFields(
        current,
        version.columns.map((column) => column.name),
        configuredTarget?.type !== 'local',
        configuredLocalExecutor() !== undefined,
      );
      const next = experimentSchema.parse({ ...current, state: 'ready', updated_at: nowIsoDateTime() });
      await this.replace({
        experiments: this.experiments.map((candidate) => (candidate.id === id ? next : candidate)),
        training_runs: this.trainingRuns,
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: this.models,
        requests: { ...this.requests, [requestId]: id },
      });
      await this.events.append({
        event_type: 'experiment.validated',
        entity_type: 'experiment',
        entity_id: id,
        request_id: requestId,
        actor: 'agent',
        state: next.state,
      });
      this.changes.fire({ kind: 'experiment_updated', experiment: next });
      return next;
    });
  }

  async listTrainingRuns(experimentId?: string): Promise<readonly TrainingRun[]> {
    await this.ready;
    return this.trainingRuns.filter((run) => experimentId === undefined || run.experiment_id === experimentId);
  }

  async getTrainingRun(id: string): Promise<TrainingRun | undefined> {
    await this.ready;
    return this.trainingRuns.find((run) => run.id === id);
  }

  async startTraining(experimentId: string, input: TrainingStartInput): Promise<TrainingRun | undefined> {
    const command = trainingStartInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const experiment = this.experiments.find((candidate) => candidate.id === experimentId);
      if (experiment === undefined) return undefined;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.requireTraining(existingId);
      if (!['ready', 'failed'].includes(experiment.state)) {
        throw new MlServiceError(
          MlErrors.codes.ML_INVALID_STATE,
          `experiment cannot start training from state ${experiment.state}`,
          { experimentId, state: experiment.state },
        );
      }
      await this.requirePolicy(command.request_id, command.run_id, `dataset.read:${experiment.dataset_id}`, 'dataset', command.dataset_policy_decision_id);
      await this.requirePolicy(command.request_id, command.run_id, `model.train:${experiment.name}`, 'model', command.model_policy_decision_id);
      const target = command.execution_target_id ?? experiment.execution_target_id;
      let executionTarget: ExecutionTarget | undefined;
      let executionLeaseId: string | undefined;
      if (target !== undefined) {
        executionTarget = await this.executionTargets.get(target);
        if (executionTarget === undefined) {
          throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `execution target not found: ${target}`, {
            executionTargetId: target,
          });
        }
        if (executionTarget.state !== 'ready') {
          throw new MlServiceError(
            MlErrors.codes.ML_EXECUTOR_UNAVAILABLE,
            `execution target is not ready: ${target}`,
            { executionTargetId: target, state: executionTarget.state },
          );
        }
      }
      if (executionTarget !== undefined && executionTarget.type !== 'local') {
        const lease = await this.executionTargets.acquireLease(executionTarget.id, {
          request_id: `${command.request_id}:lease`,
          run_id: command.run_id,
          duration_seconds: 3_600,
          policy_decision_id: command.execution_target_policy_decision_id,
        });
        if (lease.state !== 'active') {
          throw new MlServiceError(
            MlErrors.codes.ML_POLICY_REQUIRED,
            'execution target approval is required',
            { policyDecisionId: lease.policy_decision_id, executionTargetId: executionTarget.id },
          );
        }
        executionLeaseId = lease.id;
      }
      const trainingId = `training_${ulid()}`;
      const now = nowIsoDateTime();
      const running = trainingRunSchema.parse({
        id: trainingId,
        workspace_id: this.context.workspaceId,
        experiment_id: experiment.id,
        run_id: command.run_id,
        status: 'running',
        execution_target_id: target,
        execution_target_policy_decision_id: command.execution_target_policy_decision_id,
        executor: executorForTarget(executionTarget),
        dataset_artifact_id: experiment.dataset_artifact_id,
        metrics: {},
        checkpoint_artifact_ids: [],
        started_at: now,
        created_at: now,
        metadata: {
          ...command.metadata,
          ...(executionTarget !== undefined && executionTarget.type !== 'local'
            ? { execution_request_id: `${command.request_id}:worker` }
            : {}),
        },
      });
      await this.replace({
        experiments: this.experiments.map((candidate) =>
          candidate.id === experiment.id
            ? experimentSchema.parse({
                ...candidate,
                state: 'running',
                run_ids: candidate.run_ids.includes(command.run_id)
                  ? candidate.run_ids
                  : [...candidate.run_ids, command.run_id],
                training_run_ids: [...candidate.training_run_ids, trainingId],
                latest_run_id: command.run_id,
                updated_at: now,
              })
            : candidate,
        ),
        training_runs: [...this.trainingRuns, running],
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: this.models,
        requests: { ...this.requests, [command.request_id]: trainingId },
      });
      this.changes.fire({ kind: 'training_updated', training: running });

      try {
        if (executionTarget !== undefined && executionTarget.type !== 'local') {
          const remote = await this.execution.execute({
            request_id: `${command.request_id}:worker`,
            run_id: command.run_id,
            target_id: executionTarget.id,
            lease_id: executionLeaseId,
            operation: 'training',
            policy_decision_id: command.model_policy_decision_id,
            payload: {
              experiment_id: experiment.id,
              training_run_id: trainingId,
              dataset_artifact_id: experiment.dataset_artifact_id,
              target: experiment.target,
              features: experiment.features,
              task: experiment.task,
              algorithm: experiment.algorithm,
              hyperparameters: experiment.hyperparameters,
              seed: experiment.seed,
              metadata: command.metadata,
            },
          });
          if (this.cancellationRequests.has(trainingId)) {
            throw new MlServiceError(MlErrors.codes.ML_EXECUTION_FAILED, 'cancelled_by_request');
          }
          if (remote.status !== 'succeeded') {
            throw new MlServiceError(
              MlErrors.codes.ML_EXECUTOR_UNAVAILABLE,
              remote.error ?? `remote training failed on execution target ${executionTarget.id}`,
              { executionTargetId: executionTarget.id },
            );
          }
          const outputArtifacts = await Promise.all(
            remote.output_artifact_ids.map((artifactId) => this.artifacts.get(artifactId)),
          );
          const modelArtifact = outputArtifacts.find((artifact) => artifact?.kind === 'model');
          const checkpointArtifactIds = outputArtifacts
            .filter((artifact) => artifact?.kind === 'bundle')
            .map((artifact) => artifact!.id);
          if (modelArtifact === undefined) {
            throw new MlServiceError(
              MlErrors.codes.ML_ARTIFACT_INVALID,
              'remote training did not return a model artifact',
              { executionTargetId: executionTarget.id },
            );
          }
          const completed = trainingRunSchema.parse({
            ...running,
            status: 'succeeded',
            metrics: remote.metrics ?? numericMetadata(remote.metadata?.['metrics']),
            checkpoint_artifact_ids: checkpointArtifactIds,
            model_artifact_id: modelArtifact.id,
            environment: remote.metadata,
            completed_at: nowIsoDateTime(),
          });
          const completedExperiment = experimentSchema.parse({
            ...experiment,
            state: 'completed',
            updated_at: completed.completed_at,
          });
          await this.replace({
            experiments: this.experiments.map((candidate) => candidate.id === experiment.id ? completedExperiment : candidate),
            training_runs: this.trainingRuns.map((candidate) => candidate.id === trainingId ? completed : candidate),
            evaluations: this.evaluations,
            comparisons: this.comparisons,
            analyses: this.analyses,
            models: this.models,
            requests: this.requests,
          });
          await this.events.append({
            event_type: 'training_run.completed',
            entity_type: 'training_run',
            entity_id: trainingId,
            request_id: command.request_id,
            actor: 'agent',
            state: completed.status,
            payload: {
              experiment_id: experiment.id,
              model_artifact_id: modelArtifact.id,
              execution_target_id: executionTarget.id,
            },
          });
          this.changes.fire({ kind: 'training_updated', training: completed, experiment: completedExperiment });
          if (executionLeaseId !== undefined) {
            await this.executionTargets.releaseLease(executionTarget.id, executionLeaseId, {
              request_id: `${command.request_id}:lease:release`,
            }).catch(() => undefined);
          }
          return completed;
        }
        const datasetArtifact = await this.artifacts.download(experiment.dataset_artifact_id);
        if (datasetArtifact === undefined) throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'dataset artifact is unavailable');
        const content = decodeArtifactText(datasetArtifact.content_base64, MAX_MODEL_BYTES);
        const datasetRecord = await this.datasets.get(experiment.dataset_id);
        if (datasetRecord === undefined) {
          throw new MlServiceError(
            MlErrors.codes.ML_LINEAGE_INVALID,
            `training dataset is unavailable: ${experiment.dataset_id}`,
          );
        }
        const rows = parseDataset(content, datasetRecord.format);
        if (this.cancellationRequests.has(trainingId)) {
          throw new MlServiceError(MlErrors.codes.ML_EXECUTION_FAILED, 'cancelled_by_request');
        }
        const configuredExecutor = configuredLocalExecutor();
        const external = configuredExecutor === undefined
          ? undefined
          : await this.runConfiguredLocalTraining(
            configuredExecutor,
            experiment,
            trainingId,
            command.run_id,
            rows,
            content,
            datasetRecord.format,
          );
        const model = external === undefined ? trainBaseline(experiment, rows) : undefined;
        if (external?.environment !== undefined) assertSafeMetadata(external.environment);
        if (external !== undefined) validateExternalTrainingResult(experiment, external);
        const modelContent = external?.model_content ?? JSON.stringify(model) ?? '{}';
        const checkpointContent = external?.checkpoint_content ?? modelContent;
        const metrics = external?.metrics ?? model?.metrics ?? {};
        const metricsArtifact = await this.createArtifact({
          request_id: `${command.request_id}:metrics`,
          run_id: command.run_id,
          name: `${experiment.name}.metrics.json`,
          kind: 'metrics',
          content: JSON.stringify({
            experiment_id: experiment.id,
            training_run_id: trainingId,
            metrics,
            executor: external === undefined ? 'builtin-baseline' : 'configured-local',
          }),
          sourceArtifactIds: [experiment.dataset_artifact_id],
          metadata: { experiment_id: experiment.id, training_run_id: trainingId },
        });
        const checkpointArtifact = await this.createArtifact({
          request_id: `${command.request_id}:checkpoint`,
          run_id: command.run_id,
          name: `${experiment.name}.checkpoint.json`,
          kind: 'bundle',
          content: checkpointContent,
          sourceArtifactIds: [experiment.dataset_artifact_id, metricsArtifact.id],
          metadata: { experiment_id: experiment.id, training_run_id: trainingId, checkpoint: true },
        });
        const modelArtifact = await this.createArtifact({
          request_id: `${command.request_id}:model`,
          run_id: command.run_id,
          name: `${experiment.name}.model.json`,
          kind: 'model',
          content: modelContent,
          sourceArtifactIds: [experiment.dataset_artifact_id, checkpointArtifact.id, metricsArtifact.id],
          metadata: { experiment_id: experiment.id, training_run_id: trainingId },
        });
        const completed = trainingRunSchema.parse({
          ...running,
          status: 'succeeded',
          metrics,
          checkpoint_artifact_ids: [checkpointArtifact.id],
          model_artifact_id: modelArtifact.id,
          environment: external?.environment,
          completed_at: nowIsoDateTime(),
        });
        const completedExperiment = experimentSchema.parse({
          ...experiment,
          state: 'completed',
          updated_at: completed.completed_at,
        });
        await this.replace({
          experiments: this.experiments.map((candidate) =>
            candidate.id === experiment.id ? completedExperiment : candidate,
          ),
          training_runs: this.trainingRuns.map((candidate) => (candidate.id === trainingId ? completed : candidate)),
          evaluations: this.evaluations,
          comparisons: this.comparisons,
          analyses: this.analyses,
          models: this.models,
          requests: this.requests,
        });
        if (external?.logs !== undefined) {
          await this.createArtifact({
            request_id: `${command.request_id}:logs`,
            run_id: command.run_id,
            name: `${experiment.name}.training.log`,
            kind: 'log',
            mediaType: 'text/plain',
            content: redactTrainingText(external.logs),
            sourceArtifactIds: [experiment.dataset_artifact_id, modelArtifact.id],
            metadata: { experiment_id: experiment.id, training_run_id: trainingId },
          });
        }
        await this.events.append({
          event_type: 'training_run.completed',
          entity_type: 'training_run',
          entity_id: trainingId,
          request_id: command.request_id,
          actor: 'agent',
          state: completed.status,
          payload: { experiment_id: experiment.id, model_artifact_id: modelArtifact.id },
        });
        this.changes.fire({ kind: 'training_updated', training: completed, experiment: completedExperiment });
        return completed;
      } catch (error) {
        if (executionLeaseId !== undefined && executionTarget !== undefined) {
          await this.executionTargets.releaseLease(executionTarget.id, executionLeaseId, {
            request_id: `${command.request_id}:lease:release`,
          }).catch(() => undefined);
        }
        const cancelled = this.cancellationRequests.delete(trainingId);
        const finished = trainingRunSchema.parse({
          ...running,
          status: cancelled ? 'cancelled' : 'failed',
          completed_at: nowIsoDateTime(),
          error: cancelled ? 'cancelled_by_request' : safeError(error),
        });
        const finishedExperiment = experimentSchema.parse({
          ...experiment,
          state: cancelled ? 'ready' : 'failed',
          updated_at: finished.completed_at,
        });
        await this.replace({
          experiments: this.experiments.map((candidate) =>
            candidate.id === experiment.id ? finishedExperiment : candidate,
          ),
          training_runs: this.trainingRuns.map((candidate) => (candidate.id === trainingId ? finished : candidate)),
          evaluations: this.evaluations,
          comparisons: this.comparisons,
          analyses: this.analyses,
          models: this.models,
          requests: this.requests,
        });
        await this.events.append({
          event_type: cancelled ? 'training_run.cancelled' : 'training_run.failed',
          entity_type: 'training_run',
          entity_id: trainingId,
          request_id: command.request_id,
          actor: 'agent',
          state: finished.status,
          payload: { experiment_id: experiment.id, error: finished.error },
        });
        this.changes.fire({ kind: 'training_updated', training: finished, experiment: finishedExperiment });
        return finished;
      }
    });
  }

  async cancelTraining(id: string, input: TrainingCancelInput): Promise<TrainingRun | undefined> {
    const command = trainingCancelInputSchema.parse(input);
    await this.ready;
    const initial = this.trainingRuns.find((run) => run.id === id);
    if (initial === undefined) return undefined;
    if (this.requests[command.request_id] !== undefined) {
      return this.requireTraining(this.requests[command.request_id]!);
    }
    if (initial.status === 'running' || initial.status === 'queued') {
      // Authorize before touching the child process. Once authorized, killing
      // the local process is safe and the serialized state transition below
      // records the cancellation durably even when the executor is remote to
      // this call stack (for example, a background conversational Run).
      await this.requirePolicy(
        command.request_id,
        initial.run_id,
        `model.train.cancel:${initial.id}`,
        'model',
        command.model_policy_decision_id,
      );
      this.cancellationRequests.add(id);
      const process = this.activeLocalProcesses.get(id);
      if (process !== undefined) await process.kill('SIGKILL').catch(() => undefined);
      const executionRequestId = initial.metadata?.['execution_request_id'];
      if (typeof executionRequestId === 'string') {
        await this.execution.cancel(executionRequestId).catch(() => false);
      }
    }
    return this.enqueue(async () => {
      await this.ready;
      const current = this.trainingRuns.find((run) => run.id === id);
      if (current === undefined) {
        this.cancellationRequests.delete(id);
        return undefined;
      }
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireTraining(mapped);
      if (current.status !== 'running' && current.status !== 'queued') {
        this.cancellationRequests.delete(id);
        await this.replace({
          experiments: this.experiments,
          training_runs: this.trainingRuns,
          evaluations: this.evaluations,
          comparisons: this.comparisons,
          analyses: this.analyses,
          models: this.models,
          requests: { ...this.requests, [command.request_id]: id },
        });
        return current;
      }
      const next = trainingRunSchema.parse({
        ...current,
        status: 'cancelled',
        completed_at: nowIsoDateTime(),
        error: 'cancelled_by_request',
      });
      this.cancellationRequests.delete(id);
      const experiment = this.experiments.find((candidate) => candidate.id === current.experiment_id);
      await this.replace({
        experiments: experiment === undefined
          ? this.experiments
          : this.experiments.map((candidate) => candidate.id === experiment.id
            ? experimentSchema.parse({ ...candidate, state: 'ready', updated_at: next.completed_at })
            : candidate),
        training_runs: this.trainingRuns.map((run) => (run.id === id ? next : run)),
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: this.models,
        requests: { ...this.requests, [command.request_id]: id },
      });
      await this.events.append({
        event_type: 'training_run.cancelled',
        entity_type: 'training_run',
        entity_id: id,
        request_id: command.request_id,
        actor: 'agent',
        state: next.status,
      });
      this.changes.fire({ kind: 'training_updated', training: next });
      return next;
    });
  }

  async listEvaluations(experimentId?: string): Promise<readonly Evaluation[]> {
    await this.ready;
    return this.evaluations.filter((evaluation) => experimentId === undefined || evaluation.experiment_id === experimentId);
  }

  async getEvaluation(id: string): Promise<Evaluation | undefined> {
    await this.ready;
    return this.evaluations.find((evaluation) => evaluation.id === id);
  }

  async evaluate(input: EvaluationCreateInput): Promise<Evaluation | undefined> {
    const command = evaluationCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.evaluations.find((evaluation) => evaluation.id === existingId);
      await this.requirePolicy(command.request_id, command.run_id, `dataset.read:${command.dataset_id}`, 'dataset', command.dataset_policy_decision_id);
      await this.requirePolicy(command.request_id, command.run_id, `model.evaluate:${command.benchmark_id}`, 'model', command.model_policy_decision_id);
      const dataset = await this.datasets.get(command.dataset_id);
      if (dataset === undefined) throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `dataset not found: ${command.dataset_id}`);
      const versionNumber = command.dataset_version ?? dataset.current_version;
      const version = dataset.versions.find((candidate) => candidate.version === versionNumber);
      if (version === undefined) throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `dataset version not found: ${command.dataset_id}@${versionNumber}`);
      const executionTarget = await this.prepareExecutionTarget(
        command.execution_target_id,
        command.request_id,
        command.run_id,
        command.execution_target_policy_decision_id,
      );
      if (executionTarget !== undefined && executionTarget.target.type !== 'local') {
        const evaluationId = `evaluation_${ulid()}`;
        try {
          const remote = await this.execution.execute({
            request_id: `${command.request_id}:worker`,
            run_id: command.run_id,
            target_id: executionTarget.target.id,
            lease_id: executionTarget.leaseId,
            operation: 'evaluation',
            policy_decision_id: command.execution_target_policy_decision_id,
            payload: {
              evaluation_id: evaluationId,
              experiment_id: command.experiment_id,
              dataset_id: command.dataset_id,
              dataset_version: versionNumber,
              dataset_artifact_id: version.artifact_id,
              candidate_model_artifact_id: command.candidate_model_artifact_id,
              baseline_model_artifact_id: command.baseline_model_artifact_id,
              benchmark_id: command.benchmark_id,
              benchmark_version: command.benchmark_version,
              minimum_sample_size: command.minimum_sample_size,
              metrics: command.metrics,
              limitations: command.limitations,
              metadata: command.metadata,
            },
          });
          if (remote.status !== 'succeeded') {
            throw new MlServiceError(
              MlErrors.codes.ML_EXECUTION_FAILED,
              remote.error ?? `remote evaluation failed on execution target ${executionTarget.target.id}`,
              { executionTargetId: executionTarget.target.id },
            );
          }
          assertSafeMetadata(remote.metadata);
          const outputArtifacts = await this.requireArtifacts(remote.output_artifact_ids);
          const reportArtifact = outputArtifacts.find((artifact) => artifact.kind === 'metrics');
          if (reportArtifact === undefined) {
            throw new MlServiceError(
              MlErrors.codes.ML_ARTIFACT_INVALID,
              'remote evaluation did not return a metrics report artifact',
              { executionTargetId: executionTarget.target.id },
            );
          }
          const reportDownload = await this.artifacts.download(reportArtifact.id);
          if (reportDownload === undefined) {
            throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'remote evaluation report artifact is unavailable');
          }
          const report = parseRemoteEvaluationReport(
            decodeArtifactText(reportDownload.content_base64, MAX_MODEL_BYTES),
          );
          if (report.sample_size < command.minimum_sample_size) {
            throw new MlServiceError(
              MlErrors.codes.ML_INVALID_INPUT,
              `remote evaluation returned only ${report.sample_size} samples; ${command.minimum_sample_size} are required`,
            );
          }
          const resultWithoutArtifact = {
            id: evaluationId,
            workspace_id: this.context.workspaceId,
            experiment_id: command.experiment_id,
            run_id: command.run_id,
            dataset_artifact_id: version.artifact_id,
            candidate_model_artifact_id: command.candidate_model_artifact_id,
            baseline_model_artifact_id: command.baseline_model_artifact_id,
            benchmark_id: command.benchmark_id,
            benchmark_version: command.benchmark_version,
            sample_size: report.sample_size,
            input_digest: report.input_digest,
            metrics: report.metrics,
            recommendation: report.recommendation,
            limitations: [...command.limitations, ...report.limitations],
            created_at: nowIsoDateTime(),
            metadata: mergeRemoteMetadata(command.metadata, remote.metadata, {
              execution_target_id: executionTarget.target.id,
              execution_target_type: executionTarget.target.type,
              execution_operation: 'evaluation',
            }),
          };
          const result = evaluationSchema.parse({ ...resultWithoutArtifact, artifact_id: reportArtifact.id });
          const experiment = command.experiment_id === undefined
            ? undefined
            : this.experiments.find((candidate) => candidate.id === command.experiment_id);
          await this.replace({
            experiments: experiment === undefined
              ? this.experiments
              : this.experiments.map((candidate) => candidate.id === experiment.id
                ? experimentSchema.parse({ ...candidate, updated_at: result.created_at })
                : candidate),
            training_runs: this.trainingRuns,
            evaluations: [...this.evaluations, result],
            comparisons: this.comparisons,
            analyses: this.analyses,
            models: this.models,
            requests: { ...this.requests, [command.request_id]: result.id },
          });
          await this.events.append({
            event_type: 'evaluation.completed',
            entity_type: 'evaluation',
            entity_id: result.id,
            request_id: command.request_id,
            actor: 'agent',
            state: result.recommendation,
            payload: {
              run_id: result.run_id,
              artifact_id: result.artifact_id,
              sample_size: result.sample_size,
              execution_target_id: executionTarget.target.id,
            },
          });
          this.changes.fire({ kind: 'evaluation_created', evaluation: result });
          return result;
        } finally {
          await this.releaseExecutionTarget(executionTarget, command.request_id);
        }
      }
      const modelDownload = await this.artifacts.download(command.candidate_model_artifact_id);
      const dataDownload = await this.artifacts.download(version.artifact_id);
      if (modelDownload === undefined || dataDownload === undefined) {
        throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'evaluation input artifact is unavailable');
      }
      const model = parseModel(decodeArtifactText(modelDownload.content_base64, MAX_MODEL_BYTES));
      const rows = parseDataset(decodeArtifactText(dataDownload.content_base64, MAX_MODEL_BYTES), dataset.format);
      const metrics = evaluateModel(model, rows, command.metrics);
      if (rows.length < command.minimum_sample_size) {
        throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, `evaluation requires at least ${command.minimum_sample_size} rows`);
      }
      let baselineModel: EvaluationModel | undefined;
      if (command.baseline_model_artifact_id !== undefined) {
        const baselineDownload = await this.artifacts.download(command.baseline_model_artifact_id);
        if (baselineDownload === undefined) {
          throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'baseline model artifact is unavailable');
        }
        baselineModel = parseModel(decodeArtifactText(baselineDownload.content_base64, MAX_MODEL_BYTES));
      }
      const baselineMetrics = baselineModel === undefined ? undefined : evaluateModel(baselineModel, rows, command.metrics);
      const evaluationMetrics = mergeEvaluationMetrics(metrics, baselineMetrics, command.metrics);
      const recommendation = recommendationFor(evaluationMetrics);
      const inputDigest = createHash('sha256')
        .update(JSON.stringify({ model: command.candidate_model_artifact_id, baseline: command.baseline_model_artifact_id, dataset: version.artifact_id, benchmark: command.benchmark_id, rows }))
        .digest('hex');
      const evaluationId = `evaluation_${ulid()}`;
      const resultWithoutArtifact = {
        id: evaluationId,
        workspace_id: this.context.workspaceId,
        experiment_id: command.experiment_id,
        run_id: command.run_id,
        dataset_artifact_id: version.artifact_id,
        candidate_model_artifact_id: command.candidate_model_artifact_id,
        baseline_model_artifact_id: command.baseline_model_artifact_id,
        benchmark_id: command.benchmark_id,
        benchmark_version: command.benchmark_version,
        sample_size: rows.length,
        input_digest: inputDigest,
        metrics: evaluationMetrics,
        recommendation,
        limitations: [
          ...command.limitations,
          ...(baselineModel === undefined ? ['No baseline model was supplied.'] : []),
        ],
        created_at: nowIsoDateTime(),
        metadata: command.metadata,
      };
      const artifact = await this.createArtifact({
        request_id: `${command.request_id}:report`,
        run_id: command.run_id,
        name: `${command.benchmark_id}.evaluation.json`,
        kind: 'metrics',
        content: JSON.stringify(resultWithoutArtifact),
        sourceArtifactIds: [version.artifact_id, command.candidate_model_artifact_id, ...(command.baseline_model_artifact_id === undefined ? [] : [command.baseline_model_artifact_id])],
        metadata: { evaluation_id: evaluationId, benchmark_id: command.benchmark_id },
      });
      const result = evaluationSchema.parse({ ...resultWithoutArtifact, artifact_id: artifact.id });
      const experiment = command.experiment_id === undefined ? undefined : this.experiments.find((candidate) => candidate.id === command.experiment_id);
      await this.replace({
        experiments: experiment === undefined ? this.experiments : this.experiments.map((candidate) => candidate.id === experiment.id ? experimentSchema.parse({ ...candidate, updated_at: result.created_at }) : candidate),
        training_runs: this.trainingRuns,
        evaluations: [...this.evaluations, result],
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: this.models,
        requests: { ...this.requests, [command.request_id]: result.id },
      });
      await this.events.append({
        event_type: 'evaluation.completed',
        entity_type: 'evaluation',
        entity_id: result.id,
        request_id: command.request_id,
        actor: 'agent',
        state: result.recommendation,
        payload: { run_id: result.run_id, artifact_id: result.artifact_id, sample_size: result.sample_size },
      });
      this.changes.fire({ kind: 'evaluation_created', evaluation: result });
      return result;
    });
  }

  async compare(input: ExperimentCompareInput): Promise<ExperimentComparison | undefined> {
    const command = experimentCompareInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.comparisons.find((comparison) => comparison.id === existingId);
      await this.requirePolicy(command.request_id, command.run_id, 'experiment.compare', 'model', command.model_policy_decision_id);
      const experiments = command.experiment_ids.map((id) => this.requireExperiment(id));
      if (experiments.some((experiment) => experiment.state !== 'completed')) {
        throw new MlServiceError(MlErrors.codes.ML_INVALID_STATE, 'only completed experiments can be compared');
      }
      const metrics: Record<string, Record<string, number>> = {};
      for (const experiment of experiments) {
        const runs = this.trainingRuns.filter((run) => run.experiment_id === experiment.id && run.status === 'succeeded');
        const latest = runs.at(-1);
        for (const [name, value] of Object.entries(latest?.metrics ?? {})) {
          (metrics[name] ??= {})[experiment.id] = value;
        }
      }
      const comparisonId = `comparison_${ulid()}`;
      const artifact = await this.createArtifact({
        request_id: `${command.request_id}:report`,
        run_id: command.run_id,
        name: 'experiment-comparison.json',
        kind: 'metrics',
        content: JSON.stringify({ experiment_ids: command.experiment_ids, metrics }),
        sourceArtifactIds: experiments.flatMap((experiment) => [experiment.dataset_artifact_id, ...experiment.training_run_ids.flatMap((id) => this.trainingRuns.find((run) => run.id === id)?.model_artifact_id ?? [])]),
        metadata: { comparison_id: comparisonId },
      });
      const result: ExperimentComparison = {
        id: comparisonId,
        workspace_id: this.context.workspaceId,
        experiment_ids: command.experiment_ids,
        metrics,
        artifact_id: artifact.id,
        created_at: nowIsoDateTime(),
      };
      await this.replace({
        experiments: this.experiments,
        training_runs: this.trainingRuns,
        evaluations: this.evaluations,
        comparisons: [...this.comparisons, result],
        analyses: this.analyses,
        models: this.models,
        requests: { ...this.requests, [command.request_id]: result.id },
      });
      await this.events.append({
        event_type: 'comparison.created',
        entity_type: 'comparison',
        entity_id: result.id,
        request_id: command.request_id,
        actor: 'agent',
        payload: { experiment_count: result.experiment_ids.length, artifact_id: result.artifact_id },
      });
      this.changes.fire({ kind: 'comparison_created', comparison: result });
      return result;
    });
  }

  async listModels(modelName?: string): Promise<readonly ModelVersion[]> {
    await this.ready;
    return this.models.filter((model) => modelName === undefined || model.model_name === modelName);
  }

  async getModel(id: string): Promise<ModelVersion | undefined> {
    await this.ready;
    return this.models.find((model) => model.id === id);
  }

  async registerModel(input: ModelRegisterInput): Promise<ModelVersion | undefined> {
    const command = modelRegisterInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.models.find((model) => model.id === existingId);
      await this.requirePolicy(command.request_id, command.run_id, `model.register:${command.model_name}`, 'model', command.model_policy_decision_id);
      const experiment = this.requireExperiment(command.experiment_id);
      const training = this.requireTraining(command.training_run_id);
      if (training.experiment_id !== experiment.id || training.model_artifact_id !== command.artifact_id || training.status !== 'succeeded') {
        throw new MlServiceError(MlErrors.codes.ML_LINEAGE_INVALID, 'model registration lineage does not match the training run');
      }
      const artifact = await this.artifacts.get(command.artifact_id);
      if (artifact === undefined) throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `model artifact not found: ${command.artifact_id}`);
      const version = this.models.filter((model) => model.model_name === command.model_name).length + 1;
      const now = nowIsoDateTime();
      const model = modelVersionSchema.parse({
        id: `model_${ulid()}`,
        workspace_id: this.context.workspaceId,
        model_name: command.model_name,
        version,
        stage: 'candidate',
        artifact_id: command.artifact_id,
        experiment_id: experiment.id,
        training_run_id: training.id,
        evaluation_id: command.evaluation_id,
        metrics: command.metrics,
        lineage_artifact_ids: [experiment.dataset_artifact_id, ...training.checkpoint_artifact_ids, command.artifact_id],
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      await this.replace({
        experiments: this.experiments.map((candidate) => candidate.id === experiment.id ? experimentSchema.parse({ ...candidate, model_version_ids: [...candidate.model_version_ids, model.id], updated_at: now }) : candidate),
        training_runs: this.trainingRuns,
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: [...this.models, model],
        requests: { ...this.requests, [command.request_id]: model.id },
      });
      await this.events.append({
        event_type: 'model.created',
        entity_type: 'model',
        entity_id: model.id,
        request_id: command.request_id,
        actor: 'agent',
        state: model.stage,
        payload: { artifact_id: model.artifact_id, experiment_id: model.experiment_id },
      });
      this.changes.fire({ kind: 'model_created', model });
      void artifact;
      return model;
    });
  }

  async updateModelStage(id: string, input: ModelStageInput): Promise<ModelVersion | undefined> {
    const command = modelStageInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.models.find((model) => model.id === id);
      if (current === undefined) return undefined;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.models.find((model) => model.id === mapped);
      await this.requirePolicy(command.request_id, command.run_id, `model.stage:${command.stage}`, 'model', command.model_policy_decision_id);
      const next = modelVersionSchema.parse({ ...current, stage: command.stage, updated_at: nowIsoDateTime(), metadata: command.metadata ?? current.metadata });
      await this.replace({
        experiments: this.experiments,
        training_runs: this.trainingRuns,
        evaluations: this.evaluations,
        comparisons: this.comparisons,
        analyses: this.analyses,
        models: this.models.map((model) => (model.id === id ? next : model)),
        requests: { ...this.requests, [command.request_id]: id },
      });
      await this.events.append({
        event_type: command.stage === 'archived' ? 'model.archived' : 'model.updated',
        entity_type: 'model',
        entity_id: id,
        request_id: command.request_id,
        actor: 'user',
        state: next.stage,
      });
      this.changes.fire({ kind: 'model_updated', model: next });
      return next;
    });
  }

  private async runConfiguredLocalTraining(
    config: LocalTrainingExecutorConfig,
    experiment: Experiment,
    trainingId: string,
    runId: string,
    rows: readonly CsvRow[],
    datasetContent: string,
    datasetFormat: DatasetFormat,
  ): Promise<LocalTrainingResult> {
    if (this.processes === undefined) {
      throw new MlServiceError(
        MlErrors.codes.ML_EXECUTOR_UNAVAILABLE,
        'a local ML command is configured but process execution is unavailable',
      );
    }
    let registered = false;
    try {
      return await executeLocalTraining(this.processes, this.context.cwd, config, {
        schema_version: 1,
        run_id: runId,
        experiment_id: experiment.id,
        dataset_artifact_id: experiment.dataset_artifact_id,
        dataset_content: datasetContent,
        dataset_format: datasetFormat,
        dataset_csv: datasetFormat === 'csv' ? datasetContent : rowsToCsv(rows),
        task: experiment.task,
        algorithm: experiment.algorithm,
        target: experiment.target,
        features: experiment.features,
        hyperparameters: experiment.hyperparameters,
        seed: experiment.seed,
      }, {
        onProcess: (process) => {
          registered = true;
          this.activeLocalProcesses.set(trainingId, process);
          if (this.cancellationRequests.has(trainingId)) {
            void process.kill('SIGKILL').catch(() => undefined);
          }
        },
      });
    } catch (error) {
      throw new MlServiceError(
        MlErrors.codes.ML_EXECUTION_FAILED,
        `configured local ML executor failed: ${safeError(error)}`,
        { experimentId: experiment.id, trainingRunId: trainingId, rowCount: rows.length },
      );
    } finally {
      if (registered) this.activeLocalProcesses.delete(trainingId);
    }
  }

  private async requirePolicy(
    requestId: string,
    runId: string | undefined,
    action: string,
    capability: 'model' | 'dataset' = 'model',
    decisionId?: string,
  ): Promise<void> {
    if (decisionId !== undefined) {
      try {
        await this.policy.assertUsable(decisionId, { capability, action, run_id: runId });
        return;
      } catch (error) {
        throw new MlServiceError(
          MlErrors.codes.ML_POLICY_REQUIRED,
          `ML action does not have an approved ${capability} policy decision: ${decisionId}`,
          { policyDecisionId: decisionId, cause: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    const decision = await this.policy.evaluate({
      request_id: `${requestId}:policy:${capability}`,
      run_id: runId,
      capability,
      action,
      requested_by: 'agent',
      metadata: { source: 'ml_service' },
    });
    if (decision.outcome !== 'allow') {
      throw new MlServiceError(
        MlErrors.codes.ML_POLICY_REQUIRED,
        `ML action requires policy approval: ${decision.reason}`,
        { policyDecisionId: decision.id },
      );
    }
  }

  private async prepareExecutionTarget(
    targetId: string | undefined,
    requestId: string,
    runId: string,
    policyDecisionId: string | undefined,
  ): Promise<{ readonly target: ExecutionTarget; readonly leaseId?: string } | undefined> {
    if (targetId === undefined) return undefined;
    const target = await this.executionTargets.get(targetId);
    if (target === undefined) {
      throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `execution target not found: ${targetId}`, {
        executionTargetId: targetId,
      });
    }
    if (target.state !== 'ready') {
      throw new MlServiceError(
        MlErrors.codes.ML_EXECUTOR_UNAVAILABLE,
        `execution target is not ready: ${targetId}`,
        { executionTargetId: targetId, state: target.state },
      );
    }
    if (target.type === 'local') return { target };
    const lease = await this.executionTargets.acquireLease(target.id, {
      request_id: `${requestId}:lease`,
      run_id: runId,
      duration_seconds: 3_600,
      policy_decision_id: policyDecisionId,
    });
    if (lease.state !== 'active') {
      throw new MlServiceError(
        MlErrors.codes.ML_POLICY_REQUIRED,
        'execution target approval is required',
        { policyDecisionId: lease.policy_decision_id, executionTargetId: target.id },
      );
    }
    return { target, leaseId: lease.id };
  }

  private async releaseExecutionTarget(
    executionTarget: { readonly target: ExecutionTarget; readonly leaseId?: string },
    requestId: string,
  ): Promise<void> {
    if (executionTarget.leaseId === undefined) return;
    await this.executionTargets.releaseLease(executionTarget.target.id, executionTarget.leaseId, {
      request_id: `${requestId}:lease:release`,
    }).catch(() => undefined);
  }

  private async requireArtifacts(ids: readonly string[]): Promise<Artifact[]> {
    const artifacts = await Promise.all(ids.map((id) => this.artifacts.get(id)));
    if (artifacts.some((artifact) => artifact === undefined)) {
      throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'remote execution returned an unknown artifact');
    }
    return artifacts as Artifact[];
  }

  private async createArtifact(input: {
    readonly request_id: string;
    readonly run_id: string;
    readonly name: string;
    readonly kind: 'metrics' | 'bundle' | 'model' | 'visualization' | 'notebook' | 'log';
    readonly mediaType?: string;
    readonly content: string;
    readonly sourceArtifactIds: readonly string[];
    readonly metadata: Record<string, unknown>;
  }) {
    return this.artifacts.create({
      request_id: input.request_id,
      run_id: input.run_id,
      name: input.name,
      kind: input.kind,
      content_base64: Buffer.from(input.content, 'utf8').toString('base64'),
      media_type: input.mediaType ?? 'application/json',
      source_artifact_ids: [...new Set(input.sourceArtifactIds)],
      metadata: input.metadata,
    });
  }

  private requireExperiment(id: string): Experiment {
    const experiment = this.experiments.find((candidate) => candidate.id === id);
    if (experiment === undefined) throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `experiment not found: ${id}`, { experimentId: id });
    return experiment;
  }

  private requireTraining(id: string): TrainingRun {
    const run = this.trainingRuns.find((candidate) => candidate.id === id);
    if (run === undefined) throw new MlServiceError(MlErrors.codes.ML_NOT_FOUND, `training run not found: ${id}`, { trainingRunId: id });
    return run;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, ML_KEY);
    if (raw === undefined) {
      await this.replace({ experiments: [], training_runs: [], evaluations: [], comparisons: [], analyses: [], models: [], requests: {} });
      return;
    }
    const document = documentSchema.parse(raw) as MlDocument;
    this.experiments = document.experiments;
    this.trainingRuns = document.training_runs;
    this.evaluations = document.evaluations;
    this.comparisons = document.comparisons as ExperimentComparison[];
    this.analyses = document.analyses;
    this.models = document.models;
    this.requests = document.requests;
    // A process restart cannot leave an in-flight local executor looking
    // runnable. Keep the durable record truthful and retryable.
    const recovered = this.trainingRuns.filter((run) => run.status === 'running' || run.status === 'queued');
    if (recovered.length > 0) {
      const now = nowIsoDateTime();
      this.trainingRuns = this.trainingRuns.map((run) => recovered.includes(run) ? trainingRunSchema.parse({ ...run, status: 'failed', completed_at: now, error: 'local training was interrupted by a process restart' }) : run);
      this.experiments = this.experiments.map((experiment) => recovered.some((run) => run.experiment_id === experiment.id) ? experimentSchema.parse({ ...experiment, state: 'failed', updated_at: now }) : experiment);
      await this.replace({ experiments: this.experiments, training_runs: this.trainingRuns, evaluations: this.evaluations, comparisons: this.comparisons, analyses: this.analyses, models: this.models, requests: this.requests });
    }
  }

  private async replace(document: Omit<MlDocument, 'version'>): Promise<void> {
    const next: MlDocument = { version: DOCUMENT_VERSION, ...document };
    await this.store.set(this.scope, ML_KEY, next);
    this.experiments = next.experiments;
    this.trainingRuns = next.training_runs;
    this.evaluations = next.evaluations;
    this.comparisons = next.comparisons as ExperimentComparison[];
    this.analyses = next.analyses;
    this.models = next.models;
    this.requests = next.requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function validateExperimentFields(
  input: Pick<ExperimentCreateInput, 'target' | 'features' | 'task' | 'algorithm'> | Experiment,
  columns: readonly string[],
  allowRemote = false,
  allowConfiguredLocal = false,
): void {
  const known = new Set(columns);
  if (!known.has(input.target)) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, `target column is not present in the dataset: ${input.target}`);
  for (const feature of input.features) if (!known.has(feature)) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, `feature column is not present in the dataset: ${feature}`);
  if (!allowRemote && !allowConfiguredLocal && ![
    'baseline',
    'majority',
    'majority_classifier',
    'mean',
    'mean_regressor',
    'linear',
    'linear_regression',
    'nearest_centroid',
    'centroid_classifier',
  ].includes(input.algorithm)) {
    throw new MlServiceError(MlErrors.codes.ML_EXECUTOR_UNAVAILABLE, `local executor does not support algorithm '${input.algorithm}'`);
  }
  if (input.task === 'classification' && ['mean', 'mean_regressor', 'linear', 'linear_regression'].includes(input.algorithm)) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'regression algorithm cannot train a classification experiment');
  if (input.task === 'regression' && ['majority', 'majority_classifier', 'nearest_centroid', 'centroid_classifier'].includes(input.algorithm)) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'classification algorithm cannot train a regression experiment');
}

function trainBaseline(experiment: Experiment, rows: readonly CsvRow[]): BaselineModel {
  if (experiment.task === 'custom') {
    throw new MlServiceError(MlErrors.codes.ML_EXECUTOR_UNAVAILABLE, 'custom task execution requires a registered ML executor');
  }
  if (rows.length === 0) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'training dataset has no rows');
  if (['linear', 'linear_regression'].includes(experiment.algorithm)) {
    return trainLinearRegression(experiment, rows);
  }
  if (['nearest_centroid', 'centroid_classifier'].includes(experiment.algorithm)) {
    return trainNearestCentroid(experiment, rows);
  }
  const values = rows.map((row) => row[experiment.target]).filter((value): value is string => value !== undefined && value.trim().length > 0);
  if (values.length === 0) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'training target has no usable values');
  if (experiment.task === 'classification') {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    const prediction = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
    if (prediction === undefined) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'classification target has no values');
    const accuracy = values.filter((value) => value === prediction).length / values.length;
    return { schema_version: 1, model_type: 'constant', task: experiment.task, algorithm: experiment.algorithm, target: experiment.target, features: experiment.features, prediction, training_rows: values.length, metrics: metricMap(experiment, { accuracy }) };
  }
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length === 0) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'regression target must contain numeric values');
  const prediction = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const mae = numeric.reduce((sum, value) => sum + Math.abs(value - prediction), 0) / numeric.length;
  const rmse = Math.sqrt(numeric.reduce((sum, value) => sum + (value - prediction) ** 2, 0) / numeric.length);
  return { schema_version: 1, model_type: 'constant', task: experiment.task, algorithm: experiment.algorithm, target: experiment.target, features: experiment.features, prediction, training_rows: numeric.length, metrics: metricMap(experiment, { mae, rmse }) };
}

function trainLinearRegression(experiment: Experiment, rows: readonly CsvRow[]): BaselineModel {
  const samples = rows.flatMap((row) => {
    const features = numericFeatures(row, experiment.features);
    const target = Number(row[experiment.target]);
    return features === undefined || !Number.isFinite(target) ? [] : [{ features, target }];
  });
  if (samples.length === 0) {
    throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'linear regression requires numeric feature and target values');
  }
  const width = experiment.features.length + 1;
  const matrix = Array.from({ length: width }, () => Array<number>(width).fill(0));
  const vector = Array<number>(width).fill(0);
  const regularization = numericHyperparameter(experiment.hyperparameters, 'regularization') ?? 1e-8;
  for (const sample of samples) {
    const values = [1, ...sample.features];
    for (let rowIndex = 0; rowIndex < width; rowIndex += 1) {
      vector[rowIndex] = vector[rowIndex]! + values[rowIndex]! * sample.target;
      const matrixRow = matrix[rowIndex]!;
      for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
        matrixRow[columnIndex] = matrixRow[columnIndex]! + values[rowIndex]! * values[columnIndex]!;
      }
    }
  }
  for (let index = 1; index < width; index += 1) {
    const matrixRow = matrix[index]!;
    matrixRow[index] = matrixRow[index]! + Math.max(0, regularization);
  }
  const coefficients = solveLinearSystem(matrix, vector);
  const predictions = samples.map((sample) => coefficients[0]! + sample.features.reduce((sum, value, index) => sum + coefficients[index + 1]! * value, 0));
  const mae = samples.reduce((sum, sample, index) => sum + Math.abs(sample.target - predictions[index]!), 0) / samples.length;
  const rmse = Math.sqrt(samples.reduce((sum, sample, index) => sum + (sample.target - predictions[index]!) ** 2, 0) / samples.length);
  return {
    schema_version: 1,
    model_type: 'linear_regression',
    task: 'regression',
    algorithm: experiment.algorithm,
    target: experiment.target,
    features: experiment.features,
    prediction: coefficients[0],
    intercept: coefficients[0],
    weights: coefficients.slice(1),
    training_rows: samples.length,
    metrics: metricMap(experiment, { mae, rmse }),
  };
}

function trainNearestCentroid(experiment: Experiment, rows: readonly CsvRow[]): BaselineModel {
  const grouped = new Map<string, number[][]>();
  for (const row of rows) {
    const target = row[experiment.target];
    const features = numericFeatures(row, experiment.features);
    if (target === undefined || target.length === 0 || features === undefined) continue;
    grouped.set(target, [...(grouped.get(target) ?? []), features]);
  }
  if (grouped.size === 0) {
    throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'nearest-centroid classification requires numeric features and labeled rows');
  }
  const centroids = Object.fromEntries([...grouped.entries()].map(([label, samples]) => [
    label,
    samples[0]!.map((_, index) => samples.reduce((sum, sample) => sum + sample[index]!, 0) / samples.length),
  ]));
  const modelWithoutMetrics: BaselineModel = {
    schema_version: 1,
    model_type: 'nearest_centroid',
    task: 'classification',
    algorithm: experiment.algorithm,
    target: experiment.target,
    features: experiment.features,
    prediction: Object.keys(centroids).sort()[0],
    centroids,
    training_rows: [...grouped.values()].reduce((sum, samples) => sum + samples.length, 0),
    metrics: {},
  };
  return {
    ...modelWithoutMetrics,
    metrics: metricMap(experiment, { accuracy: nearestCentroidAccuracy(modelWithoutMetrics, rows) }),
  };
}

function numericFeatures(row: CsvRow, features: readonly string[]): number[] | undefined {
  const values = features.map((feature) => Number(row[feature]));
  return values.every((value) => Number.isFinite(value)) ? values : undefined;
}

function numericHyperparameter(metadata: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function solveLinearSystem(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-12) {
      throw new MlServiceError(MlErrors.codes.ML_EXECUTION_FAILED, 'linear regression design matrix is singular');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const pivotRow = augmented[column]!;
    const divisor = pivotRow[column]!;
    for (let index = column; index <= size; index += 1) pivotRow[index] = pivotRow[index]! / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const targetRow = augmented[row]!;
      const factor = targetRow[column]!;
      for (let index = column; index <= size; index += 1) targetRow[index] = targetRow[index]! - factor * pivotRow[index]!;
    }
  }
  return augmented.map((row) => row[size]!);
}

function predictLinear(model: EvaluationModel, row: CsvRow): number {
  const intercept = model.intercept ?? Number(model.prediction);
  const weights = model.weights;
  const features = numericFeatures(row, model.features);
  if (weights === undefined || features === undefined || !Number.isFinite(intercept)) return Number.NaN;
  return intercept + features.reduce((sum, value, index) => sum + (weights[index] ?? 0) * value, 0);
}

function nearestCentroidAccuracy(model: EvaluationModel, rows: readonly CsvRow[]): number {
  if (model.centroids === undefined) return 0;
  let evaluated = 0;
  let correct = 0;
  for (const row of rows) {
    const actual = row[model.target];
    const predicted = predictNearestCentroid(model, row);
    if (actual === undefined || predicted === undefined) continue;
    evaluated += 1;
    if (actual === predicted) correct += 1;
  }
  return evaluated === 0 ? 0 : correct / evaluated;
}

function predictNearestCentroid(model: EvaluationModel, row: CsvRow): string | undefined {
  if (model.centroids === undefined) return model.prediction as string | undefined;
  const features = numericFeatures(row, model.features);
  if (features === undefined) return undefined;
  let best: { readonly label: string; readonly distance: number } | undefined;
  for (const [label, centroid] of Object.entries(model.centroids)) {
    const distance = Math.sqrt(centroid.reduce((sum, value, index) => sum + (value - features[index]!) ** 2, 0));
    if (best === undefined || distance < best.distance || (distance === best.distance && label < best.label)) {
      best = { label, distance };
    }
  }
  return best?.label;
}

function evaluateModel(model: EvaluationModel, rows: readonly CsvRow[], specs: readonly { readonly name: string; readonly higher_is_better?: boolean }[] | undefined): Record<string, number> {
  if (rows.length === 0) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'evaluation dataset has no rows');
  if (model.task === 'classification') {
    const values = rows.map((row) => row[model.target]).filter((value): value is string => value !== undefined && value.length > 0);
    const accuracy = model.model_type === 'nearest_centroid'
      ? nearestCentroidAccuracy(model, rows)
      : values.length === 0 ? 0 : values.filter((value) => value === model.prediction).length / values.length;
    return metricMapFromSpecs(specs, { accuracy });
  }
  const numeric = rows.map((row) => Number(row[model.target])).filter(Number.isFinite);
  const predictions = model.model_type === 'linear_regression'
    ? rows.map((row) => predictLinear(model, row)).filter((value): value is number => Number.isFinite(value))
    : numeric.map(() => Number(model.prediction));
  if (numeric.length === 0 || predictions.length !== numeric.length || predictions.some((value) => !Number.isFinite(value))) {
    return metricMapFromSpecs(specs, { mae: Number.POSITIVE_INFINITY, rmse: Number.POSITIVE_INFINITY });
  }
  const mae = numeric.reduce((sum, value, index) => sum + Math.abs(value - predictions[index]!), 0) / numeric.length;
  const rmse = Math.sqrt(numeric.reduce((sum, value, index) => sum + (value - predictions[index]!) ** 2, 0) / numeric.length);
  return metricMapFromSpecs(specs, { mae, rmse });
}

function metricMap(experiment: Experiment, values: Record<string, number>): Record<string, number> {
  return metricMapFromSpecs(experiment.metrics, values);
}

function metricMapFromSpecs(specs: readonly { readonly name: string }[] | undefined, values: Record<string, number>): Record<string, number> {
  const names = specs === undefined || specs.length === 0 ? Object.keys(values) : specs.map((spec) => spec.name);
  const result: Record<string, number> = {};
  for (const name of names) {
    const value = values[name];
    if (value === undefined) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, `metric '${name}' is not supported by the local executor`);
    result[name] = value;
  }
  return result;
}

function mergeEvaluationMetrics(candidate: Record<string, number>, baseline: Record<string, number> | undefined, specs: readonly { readonly name: string; readonly higher_is_better?: boolean; readonly maximum_regression?: number; readonly required_minimum?: number }[] | undefined) {
  return Object.entries(candidate).map(([name, value]) => {
    const base = baseline?.[name];
    const higherIsBetter = specs?.find((spec) => spec.name === name)?.higher_is_better ?? (name === 'accuracy');
    const regression = base === undefined ? undefined : higherIsBetter ? base - value : value - base;
    const threshold = specs?.find((spec) => spec.name === name)?.maximum_regression;
    const minimum = specs?.find((spec) => spec.name === name)?.required_minimum;
    return { name, candidate: value, ...(base === undefined ? {} : { baseline: base, regression }), passed: (minimum === undefined || value >= minimum) && (threshold === undefined || regression === undefined || regression <= threshold) };
  });
}

function recommendationFor(metrics: readonly { readonly passed: boolean }[]): 'promote' | 'reject' | 'investigate' {
  const values = metrics;
  return values.some((metric) => !metric.passed) ? 'reject' : 'promote';
}

function parseModel(content: string): EvaluationModel {
  try {
    const parsed = JSON.parse(content) as EvaluationModel;
    if (parsed.schema_version !== 1 || (parsed.task !== 'classification' && parsed.task !== 'regression')) throw new Error('unsupported model');
    if (parsed.model_type === 'linear_regression' && (
      parsed.task !== 'regression'
      || typeof parsed.intercept !== 'number'
      || !Array.isArray(parsed.weights)
      || parsed.weights.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    )) throw new Error('invalid linear regression model');
    if (parsed.model_type === 'nearest_centroid' && (
      parsed.task !== 'classification'
      || parsed.centroids === undefined
      || parsed.centroids === null
      || typeof parsed.centroids !== 'object'
      || Array.isArray(parsed.centroids)
      || Object.values(parsed.centroids).some((centroid) => !Array.isArray(centroid) || centroid.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
    )) throw new Error('invalid nearest-centroid model');
    return parsed;
  } catch (error) {
    throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, `model artifact is invalid: ${safeError(error)}`);
  }
}

function parseDataset(content: string, format: DatasetFormat): CsvRow[] {
  if (format === 'jsonl') return parseJsonl(content);
  return parseCsv(content);
}

function parseJsonl(content: string): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new MlServiceError(
        MlErrors.codes.ML_INVALID_INPUT,
        `JSONL line ${index + 1} is invalid: ${safeError(error)}`,
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MlServiceError(
        MlErrors.codes.ML_INVALID_INPUT,
        `JSONL line ${index + 1} must contain a JSON object`,
      );
    }
    rows.push(Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [key, stringifyDatasetValue(value)]),
    ));
  }
  return rows;
}

function stringifyDatasetValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function rowsToCsv(rows: readonly CsvRow[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const encode = (value: string): string => /[",\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))]
    .map((row) => row.map(encode).join(','))
    .join('\n');
}

function parseCsv(content: string): CsvRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(value);
      value = '';
      if (row.some((cell) => cell.length > 0)) records.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'CSV contains an unterminated quote');
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.length > 0)) records.push(row);
  }
  const header = records.shift();
  if (header === undefined || header.length === 0) throw new MlServiceError(MlErrors.codes.ML_INVALID_INPUT, 'CSV has no header');
  return records.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));
}

function summarizeRows(
  rows: readonly CsvRow[],
  columns: readonly string[],
  groupBy: string | undefined,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const column of columns) {
    const values = rows.map((row) => row[column] ?? '');
    const present = values.filter((value) => value.trim().length > 0);
    const numeric = present.map(Number).filter(Number.isFinite);
    summary[column] = {
      type: numeric.length === present.length && present.length > 0 ? 'number' : 'string',
      non_null_count: present.length,
      null_count: values.length - present.length,
      distinct_count: new Set(present).size,
      ...(numeric.length === present.length && numeric.length > 0
        ? {
            min: Math.min(...numeric),
            max: Math.max(...numeric),
            mean: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
          }
        : {}),
    };
  }
  if (groupBy !== undefined) {
    const groups: Record<string, number> = {};
    for (const row of rows) {
      const value = row[groupBy] ?? '';
      groups[value] = (groups[value] ?? 0) + 1;
    }
    summary['_groups'] = groups;
  }
  return summary;
}

function renderAnalysisSvg(name: string, summary: Record<string, unknown>): string {
  const entries = Object.entries(summary).filter(([key, value]) => key !== '_groups' && value !== null);
  const width = 720;
  const height = Math.max(180, 80 + entries.length * 44);
  const maxDistinct = Math.max(1, ...entries.map(([, value]) => {
    const distinct = typeof value === 'object' && value !== null && 'distinct_count' in value
      ? Number((value as { distinct_count?: unknown }).distinct_count)
      : 0;
    return Number.isFinite(distinct) ? distinct : 0;
  }));
  const bars = entries.map(([column, value], index) => {
    const distinct = typeof value === 'object' && value !== null && 'distinct_count' in value
      ? Number((value as { distinct_count?: unknown }).distinct_count)
      : 0;
    const barWidth = Math.max(2, Math.round((Math.max(0, distinct) / maxDistinct) * 420));
    const y = 64 + index * 44;
    return `<text x="24" y="${y + 16}" font-family="sans-serif" font-size="13" fill="#202124">${escapeXml(column)}</text><rect x="180" y="${y}" width="${barWidth}" height="24" rx="4" fill="#5b6ee1"/><text x="${190 + barWidth}" y="${y + 16}" font-family="sans-serif" font-size="12" fill="#5f6368">${Number.isFinite(distinct) ? distinct : 0} distinct</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="24" y="30" font-family="sans-serif" font-size="18" font-weight="600" fill="#202124">${escapeXml(name)} — distinct values</text>${bars}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}

function decodeArtifactText(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength > maxBytes) throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'ML artifact exceeds local executor size limit');
  return bytes.toString('utf8');
}

function parseRemoteAnalysisReport(content: string): z.infer<typeof remoteAnalysisReportSchema> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, `remote analysis report is not valid JSON: ${safeError(error)}`);
  }
  const parsed = remoteAnalysisReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'remote analysis report does not match the ML result contract');
  }
  return parsed.data;
}

function parseRemoteEvaluationReport(content: string): z.infer<typeof remoteEvaluationReportSchema> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, `remote evaluation report is not valid JSON: ${safeError(error)}`);
  }
  const parsed = remoteEvaluationReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new MlServiceError(MlErrors.codes.ML_ARTIFACT_INVALID, 'remote evaluation report does not match the ML result contract');
  }
  return parsed.data;
}

function mergeRemoteMetadata(
  commandMetadata: Readonly<Record<string, unknown>> | undefined,
  remoteMetadata: Readonly<Record<string, unknown>> | undefined,
  executionMetadata: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...commandMetadata,
    ...remoteMetadata,
    ...executionMetadata,
  };
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) throw new MlServiceError(MlErrors.codes.ML_SECRET_MATERIAL, `ML metadata cannot contain secret material in '${path}'`, { key: path });
}

function configuredLocalExecutor(): LocalTrainingExecutorConfig | undefined {
  try {
    return configuredLocalTrainingExecutor();
  } catch (error) {
    throw new MlServiceError(
      MlErrors.codes.ML_EXECUTOR_UNAVAILABLE,
      `local ML executor configuration is invalid: ${safeError(error)}`,
    );
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 2_000);
}

function redactTrainingText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"'`]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret)\s*[:=]\s*)[^\s"'`]+/gi, '$1[REDACTED]')
    .slice(0, 8 * 1024 * 1024);
}

function validateExternalTrainingResult(experiment: Experiment, result: LocalTrainingResult): void {
  for (const metric of experiment.metrics) {
    if (result.metrics[metric.name] === undefined) {
      throw new MlServiceError(
        MlErrors.codes.ML_EXECUTION_FAILED,
        `configured local ML executor did not return metric '${metric.name}'`,
      );
    }
  }
  if (experiment.task !== 'custom') parseModel(result.model_content);
}

function executorForTarget(target: ExecutionTarget | undefined): TrainingRun['executor'] {
  if (target === undefined || target.type === 'local') return 'local';
  return target.type;
}

function numericMetadata(value: unknown): Readonly<Record<string, number>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceMlService,
  WorkspaceMlService,
  ScopeActivation.OnDemand,
  'ml',
);
