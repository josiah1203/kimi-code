/**
 * `pipelines` domain — durable native ML/data pipeline execution.
 *
 * Persists pipeline definitions and pipeline Runs through the atomic document
 * store in the workspace context, delegates step execution to the workspace ML
 * service, acquires execution-target leases, evaluates policy, and records
 * lifecycle events. Bound at Workspace scope.
 */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  nowIsoDateTime,
  pipelineCancelInputSchema,
  pipelineCreateInputSchema,
  pipelineRunInputSchema,
  pipelineRunSchema,
  pipelineSchema,
  pipelineStepRunSchema,
  type Pipeline,
  type PipelineCreateInput,
  type PipelineRun,
  type PipelineRunInput,
  type PipelineStep,
} from '@spiderbyte/protocol';

import { IWorkspacePipelineService, type WorkspacePipelinesChangedEvent } from './pipeline';
import { PipelineErrors, PipelineServiceError } from './errors';

const DOCUMENT_VERSION = 1;
const PIPELINE_KEY = 'pipelines.json';

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  pipelines: z.array(pipelineSchema),
  runs: z.array(pipelineRunSchema),
  requests: z.record(z.string(), z.string()).default({}),
});
type PipelineDocument = {
  readonly version: 1;
  readonly pipelines: readonly Pipeline[];
  readonly runs: readonly PipelineRun[];
  readonly requests: Readonly<Record<string, string>>;
};

