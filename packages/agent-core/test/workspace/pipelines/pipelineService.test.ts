/**
 * Scenario: durable native and remote pipeline Runs.
 * Responsibilities: persist definitions, execute ordered steps, propagate dependency
 * artifacts, and cancel an in-flight remote step. Real pipeline persistence is wired
 * with in-memory storage; ML, policy, target, execution, and event services are the
 * narrow test boundaries.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService, type WorkspaceExecutionRequest } from '#/workspace/execution/execution';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import { WorkspacePipelineService } from '#/workspace/pipelines/pipelineService';
import { IWorkspacePlatformEventService, type WorkspacePlatformEventInput } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import type { ExecutionTarget, PolicyEvaluateInput } from '@spiderbyte/protocol';

const context = {
  _serviceBrand: undefined,
  workspaceId: 'wd_workspace_pipeline_0123456789ab',
  cwd: '/tmp/workspace-pipeline',
  source: 'local' as const,
  meta: { id: 'wd_workspace_pipeline_0123456789ab', root: '/tmp/workspace-pipeline', name: 'pipeline-test', createdAt: Date.now(), lastOpenedAt: Date.now() },
  persistenceScope: 'workspaces/wd_workspace_pipeline_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspacePipelineService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let storage: InMemoryStorageService;
  let executionTarget: ExecutionTarget | undefined;
  let remotePayloads: Readonly<Record<string, unknown>>[];
  let blockRemoteExecution: boolean;
  let resolveRemoteExecution: (() => void) | undefined;
  let remoteExecutionStarted: Promise<void>;
  let cancelledExecutionRequests: string[];

  function build(): void {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IWorkspaceContext, context);
    ix.set(IFileSystemStorageService, storage);
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.stub(IWorkspaceMlService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      listAnalyses: async () => [],
      getAnalysis: async () => undefined,
      analyze: async () => ({
        id: 'analysis_pipeline',
        workspace_id: context.workspaceId,
        run_id: 'run_pipeline',
        dataset_id: 'dataset_sales',
        dataset_version: 1,
        dataset_artifact_id: 'artifact_dataset',
        kind: 'visualization' as const,
        row_count: 3,
        column_count: 1,
        report_artifact_id: 'artifact_report',
        visualization_artifact_ids: ['artifact_chart'],
        input_digest: 'a'.repeat(64),
        created_at: '2026-08-09T00:00:00.000Z',
      }),
      listExperiments: async () => [],
      getExperiment: async () => undefined,
      createExperiment: async () => { throw new Error('not used'); },
      validateExperiment: async () => undefined,
      listTrainingRuns: async () => [],
      getTrainingRun: async () => undefined,
      startTraining: async () => undefined,
      cancelTraining: async () => undefined,
      listEvaluations: async () => [],
      getEvaluation: async () => undefined,
      evaluate: async () => undefined,
      compare: async () => undefined,
      listModels: async () => [],
      getModel: async () => undefined,
      registerModel: async () => undefined,
      updateModelStage: async () => undefined,
    } as unknown as IWorkspaceMlService);
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      list: async () => [],
      get: async () => executionTarget,
      register: async () => { throw new Error('not used'); },
      update: async () => undefined,
      markReady: async () => undefined,
      disable: async () => undefined,
      acquireLease: async () => ({ id: 'lease_remote', state: 'active' as const }),
      releaseLease: async () => undefined,
    } as unknown as IWorkspaceExecutionTargetService);
    ix.stub(IWorkspaceExecutionService, {
      _serviceBrand: undefined,
      execute: async (input: WorkspaceExecutionRequest) => {
        remotePayloads.push(input.payload);
        if (blockRemoteExecution) {
          resolveRemoteExecution?.();
          await new Promise<void>((resolve) => {
            resolveRemoteExecution = resolve;
          });
        }
        return { status: 'succeeded' as const, output_artifact_ids: ['artifact_remote'] };
      },
      cancel: async (requestId: string) => {
        cancelledExecutionRequests.push(requestId);
        resolveRemoteExecution?.();
        return true;
      },
    } as unknown as IWorkspaceExecutionService);
    ix.stub(IWorkspacePolicyService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      list: async () => [],
      get: async () => undefined,
      rules: async () => [],
      setRules: async () => [],
      evaluate: async (input: PolicyEvaluateInput) => ({
        id: `policy_${input.request_id}`,
        workspace_id: context.workspaceId,
        run_id: input.run_id,
        capability: input.capability,
        action: input.action,
        state: 'evaluated' as const,
        outcome: 'allow' as const,
        reason: 'test policy allows pipelines',
        requested_by: input.requested_by,
        requested_at: '2026-08-09T00:00:00.000Z',
        evaluated_at: '2026-08-09T00:00:00.000Z',
      }),
      approve: async () => undefined,
      deny: async () => undefined,
      audit: async () => undefined,
      explain: async () => undefined,
    } as unknown as IWorkspacePolicyService);
    ix.stub(IWorkspacePlatformEventService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      append: async (input: WorkspacePlatformEventInput) => ({
        event_id: `event_${input.entity_id}`,
        event_type: input.event_type as never,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        workspace_id: context.workspaceId,
        sequence: 1,
        occurred_at: '2026-08-09T00:00:00.000Z',
        request_id: input.request_id,
        actor: input.actor,
        state: input.state,
        payload: input.payload,
      }),
      replay: async () => ({ events: [], next_sequence: 0, has_more: false }),
    } as unknown as IWorkspacePlatformEventService);
    ix.set(IWorkspacePipelineService, new SyncDescriptor(WorkspacePipelineService));
  }

  beforeEach(() => {
    storage = new InMemoryStorageService();
    executionTarget = undefined;
    remotePayloads = [];
    blockRemoteExecution = false;
    resolveRemoteExecution = undefined;
    remoteExecutionStarted = new Promise<void>((resolve) => {
      resolveRemoteExecution = resolve;
    });
    cancelledExecutionRequests = [];
    build();
  });

  afterEach(() => disposables.dispose());

  it('persists and executes native analysis steps as a durable pipeline Run', async () => {
    const service = ix.get(IWorkspacePipelineService);
    const pipeline = await service.create({
      request_id: 'pipeline_create_1',
      name: 'sales analysis',
      steps: [{ id: 'profile', name: 'Profile sales', kind: 'analysis', config: { dataset_id: 'dataset_sales' } }],
    });
    const run = await service.run(pipeline.id, { request_id: 'pipeline_run_1', run_id: 'run_pipeline' });
    expect(run).toMatchObject({ status: 'succeeded', output_artifact_ids: ['artifact_report', 'artifact_chart'] });
    expect(run?.step_runs).toMatchObject([{ step_id: 'profile', state: 'succeeded' }]);

    disposables.dispose();
    build();
    await expect(ix.get(IWorkspacePipelineService).list()).resolves.toHaveLength(1);
    await expect(ix.get(IWorkspacePipelineService).listRuns()).resolves.toHaveLength(1);
  });

  it('rejects dependency cycles before persistence', async () => {
    const service = ix.get(IWorkspacePipelineService);
    await expect(service.create({
      request_id: 'pipeline_cycle',
      name: 'cycle',
      steps: [
        { id: 'a', name: 'A', kind: 'analysis', config: { dataset_id: 'dataset_sales' }, depends_on: ['b'] },
        { id: 'b', name: 'B', kind: 'analysis', config: { dataset_id: 'dataset_sales' }, depends_on: ['a'] },
      ],
    })).rejects.toMatchObject({ code: 'pipeline.cycle' });
    await expect(service.list()).resolves.toHaveLength(0);
  });

  it('dispatches steps to the selected remote target adapter', async () => {
    executionTarget = {
      id: 'target_self_hosted',
      workspace_id: context.workspaceId,
      name: 'customer cloud',
      type: 'customer-managed',
      state: 'ready',
      locality: 'customer-region',
      capabilities: ['analysis'],
      created_at: '2026-08-09T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    };
    const service = ix.get(IWorkspacePipelineService);
    const pipeline = await service.create({
      request_id: 'pipeline_remote_create',
      name: 'remote analysis',
      steps: [{ id: 'profile', name: 'Profile sales', kind: 'analysis', config: { dataset_id: 'dataset_sales' } }],
    });
    const run = await service.run(pipeline.id, {
      request_id: 'pipeline_remote_run',
      run_id: 'run_pipeline_remote',
      execution_target_id: executionTarget.id,
    });
    expect(run).toMatchObject({ status: 'succeeded', output_artifact_ids: ['artifact_remote'] });
  });

  it('propagates completed dependency artifacts to a downstream remote step', async () => {
    executionTarget = {
      id: 'target_self_hosted_dependencies',
      workspace_id: context.workspaceId,
      name: 'customer cloud dependencies',
      type: 'customer-managed',
      state: 'ready',
      locality: 'customer-region',
      capabilities: ['analysis'],
      created_at: '2026-08-09T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    };
    const service = ix.get(IWorkspacePipelineService);
    const pipeline = await service.create({
      request_id: 'pipeline_dependency_create',
      name: 'dependent remote analysis',
      steps: [
        { id: 'source', name: 'Source analysis', kind: 'analysis', config: { dataset_id: 'dataset_sales' } },
        { id: 'consumer', name: 'Consumer analysis', kind: 'analysis', depends_on: ['source'], config: { dataset_id: 'dataset_sales' } },
      ],
    });
    await expect(service.run(pipeline.id, {
      request_id: 'pipeline_dependency_run',
      run_id: 'run_pipeline_dependency',
      execution_target_id: executionTarget.id,
    })).resolves.toMatchObject({ status: 'succeeded' });
    expect(remotePayloads[1]?.['dependency_artifact_ids']).toEqual(['artifact_remote']);
  });

  it('cancels an in-flight remote step and leaves the pipeline ready to run again', async () => {
    executionTarget = {
      id: 'target_self_hosted_cancel',
      workspace_id: context.workspaceId,
      name: 'customer cloud cancel',
      type: 'customer-managed',
      state: 'ready',
      locality: 'customer-region',
      capabilities: ['analysis'],
      created_at: '2026-08-09T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    };
    blockRemoteExecution = true;
    const service = ix.get(IWorkspacePipelineService);
    const pipeline = await service.create({
      request_id: 'pipeline_cancel_create',
      name: 'cancel remote analysis',
      steps: [{ id: 'source', name: 'Source analysis', kind: 'analysis', config: { dataset_id: 'dataset_sales' } }],
    });
    const runPromise = service.run(pipeline.id, {
      request_id: 'pipeline_cancel_run',
      run_id: 'run_pipeline_cancel',
      execution_target_id: executionTarget.id,
    });
    await remoteExecutionStarted;
    const run = await service.getRun((await service.listRuns())[0]!.id);
    const cancelled = await service.cancelRun(run!.id, { request_id: 'pipeline_cancel_request' });
    await expect(runPromise).resolves.toMatchObject({
      id: run!.id,
      status: 'cancelled',
      step_runs: [{ state: 'cancelled' }],
    });
    expect(cancelled).toMatchObject({ id: run!.id, status: 'cancelled' });
    expect(cancelledExecutionRequests).toEqual(['pipeline_cancel_run:step:source']);
    await expect(service.get(pipeline.id)).resolves.toMatchObject({ state: 'ready' });
  });
});
