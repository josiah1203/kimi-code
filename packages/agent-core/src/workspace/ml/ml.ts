/**
 * `ml` domain — workspace-scoped experiment, training, evaluation, and model
 * registry contracts.
 *
 * The service owns durable ML metadata and delegates bytes to the artifact
 * service, structured data to the dataset service, and authorization to the
 * policy service. Session Runs remain the caller-owned execution envelope.
 * Bound at Workspace scope.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Evaluation,
  EvaluationCreateInput,
  Analysis,
  AnalysisCreateInput,
  Experiment,
  ExperimentComparison,
  ExperimentCompareInput,
  ExperimentCreateInput,
  ModelRegisterInput,
  ModelStageInput,
  ModelVersion,
  TrainingCancelInput,
  TrainingRun,
  TrainingStartInput,
} from '@spiderbyte/protocol';

export interface WorkspaceMlChangedEvent {
  readonly kind:
    | 'analysis_created'
    | 'experiment_created'
    | 'experiment_updated'
    | 'training_updated'
    | 'evaluation_created'
    | 'comparison_created'
    | 'model_created'
    | 'model_updated';
  readonly experiment?: Experiment;
  readonly analysis?: Analysis;
  readonly training?: TrainingRun;
  readonly evaluation?: Evaluation;
  readonly comparison?: ExperimentComparison;
  readonly model?: ModelVersion;
}

export interface IWorkspaceMlService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceMlChangedEvent>;

  listAnalyses(): Promise<readonly Analysis[]>;
  getAnalysis(id: string): Promise<Analysis | undefined>;
  analyze(input: AnalysisCreateInput): Promise<Analysis | undefined>;

  listExperiments(): Promise<readonly Experiment[]>;
  getExperiment(id: string): Promise<Experiment | undefined>;
  createExperiment(input: ExperimentCreateInput): Promise<Experiment>;
  validateExperiment(id: string, requestId: string): Promise<Experiment | undefined>;

  listTrainingRuns(experimentId?: string): Promise<readonly TrainingRun[]>;
  getTrainingRun(id: string): Promise<TrainingRun | undefined>;
  startTraining(experimentId: string, input: TrainingStartInput): Promise<TrainingRun | undefined>;
  cancelTraining(id: string, input: TrainingCancelInput): Promise<TrainingRun | undefined>;

  listEvaluations(experimentId?: string): Promise<readonly Evaluation[]>;
  getEvaluation(id: string): Promise<Evaluation | undefined>;
  evaluate(input: EvaluationCreateInput): Promise<Evaluation | undefined>;
  compare(input: ExperimentCompareInput): Promise<ExperimentComparison | undefined>;

  listModels(modelName?: string): Promise<readonly ModelVersion[]>;
  getModel(id: string): Promise<ModelVersion | undefined>;
  registerModel(input: ModelRegisterInput): Promise<ModelVersion | undefined>;
  updateModelStage(id: string, input: ModelStageInput): Promise<ModelVersion | undefined>;
}

export const IWorkspaceMlService: ServiceIdentifier<IWorkspaceMlService> =
  createDecorator<IWorkspaceMlService>('workspaceMlService');

export type {
  Evaluation,
  EvaluationCreateInput,
  Analysis,
  AnalysisCreateInput,
  Experiment,
  ExperimentComparison,
  ExperimentCompareInput,
  ExperimentCreateInput,
  ModelRegisterInput,
  ModelStageInput,
  ModelVersion,
  TrainingCancelInput,
  TrainingRun,
  TrainingStartInput,
} from '@spiderbyte/protocol';