export class WorkspacePipelineService extends Disposable implements IWorkspacePipelineService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspacePipelinesChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspacePipelinesChangedEvent>());
  private readonly scope: string;
  private pipelines: readonly Pipeline[] = [];
  private runs: readonly PipelineRun[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly cancellationRequests = new Set<string>();
  private readonly activeExecutionRequests = new Map<string, string>();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspaceMlService private readonly ml: IWorkspaceMlService,
    @IWorkspaceExecutionTargetService private readonly targets: IWorkspaceExecutionTargetService,
    @IWorkspaceExecutionService private readonly execution: IWorkspaceExecutionService,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(): Promise<readonly Pipeline[]> {
    await this.ready;
    return [...this.pipelines];
  }

  async get(id: string): Promise<Pipeline | undefined> {
    await this.ready;
    return this.pipelines.find((pipeline) => pipeline.id === id);
  }

  async create(input: PipelineCreateInput): Promise<Pipeline> {
    const command = pipelineCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    validateSteps(command.steps);
    return this.enqueue(async () => {
      await this.ready;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      if (this.pipelines.some((pipeline) => pipeline.name === command.name)) {
        throw new PipelineServiceError(
          PipelineErrors.codes.PIPELINE_NAME_TAKEN,
          `pipeline name already exists: ${command.name}`,
          { name: command.name },
        );
      }
      const now = nowIsoDateTime();
      const pipeline = pipelineSchema.parse({
        id: `pipeline_${ulid()}`,
        workspace_id: this.context.workspaceId,
        name: command.name,
        steps: command.steps,
        state: 'ready',
        run_ids: [],
        pipeline_run_ids: [],
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      await this.replace({
        pipelines: [...this.pipelines, pipeline],
        runs: this.runs,
        requests: { ...this.requests, [command.request_id]: pipeline.id },
      });
      await this.events.append({
        event_type: 'pipeline.created',
        entity_type: 'pipeline',
        entity_id: pipeline.id,
        request_id: command.request_id,
        actor: 'user',
        state: pipeline.state,
        payload: { step_count: pipeline.steps.length },
      });
      this.changes.fire({ kind: 'pipeline_created', pipeline });
      return pipeline;
    });
  }

  async listRuns(pipelineId?: string): Promise<readonly PipelineRun[]> {
    await this.ready;
    return this.runs.filter((run) => pipelineId === undefined || run.pipeline_id === pipelineId);
  }

  async getRun(id: string): Promise<PipelineRun | undefined> {
    await this.ready;
    return this.runs.find((run) => run.id === id);
  }

  async run(pipelineId: string, input: PipelineRunInput): Promise<PipelineRun | undefined> {
    const command = pipelineRunInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const pipeline = this.pipelines.find((candidate) => candidate.id === pipelineId);
      if (pipeline === undefined) return undefined;
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.requireRun(mapped);
      if (pipeline.state === 'archived') {
        throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_STATE, `pipeline is archived: ${pipelineId}`);
      }

      const pipelineRunId = `pipeline_run_${ulid()}`;
      const now = nowIsoDateTime();
      let policyDecisionId = command.policy_decision_id;
      if (policyDecisionId === undefined) {
        const decision = await this.policy.evaluate({
          request_id: `${command.request_id}:policy`,
          run_id: command.run_id,
          capability: 'model',
          action: `pipeline.run:${pipeline.name}`,
          requested_by: 'agent',
          metadata: { source: 'pipeline_service', pipeline_id: pipeline.id },
        });
        policyDecisionId = decision.id;
        if (decision.outcome === 'deny') {
          return this.persistRejectedRun(pipeline, command, pipelineRunId, now, decision.reason);
        }
        if (decision.outcome === 'approval_required') {
          return this.persistAwaitingRun(pipeline, command, pipelineRunId, now, policyDecisionId, decision.reason);
        }
      } else {
        try {
          await this.policy.assertUsable(policyDecisionId, {
            capability: 'model',
            action: `pipeline.run:${pipeline.name}`,
            run_id: command.run_id,
          });
        } catch {
          return this.persistAwaitingRun(pipeline, command, pipelineRunId, now, policyDecisionId, 'pipeline policy approval is required');
        }
      }

      let leaseId: string | undefined;
      let localTarget = true;
      try {
        if (command.execution_target_id !== undefined) {
          const target = await this.targets.get(command.execution_target_id);
          if (target === undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_NOT_FOUND, `execution target not found: ${command.execution_target_id}`);
          if (target.state !== 'ready') throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_STATE, `execution target is not ready: ${command.execution_target_id}`);
          localTarget = target.type === 'local';
          const lease = await this.targets.acquireLease(command.execution_target_id, {
            request_id: `${command.request_id}:lease`,
            run_id: command.run_id,
            duration_seconds: 3_600,
            policy_decision_id: command.execution_target_policy_decision_id,
          });
          if (lease.state === 'awaiting_approval') {
            return await this.persistAwaitingRun(pipeline, command, pipelineRunId, now, lease.policy_decision_id, 'execution target approval is required');
          }
          leaseId = lease.id;
        }

        let currentRun = pipelineRunSchema.parse({
          id: pipelineRunId,
          workspace_id: this.context.workspaceId,
          pipeline_id: pipeline.id,
          run_id: command.run_id,
          status: 'running',
          step_runs: pipeline.steps.map((step) => pipelineStepRunSchema.parse({ step_id: step.id, state: 'queued', output_artifact_ids: [] })),
          execution_target_id: command.execution_target_id,
          execution_target_policy_decision_id: command.execution_target_policy_decision_id,
          output_artifact_ids: [],
          created_at: now,
          started_at: now,
          metadata: command.metadata,
        });
        await this.persistStarted(pipeline, currentRun, command.request_id);
        if (this.cancellationRequests.has(pipelineRunId)) {
          return await this.persistCancelled(pipeline, currentRun, command.request_id);
        }
        for (const step of topologicalSteps(pipeline.steps)) {
          if (this.cancellationRequests.has(pipelineRunId)) {
            return await this.persistCancelled(pipeline, currentRun, command.request_id);
          }
          const dependencyArtifactIds = [...new Set(
            step.depends_on.flatMap((dependency) =>
              currentRun.step_runs.find((run) => run.step_id === dependency)?.output_artifact_ids ?? [],
            ),
          )];
          currentRun = pipelineRunSchema.parse({ ...currentRun, step_runs: currentRun.step_runs.map((run) => run.step_id === step.id ? { ...run, state: 'running', started_at: nowIsoDateTime() } : run) });
          await this.persistRunOnly(currentRun);
          try {
            const artifactIds = await this.executeStep(step, command, currentRun, localTarget, leaseId, dependencyArtifactIds);
            if (this.cancellationRequests.has(pipelineRunId)) {
              return await this.persistCancelled(pipeline, currentRun, command.request_id, step.id);
            }
            currentRun = pipelineRunSchema.parse({
              ...currentRun,
              step_runs: currentRun.step_runs.map((run) => run.step_id === step.id ? { ...run, state: 'succeeded', output_artifact_ids: artifactIds, completed_at: nowIsoDateTime() } : run),
              output_artifact_ids: [...new Set([...currentRun.output_artifact_ids, ...artifactIds])],
            });
            await this.persistRunOnly(currentRun);
          } catch (error) {
            if (this.cancellationRequests.has(pipelineRunId)) {
              return await this.persistCancelled(pipeline, currentRun, command.request_id, step.id, error);
            }
            const failed = pipelineRunSchema.parse({
              ...currentRun,
              status: 'failed',
              step_runs: currentRun.step_runs.map((run) => run.step_id === step.id ? { ...run, state: 'failed', completed_at: nowIsoDateTime(), error: safeError(error) } : run),
              completed_at: nowIsoDateTime(),
              error: safeError(error),
            });
            await this.persistRunOnly(failed);
            await this.finishPipeline(pipeline.id, failed, command.request_id, 'failed');
            return failed;
          }
        }
        if (this.cancellationRequests.has(pipelineRunId)) {
          return await this.persistCancelled(pipeline, currentRun, command.request_id);
        }
        currentRun = pipelineRunSchema.parse({ ...currentRun, status: 'succeeded', completed_at: nowIsoDateTime() });
        await this.persistRunOnly(currentRun);
        await this.finishPipeline(pipeline.id, currentRun, command.request_id, 'completed');
        return currentRun;
      } catch (error) {
        if (this.cancellationRequests.has(pipelineRunId)) {
          const current = this.runs.find((run) => run.id === pipelineRunId);
          if (current !== undefined) return await this.persistCancelled(pipeline, current, command.request_id, undefined, error);
        }
        const failed = pipelineRunSchema.parse({
          id: pipelineRunId,
          workspace_id: this.context.workspaceId,
          pipeline_id: pipeline.id,
          run_id: command.run_id,
          status: 'failed',
          step_runs: pipeline.steps.map((step) => ({ step_id: step.id, state: 'failed', output_artifact_ids: [], error: safeError(error) })),
          execution_target_id: command.execution_target_id,
          output_artifact_ids: [],
          created_at: now,
          completed_at: nowIsoDateTime(),
          error: safeError(error),
          metadata: command.metadata,
        });
        await this.persistRunOnly(failed);
        await this.finishPipeline(pipeline.id, failed, command.request_id, 'failed');
        return failed;
      } finally {
        if (leaseId !== undefined && command.execution_target_id !== undefined) {
          await this.targets.releaseLease(command.execution_target_id, leaseId, { request_id: `${command.request_id}:lease:release` }).catch(() => undefined);
        }
        this.cancellationRequests.delete(pipelineRunId);
      }
    });
  }

  async cancelRun(id: string, input: { request_id: string }): Promise<PipelineRun | undefined> {
    const command = pipelineCancelInputSchema.parse(input);
    await this.ready;
    const initial = this.runs.find((run) => run.id === id);
    if (initial === undefined) return undefined;
    const mapped = this.requests[command.request_id];
    if (mapped !== undefined) return this.requireRun(mapped);
    if (initial.status !== 'queued' && initial.status !== 'running' && initial.status !== 'awaiting_approval') return initial;
    this.cancellationRequests.add(id);
    const activeRequestId = this.activeExecutionRequests.get(id);
    if (activeRequestId !== undefined) {
      await this.execution.cancel(activeRequestId).catch(() => false);
    }
    return this.enqueue(async () => {
      await this.ready;
      const current = this.runs.find((run) => run.id === id);
      if (current === undefined) {
        this.cancellationRequests.delete(id);
        return undefined;
      }
      if (current.status !== 'queued' && current.status !== 'running' && current.status !== 'awaiting_approval') {
        this.cancellationRequests.delete(id);
        return current;
      }
      const next = pipelineRunSchema.parse({ ...current, status: 'cancelled', completed_at: nowIsoDateTime(), error: 'cancelled_by_request' });
      await this.persistRunOnly(next, command.request_id);
      await this.finishPipeline(current.pipeline_id, next, command.request_id, 'ready');
      this.cancellationRequests.delete(id);
      return next;
    });
  }

  private async executeStep(
    step: PipelineStep,
    command: PipelineRunInput,
    run: PipelineRun,
    localTarget: boolean,
    leaseId: string | undefined,
    dependencyArtifactIds: readonly string[],
  ): Promise<readonly string[]> {
    const config = step.config;
    const requestId = `${command.request_id}:step:${step.id}`;
    if (!localTarget) {
      if (command.execution_target_id === undefined) {
        throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_EXECUTION_FAILED, `remote pipeline step has no execution target: ${step.id}`);
      }
      this.activeExecutionRequests.set(run.id, requestId);
      let remote: Awaited<ReturnType<IWorkspaceExecutionService['execute']>>;
      try {
        remote = await this.execution.execute({
          request_id: requestId,
          run_id: run.run_id,
          target_id: command.execution_target_id,
          lease_id: leaseId,
          operation: step.kind,
          policy_decision_id: command.policy_decision_id,
          payload: {
            pipeline_id: run.pipeline_id,
            pipeline_run_id: run.id,
            step_id: step.id,
            step_name: step.name,
            step_config: config,
            dependency_artifact_ids: dependencyArtifactIds,
          },
        });
      } finally {
        if (this.activeExecutionRequests.get(run.id) === requestId) this.activeExecutionRequests.delete(run.id);
      }
      if (remote.status !== 'succeeded') {
        throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_EXECUTION_FAILED, remote.error ?? `remote pipeline step failed: ${step.id}`);
      }
      return remote.output_artifact_ids;
    }
    if (step.kind === 'analysis') {
      const columns = optionalStringArray(config, 'columns');
      const result = await this.ml.analyze({
        request_id: requestId,
        run_id: run.run_id,
        dataset_id: requiredString(config, 'dataset_id'),
        dataset_version: optionalPositive(config, 'dataset_version'),
        execution_target_id: optionalString(config, 'execution_target_id'),
        execution_target_policy_decision_id: optionalString(config, 'execution_target_policy_decision_id'),
        dataset_policy_decision_id: optionalString(config, 'dataset_policy_decision_id'),
        kind: optionalString(config, 'kind') as 'summary' | 'visualization' | 'notebook' | undefined,
        columns: columns === undefined ? undefined : [...columns],
        group_by: optionalString(config, 'group_by'),
      });
      if (result === undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_EXECUTION_FAILED, `analysis step returned no result: ${step.id}`);
      return [result.report_artifact_id, ...result.visualization_artifact_ids, ...(result.notebook_artifact_id === undefined ? [] : [result.notebook_artifact_id])];
    }
    if (step.kind === 'training') {
      const result = await this.ml.startTraining(requiredString(config, 'experiment_id'), {
        request_id: requestId,
        run_id: run.run_id,
        execution_target_id: optionalString(config, 'execution_target_id'),
        dataset_policy_decision_id: optionalString(config, 'dataset_policy_decision_id'),
        model_policy_decision_id: optionalString(config, 'model_policy_decision_id'),
      });
      if (result === undefined || result.status !== 'succeeded') throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_EXECUTION_FAILED, result?.error ?? `training step failed: ${step.id}`);
      return [...result.checkpoint_artifact_ids, ...(result.model_artifact_id === undefined ? [] : [result.model_artifact_id])];
    }
    if (step.kind === 'evaluation') {
      const limitations = optionalStringArray(config, 'limitations');
      const result = await this.ml.evaluate({
        request_id: requestId,
        run_id: run.run_id,
        experiment_id: optionalString(config, 'experiment_id'),
        dataset_id: requiredString(config, 'dataset_id'),
        dataset_version: optionalPositive(config, 'dataset_version'),
        execution_target_id: optionalString(config, 'execution_target_id'),
        execution_target_policy_decision_id: optionalString(config, 'execution_target_policy_decision_id'),
        dataset_policy_decision_id: optionalString(config, 'dataset_policy_decision_id'),
        model_policy_decision_id: optionalString(config, 'model_policy_decision_id'),
        candidate_model_artifact_id: requiredString(config, 'candidate_model_artifact_id'),
        baseline_model_artifact_id: optionalString(config, 'baseline_model_artifact_id'),
        benchmark_id: optionalString(config, 'benchmark_id'),
        benchmark_version: optionalPositive(config, 'benchmark_version'),
        minimum_sample_size: optionalPositive(config, 'minimum_sample_size'),
        metrics: config['metrics'] as never,
        limitations: limitations === undefined ? undefined : [...limitations],
      });
      if (result === undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_EXECUTION_FAILED, `evaluation step failed: ${step.id}`);
      return [result.artifact_id];
    }
    const result = await this.ml.compare({
      request_id: requestId,
      run_id: run.run_id,
      experiment_ids: [...requiredStringArray(config, 'experiment_ids')],
      model_policy_decision_id: optionalString(config, 'model_policy_decision_id'),
    });
    if (result === undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_EXECUTION_FAILED, `comparison step failed: ${step.id}`);
    return [result.artifact_id];
  }

  private async persistStarted(
    pipeline: Pipeline,
    run: PipelineRun,
    requestId: string,
    pipelineState: Pipeline['state'] = 'running',
  ): Promise<void> {
    await this.replace({
      pipelines: this.pipelines.map((candidate) => candidate.id === pipeline.id ? pipelineSchema.parse({ ...candidate, state: pipelineState, run_ids: [...candidate.run_ids, run.run_id], pipeline_run_ids: [...candidate.pipeline_run_ids, run.id], latest_run_id: run.run_id, updated_at: run.started_at ?? run.created_at }) : candidate),
      runs: [...this.runs, run],
      requests: { ...this.requests, [requestId]: run.id },
    });
    this.changes.fire({ kind: 'run_updated', run });
  }

  private async persistRunOnly(run: PipelineRun, requestId?: string): Promise<void> {
    await this.replace({ pipelines: this.pipelines, runs: this.runs.some((candidate) => candidate.id === run.id) ? this.runs.map((candidate) => candidate.id === run.id ? run : candidate) : [...this.runs, run], requests: requestId === undefined ? this.requests : { ...this.requests, [requestId]: run.id } });
    this.changes.fire({ kind: 'run_updated', run });
  }

  private async persistCancelled(
    pipeline: Pipeline,
    current: PipelineRun,
    requestId: string,
    activeStepId?: string,
    cause?: unknown,
  ): Promise<PipelineRun> {
    const completedAt = nowIsoDateTime();
    const cancelled = pipelineRunSchema.parse({
      ...current,
      status: 'cancelled',
      step_runs: current.step_runs.map((step) =>
        step.state === 'succeeded'
          ? step
          : {
              ...step,
              state: 'cancelled',
              completed_at: step.completed_at ?? completedAt,
              error: activeStepId === undefined || step.step_id === activeStepId
                ? 'cancelled_by_request'
                : step.error,
            },
      ),
      completed_at: completedAt,
      error: cause === undefined ? 'cancelled_by_request' : `cancelled_by_request: ${safeError(cause)}`,
    });
    await this.persistRunOnly(cancelled, requestId);
    await this.finishPipeline(pipeline.id, cancelled, requestId, 'ready');
    return cancelled;
  }

  private async finishPipeline(pipelineId: string, run: PipelineRun, requestId: string, state: 'completed' | 'failed' | 'ready'): Promise<void> {
    const pipeline = this.require(pipelineId);
    const nextPipeline = pipelineSchema.parse({ ...pipeline, state, updated_at: run.completed_at ?? nowIsoDateTime() });
    await this.replace({ pipelines: this.pipelines.map((candidate) => candidate.id === pipelineId ? nextPipeline : candidate), runs: this.runs, requests: { ...this.requests, [requestId]: run.id } });
    const eventType = run.status === 'succeeded'
      ? 'pipeline_run.completed'
      : run.status === 'cancelled'
        ? 'pipeline_run.cancelled'
        : 'pipeline_run.failed';
    await this.events.append({ event_type: eventType, entity_type: 'pipeline_run', entity_id: run.id, request_id: requestId, actor: 'agent', state: run.status, payload: { pipeline_id: pipelineId, output_artifact_ids: run.output_artifact_ids } });
    this.changes.fire({ kind: 'pipeline_updated', pipeline: nextPipeline, run });
  }

  private async persistAwaitingRun(pipeline: Pipeline, command: PipelineRunInput, id: string, now: string, policyDecisionId: string | undefined, reason: string): Promise<PipelineRun> {
    const run = pipelineRunSchema.parse({ id, workspace_id: this.context.workspaceId, pipeline_id: pipeline.id, run_id: command.run_id, status: 'awaiting_approval', step_runs: pipeline.steps.map((step) => ({ step_id: step.id, state: 'queued', output_artifact_ids: [] })), execution_target_id: command.execution_target_id, execution_target_policy_decision_id: command.execution_target_policy_decision_id, output_artifact_ids: [], created_at: now, error: reason, metadata: { ...command.metadata, policy_decision_id: policyDecisionId } });
    await this.persistStarted(pipeline, run, command.request_id, 'ready');
    await this.events.append({
      event_type: 'pipeline_run.state_changed',
      entity_type: 'pipeline_run',
      entity_id: run.id,
      request_id: command.request_id,
      actor: 'agent',
      state: run.status,
      payload: { pipeline_id: pipeline.id, policy_decision_id: policyDecisionId, reason },
    });
    return run;
  }

  private async persistRejectedRun(pipeline: Pipeline, command: PipelineRunInput, id: string, now: string, reason: string): Promise<PipelineRun> {
    const run = pipelineRunSchema.parse({ id, workspace_id: this.context.workspaceId, pipeline_id: pipeline.id, run_id: command.run_id, status: 'failed', step_runs: pipeline.steps.map((step) => ({ step_id: step.id, state: 'failed', output_artifact_ids: [], error: reason })), execution_target_id: command.execution_target_id, output_artifact_ids: [], created_at: now, completed_at: now, error: reason, metadata: command.metadata });
    await this.persistStarted(pipeline, run, command.request_id);
    await this.finishPipeline(pipeline.id, run, command.request_id, 'failed');
    return run;
  }

  private require(id: string): Pipeline {
    const pipeline = this.pipelines.find((candidate) => candidate.id === id);
    if (pipeline === undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_NOT_FOUND, `pipeline not found: ${id}`, { pipelineId: id });
    return pipeline;
  }

  private requireRun(id: string): PipelineRun {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (run === undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_NOT_FOUND, `pipeline Run not found: ${id}`, { pipelineRunId: id });
    return run;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, PIPELINE_KEY);
    if (raw === undefined) {
      await this.replace({ pipelines: [], runs: [], requests: {} });
      return;
    }
    const document = documentSchema.parse(raw) as PipelineDocument;
    this.pipelines = document.pipelines;
    this.runs = document.runs;
    this.requests = document.requests;
    const interrupted = this.runs.filter((run) => run.status === 'running' || run.status === 'queued');
    if (interrupted.length > 0) {
      const now = nowIsoDateTime();
      this.runs = this.runs.map((run) => interrupted.includes(run) ? pipelineRunSchema.parse({ ...run, status: 'failed', completed_at: now, error: 'pipeline was interrupted by a process restart' }) : run);
      this.pipelines = this.pipelines.map((pipeline) => interrupted.some((run) => run.pipeline_id === pipeline.id) ? pipelineSchema.parse({ ...pipeline, state: 'failed', updated_at: now }) : pipeline);
      await this.replace({ pipelines: this.pipelines, runs: this.runs, requests: this.requests });
    }
  }

  private async replace(document: Omit<PipelineDocument, 'version'>): Promise<void> {
    const next: PipelineDocument = { version: DOCUMENT_VERSION, ...document };
    await this.store.set(this.scope, PIPELINE_KEY, next);
    this.pipelines = next.pipelines;
    this.runs = next.runs;
    this.requests = next.requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function validateSteps(steps: readonly PipelineStep[]): void {
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_INPUT, `duplicate pipeline step id: ${step.id}`);
    ids.add(step.id);
    assertSafeMetadata(step.config);
  }
  for (const step of steps) {
    for (const dependency of step.depends_on) {
      if (!ids.has(dependency)) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_INPUT, `pipeline dependency not found: ${dependency}`);
    }
  }
  topologicalSteps(steps);
}

