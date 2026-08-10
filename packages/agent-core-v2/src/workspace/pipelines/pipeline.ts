/**
 * `pipelines` domain — workspace-scoped contracts for durable native ML/data
 * pipeline definitions and pipeline Runs.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Pipeline,
  PipelineCancelInput,
  PipelineCreateInput,
  PipelineRun,
  PipelineRunInput,
} from '@moonshot-ai/protocol';

export interface WorkspacePipelinesChangedEvent {
  readonly kind: 'pipeline_created' | 'pipeline_updated' | 'run_updated';
  readonly pipeline?: Pipeline;
  readonly run?: PipelineRun;
}

export interface IWorkspacePipelineService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspacePipelinesChangedEvent>;
  list(): Promise<readonly Pipeline[]>;
  get(id: string): Promise<Pipeline | undefined>;
  create(input: PipelineCreateInput): Promise<Pipeline>;
  listRuns(pipelineId?: string): Promise<readonly PipelineRun[]>;
  getRun(id: string): Promise<PipelineRun | undefined>;
  run(pipelineId: string, input: PipelineRunInput): Promise<PipelineRun | undefined>;
  cancelRun(id: string, input: PipelineCancelInput): Promise<PipelineRun | undefined>;
}

export const IWorkspacePipelineService: ServiceIdentifier<IWorkspacePipelineService> =
  createDecorator<IWorkspacePipelineService>('pipelineService');

export type {
  Pipeline,
  PipelineCancelInput,
  PipelineCreateInput,
  PipelineRun,
  PipelineRunInput,
} from '@moonshot-ai/protocol';