function topologicalSteps(steps: readonly PipelineStep[]): readonly PipelineStep[] {
  const remaining = new Map(steps.map((step) => [step.id, step]));
  const output: PipelineStep[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((step) => step.depends_on.every((dependency) => output.some((candidate) => candidate.id === dependency)));
    if (ready.length === 0) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_CYCLE, 'pipeline steps contain a dependency cycle');
    for (const step of ready) {
      output.push(step);
      remaining.delete(step.id);
    }
  }
  return output;
}

function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.length === 0) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_INPUT, `pipeline step requires '${key}'`);
  return value;
}

function optionalString(config: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = config[key];
  return value === undefined ? undefined : requiredString(config, key);
}

function optionalPositive(config: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_INPUT, `pipeline step '${key}' must be a positive integer`);
  return value;
}

function optionalStringArray(config: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_INPUT, `pipeline step '${key}' must be an array of strings`);
  return value;
}

function requiredStringArray(config: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = optionalStringArray(config, key);
  if (value === undefined || value.length < 2) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_INVALID_INPUT, `pipeline step requires at least two '${key}' values`);
  return value;
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) throw new PipelineServiceError(PipelineErrors.codes.PIPELINE_SECRET_MATERIAL, `pipeline metadata cannot contain secret material in '${path}'`, { key: path });
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 2_000);
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspacePipelineService,
  WorkspacePipelineService,
  ScopeActivation.OnDemand,
  'pipelines',
);
