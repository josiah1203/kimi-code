/**
 * ML workflow scenarios — exercises durable local and remote analysis, training,
 * evaluation, comparison, registry, redaction, cancellation, and reload paths.
 * Workspace services are real through the test container; storage, policy,
 * artifacts, datasets, and the remote worker boundary are controlled fixtures.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough, Readable, Writable } from 'node:stream';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { WorkspaceMlService } from '#/workspace/ml/mlService';
import { IWorkspacePlatformEventService, type WorkspacePlatformEventInput } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { ISessionProcessRunner, type IProcess } from '#/session/process/processRunner';
import type { Artifact, ArtifactCreateInput, Dataset, PolicyEvaluateInput } from '@moonshot-ai/protocol';

const context = {
  _serviceBrand: undefined,
  workspaceId: 'wd_kimi_ml_0123456789ab',
  cwd: '/tmp/kimi-ml',
  source: 'local' as const,
  meta: {
    id: 'wd_kimi_ml_0123456789ab',
    root: '/tmp/kimi-ml',
    name: 'ml-test',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  },
  persistenceScope: 'workspaces/wd_kimi_ml_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

const sourceCsv = 'segment,feature,target\nA,1,yes\nB,2,yes\nC,3,no\n';

function sourceDataset(): Dataset {
  return {
    id: 'dataset_sales',
    workspace_id: context.workspaceId,
    name: 'sales',
    format: 'csv',
    current_version: 1,
    versions: [{
      version: 1,
      artifact_id: 'artifact_dataset',
      row_count: 3,
      columns: [
        { name: 'segment', type: 'string', nullable: false, non_null_count: 3, distinct_count: 3 },
        { name: 'feature', type: 'integer', nullable: false, non_null_count: 3, distinct_count: 3 },
        { name: 'target', type: 'string', nullable: false, non_null_count: 3, distinct_count: 2 },
      ],
      created_at: '2026-08-08T00:00:00.000Z',
    }],
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
  };
}

describe('WorkspaceMlService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let storage: InMemoryStorageService;
  let artifacts: Map<string, Artifact>;
  let contents: Map<string, string>;
  let artifactCounter: number;

  function build(options: {
    readonly remote?: boolean;
    readonly execution?: IWorkspaceExecutionService;
    readonly localTrainer?: ISessionProcessRunner;
  } = {}): void {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IWorkspaceContext, context);
    ix.set(IFileSystemStorageService, storage);
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.stub(IWorkspaceDatasetService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      list: async () => [sourceDataset()],
      get: async (id: string) => id === 'dataset_sales' ? sourceDataset() : undefined,
    } as unknown as IWorkspaceDatasetService);
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      list: async () => [],
      get: async (id: string) => options.remote && id === 'target_customer'
        ? {
            id,
            workspace_id: context.workspaceId,
            name: 'customer worker',
            type: 'customer-managed',
            state: 'ready',
            locality: 'customer-region',
            capabilities: ['analysis', 'evaluation', 'training'],
            created_at: '2026-08-08T00:00:00.000Z',
            updated_at: '2026-08-08T00:00:00.000Z',
          }
        : undefined,
      register: async () => { throw new Error('not used'); },
      update: async () => undefined,
      markReady: async () => undefined,
      disable: async () => undefined,
      acquireLease: async () => { throw new Error('not used'); },
      releaseLease: async () => undefined,
    } as unknown as IWorkspaceExecutionTargetService);
    ix.stub(IWorkspaceExecutionService, {
      _serviceBrand: undefined,
      execute: async () => ({ status: 'failed', output_artifact_ids: [], error: 'not used in local ML test' }),
    } as unknown as IWorkspaceExecutionService);
    if (options.execution !== undefined) ix.stub(IWorkspaceExecutionService, options.execution);
    if (options.localTrainer !== undefined) ix.stub(ISessionProcessRunner, options.localTrainer);
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
        state: 'evaluated',
        outcome: 'allow',
        reason: 'test policy allows local ML',
        requested_by: input.requested_by,
        requested_at: '2026-08-08T00:00:00.000Z',
        evaluated_at: '2026-08-08T00:00:00.000Z',
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
        occurred_at: '2026-08-08T00:00:00.000Z',
        request_id: input.request_id,
        actor: input.actor,
        state: input.state,
        payload: input.payload,
      }),
      replay: async () => ({ events: [], next_sequence: 0, has_more: false }),
    } as unknown as IWorkspacePlatformEventService);
    ix.stub(IWorkspaceArtifactService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      list: async () => [...artifacts.values()],
      get: async (id: string) => artifacts.get(id),
      download: async (id: string) => {
        const artifact = artifacts.get(id);
        const contentBase64 = contents.get(id);
        return artifact === undefined || contentBase64 === undefined
          ? undefined
          : { artifact, content_base64: contentBase64 };
      },
      create: async (input: ArtifactCreateInput) => {
        const id = `artifact_ml_${++artifactCounter}`;
        const artifact: Artifact = {
          id,
          workspace_id: context.workspaceId,
          run_id: input.run_id,
          name: input.name,
          kind: input.kind,
          version: 1,
          content_ref: `blob_${id}`,
          media_type: input.media_type,
          size_bytes: Buffer.from(input.content_base64, 'base64').byteLength,
          sha256: 'a'.repeat(64),
          created_at: '2026-08-08T00:00:00.000Z',
          source_artifact_ids: input.source_artifact_ids,
          metadata: input.metadata,
        };
        artifacts.set(id, artifact);
        contents.set(id, input.content_base64);
        return artifact;
      },
      lineage: async () => undefined,
      expire: async () => undefined,
    } as unknown as IWorkspaceArtifactService);
    ix.set(IWorkspaceMlService, new SyncDescriptor(WorkspaceMlService));
  }

  beforeEach(() => {
    storage = new InMemoryStorageService();
    artifacts = new Map([["artifact_dataset", {
      id: 'artifact_dataset',
      workspace_id: context.workspaceId,
      name: 'sales.csv',
      kind: 'dataset',
      version: 1,
      content_ref: 'blob_dataset',
      media_type: 'text/csv',
      size_bytes: Buffer.byteLength(sourceCsv),
      sha256: 'a'.repeat(64),
      created_at: '2026-08-08T00:00:00.000Z',
    }]]);
    contents = new Map([['artifact_dataset', Buffer.from(sourceCsv).toString('base64')]]);
    artifactCounter = 0;
    build();
  });

  afterEach(() => disposables.dispose());

  it('creates, trains, evaluates, compares, registers, and reloads durable ML records', async () => {
    const service = ix.get(IWorkspaceMlService);
    const analysis = await service.analyze({
      request_id: 'analysis_create_1',
      run_id: 'run_analysis_1',
      dataset_id: 'dataset_sales',
      kind: 'notebook',
      columns: ['feature', 'target'],
      group_by: 'target',
    });
    expect(analysis).toMatchObject({
      kind: 'notebook',
      row_count: 3,
      report_artifact_id: expect.any(String),
      visualization_artifact_ids: [expect.any(String)],
      notebook_artifact_id: expect.any(String),
    });
    const first = await service.createExperiment({
      request_id: 'experiment_create_1',
      run_id: 'run_experiment_1',
      name: 'churn baseline',
      dataset_id: 'dataset_sales',
      target: 'target',
      features: ['feature'],
      task: 'classification',
      algorithm: 'majority',
      metrics: [{ name: 'accuracy' }],
      hyperparameters: {},
      seed: 7,
    });
    const training = await service.startTraining(first.id, {
      request_id: 'training_start_1',
      run_id: 'run_training_1',
    });
    expect(training).toMatchObject({ status: 'succeeded', metrics: { accuracy: 2 / 3 } });
    const modelArtifactId = training?.model_artifact_id;
    expect(modelArtifactId).toEqual(expect.any(String));

    const evaluation = await service.evaluate({
      request_id: 'evaluation_create_1',
      run_id: 'run_evaluation_1',
      experiment_id: first.id,
      dataset_id: 'dataset_sales',
      candidate_model_artifact_id: modelArtifactId!,
      metrics: [{ name: 'accuracy' }],
    });
    expect(evaluation).toMatchObject({ recommendation: 'promote', metrics: [{ name: 'accuracy', candidate: 2 / 3 }] });

    const model = await service.registerModel({
      request_id: 'model_register_1',
      model_name: 'churn-baseline',
      artifact_id: modelArtifactId!,
      experiment_id: first.id,
      training_run_id: training!.id,
      evaluation_id: evaluation?.id,
      metrics: { accuracy: 2 / 3 },
    });
    expect(model).toMatchObject({ model_name: 'churn-baseline', stage: 'candidate', version: 1 });

    const second = await service.createExperiment({
      request_id: 'experiment_create_2',
      run_id: 'run_experiment_2',
      name: 'churn baseline two',
      dataset_id: 'dataset_sales',
      target: 'target',
      features: ['feature'],
      task: 'classification',
      algorithm: 'majority_classifier',
      metrics: [{ name: 'accuracy' }],
      hyperparameters: {},
      seed: 8,
    });
    await service.startTraining(second!.id, { request_id: 'training_start_2', run_id: 'run_training_2' });
    const comparison = await service.compare({
      request_id: 'comparison_create_1',
      run_id: 'run_comparison_1',
      experiment_ids: [first.id, second!.id],
    });
    expect(comparison?.experiment_ids).toEqual([first.id, second!.id]);
    expect(comparison?.artifact_id).toEqual(expect.any(String));

    disposables.dispose();
    build();
    const reloaded = await ix.get(IWorkspaceMlService).listExperiments();
    expect(reloaded.map((experiment) => experiment.name)).toEqual(['churn baseline', 'churn baseline two']);
    expect(await ix.get(IWorkspaceMlService).listAnalyses()).toHaveLength(1);
    await disposables.dispose();
  });

  it('rejects secret-bearing metadata before persisting ML records', async () => {
    const service = ix.get(IWorkspaceMlService);
    await expect(service.createExperiment({
      request_id: 'experiment_secret',
      name: 'unsafe',
      dataset_id: 'dataset_sales',
      target: 'target',
      features: ['feature'],
      task: 'classification',
      algorithm: 'majority',
      metrics: [{ name: 'accuracy' }],
      hyperparameters: {},
      seed: 1,
      metadata: { api_key: 'should-not-persist' },
    })).rejects.toMatchObject({ code: 'ml.secret_material' });
    expect(JSON.stringify(await service.listExperiments())).not.toContain('should-not-persist');
  });

  it('trains and evaluates the built-in nearest-centroid classifier locally', async () => {
    const service = ix.get(IWorkspaceMlService);
    const experiment = await service.createExperiment({
      request_id: 'centroid_experiment_create',
      name: 'centroid classifier',
      dataset_id: 'dataset_sales',
      target: 'target',
      features: ['feature'],
      task: 'classification',
      algorithm: 'nearest_centroid',
      metrics: [{ name: 'accuracy' }],
    });
    const training = await service.startTraining(experiment.id, {
      request_id: 'centroid_training_start',
      run_id: 'run_centroid_training',
    });
    expect(training).toMatchObject({ status: 'succeeded', metrics: { accuracy: 1 } });

    const modelContent = Buffer.from(contents.get(training!.model_artifact_id!)!, 'base64').toString('utf8');
    expect(JSON.parse(modelContent)).toMatchObject({
      model_type: 'nearest_centroid',
      centroids: { yes: [1.5], no: [3] },
    });
    const evaluation = await service.evaluate({
      request_id: 'centroid_evaluation',
      run_id: 'run_centroid_evaluation',
      experiment_id: experiment.id,
      dataset_id: 'dataset_sales',
      candidate_model_artifact_id: training!.model_artifact_id!,
      metrics: [{ name: 'accuracy' }],
    });
    expect(evaluation).toMatchObject({ recommendation: 'promote', metrics: [{ candidate: 1 }] });
  });

  it('dispatches non-local training through the governed execution adapter', async () => {
    disposables.dispose();
    const modelArtifact: Artifact = {
      id: 'artifact_remote_model',
      workspace_id: context.workspaceId,
      run_id: 'run_remote_training',
      name: 'remote.model.json',
      kind: 'model',
      version: 1,
      content_ref: 'blob_remote_model',
      media_type: 'application/json',
      size_bytes: 16,
      sha256: 'b'.repeat(64),
      created_at: '2026-08-08T00:00:00.000Z',
    };
    artifacts.set(modelArtifact.id, modelArtifact);
    const leases: string[] = [];
    build({
      remote: true,
      execution: {
        _serviceBrand: undefined,
        execute: async () => ({
          status: 'succeeded',
          output_artifact_ids: [modelArtifact.id],
          metrics: { accuracy: 0.91 },
          metadata: { worker: 'customer-managed' },
        }),
      } as unknown as IWorkspaceExecutionService,
    });
    // Replace the target stub's lease methods with observable implementations
    // after the common fixture is built.
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      list: async () => [],
      get: async (id: string) => id === 'target_customer' ? {
        id,
        workspace_id: context.workspaceId,
        name: 'customer worker',
        type: 'customer-managed',
        state: 'ready',
        locality: 'customer-region',
        capabilities: ['training'],
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      } : undefined,
      register: async () => { throw new Error('not used'); },
      update: async () => undefined,
      markReady: async () => undefined,
      disable: async () => undefined,
      acquireLease: async () => {
        leases.push('acquired');
        return { id: 'lease_remote', state: 'active' } as never;
      },
      releaseLease: async () => {
        leases.push('released');
        return undefined;
      },
    } as unknown as IWorkspaceExecutionTargetService);
    const service = ix.get(IWorkspaceMlService);
    const experiment = await service.createExperiment({
      request_id: 'remote_experiment_create',
      run_id: 'run_remote_experiment',
      name: 'remote churn',
      dataset_id: 'dataset_sales',
      target: 'target',
      features: ['feature'],
      task: 'classification',
      algorithm: 'remote-baseline',
      execution_target_id: 'target_customer',
      metrics: [{ name: 'accuracy' }],
    });
    const training = await service.startTraining(experiment.id, {
      request_id: 'remote_training_start',
      run_id: 'run_remote_training',
      execution_target_id: 'target_customer',
    });
    expect(training).toMatchObject({
      status: 'succeeded',
      executor: 'customer-managed',
      model_artifact_id: modelArtifact.id,
      metrics: { accuracy: 0.91 },
    });
    expect(leases).toEqual(['acquired', 'released']);
  });

  it('dispatches analysis and evaluation through a non-local target and preserves remote artifacts', async () => {
    disposables.dispose();
    const remoteReport: Artifact = {
      id: 'artifact_remote_analysis_report',
      workspace_id: context.workspaceId,
      run_id: 'run_remote_analysis',
      name: 'analysis.json',
      kind: 'metrics',
      version: 1,
      content_ref: 'blob_remote_analysis_report',
      media_type: 'application/json',
      size_bytes: 128,
      sha256: 'c'.repeat(64),
      created_at: '2026-08-08T00:00:00.000Z',
    };
    const remoteVisualization: Artifact = {
      id: 'artifact_remote_analysis_visualization',
      workspace_id: context.workspaceId,
      run_id: 'run_remote_analysis',
      name: 'analysis.svg',
      kind: 'visualization',
      version: 1,
      content_ref: 'blob_remote_analysis_visualization',
      media_type: 'image/svg+xml',
      size_bytes: 16,
      sha256: 'd'.repeat(64),
      created_at: '2026-08-08T00:00:00.000Z',
    };
    const remoteEvaluationReport: Artifact = {
      id: 'artifact_remote_evaluation_report',
      workspace_id: context.workspaceId,
      run_id: 'run_remote_evaluation',
      name: 'evaluation.json',
      kind: 'metrics',
      version: 1,
      content_ref: 'blob_remote_evaluation_report',
      media_type: 'application/json',
      size_bytes: 160,
      sha256: 'e'.repeat(64),
      created_at: '2026-08-08T00:00:00.000Z',
    };
    const candidateModel: Artifact = {
      id: 'artifact_remote_candidate_model',
      workspace_id: context.workspaceId,
      run_id: 'run_remote_training',
      name: 'candidate.model.json',
      kind: 'model',
      version: 1,
      content_ref: 'blob_remote_candidate_model',
      media_type: 'application/json',
      size_bytes: 16,
      sha256: 'f'.repeat(64),
      created_at: '2026-08-08T00:00:00.000Z',
    };
    artifacts.set(remoteReport.id, remoteReport);
    artifacts.set(remoteVisualization.id, remoteVisualization);
    artifacts.set(remoteEvaluationReport.id, remoteEvaluationReport);
    artifacts.set(candidateModel.id, candidateModel);
    contents.set(remoteReport.id, Buffer.from(JSON.stringify({
      row_count: 3,
      column_count: 3,
      input_digest: '1'.repeat(64),
    })).toString('base64'));
    contents.set(remoteVisualization.id, Buffer.from('<svg/>').toString('base64'));
    contents.set(remoteEvaluationReport.id, Buffer.from(JSON.stringify({
      sample_size: 3,
      input_digest: '2'.repeat(64),
      metrics: [{ name: 'accuracy', candidate: 0.91, passed: true }],
      recommendation: 'promote',
      limitations: [],
    })).toString('base64'));
    const leases: string[] = [];
    build({
      remote: true,
      execution: {
        _serviceBrand: undefined,
        execute: async (input: { readonly operation: string }) => input.operation === 'analysis'
          ? { status: 'succeeded', output_artifact_ids: [remoteReport.id, remoteVisualization.id], metadata: { worker: 'customer-managed' } }
          : { status: 'succeeded', output_artifact_ids: [remoteEvaluationReport.id], metadata: { worker: 'customer-managed' } },
      } as unknown as IWorkspaceExecutionService,
    });
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      list: async () => [],
      get: async (id: string) => id === 'target_customer' ? {
        id,
        workspace_id: context.workspaceId,
        name: 'customer worker',
        type: 'customer-managed',
        state: 'ready',
        locality: 'customer-region',
        capabilities: ['analysis', 'evaluation'],
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      } : undefined,
      register: async () => { throw new Error('not used'); },
      update: async () => undefined,
      markReady: async () => undefined,
      disable: async () => undefined,
      acquireLease: async () => {
        const id = `lease_remote_${leases.length + 1}`;
        leases.push('acquired:' + id);
        return { id, state: 'active' } as never;
      },
      releaseLease: async (_targetId: string, leaseId: string) => {
        leases.push('released:' + leaseId);
        return undefined;
      },
    } as unknown as IWorkspaceExecutionTargetService);
    const service = ix.get(IWorkspaceMlService);
    const analysis = await service.analyze({
      request_id: 'remote_analysis_create',
      run_id: 'run_remote_analysis',
      dataset_id: 'dataset_sales',
      execution_target_id: 'target_customer',
      kind: 'visualization',
    });
    expect(analysis).toMatchObject({
      row_count: 3,
      column_count: 3,
      report_artifact_id: remoteReport.id,
      visualization_artifact_ids: [remoteVisualization.id],
      metadata: {
        execution_target_id: 'target_customer',
        execution_operation: 'analysis',
      },
    });
    const evaluation = await service.evaluate({
      request_id: 'remote_evaluation_create',
      run_id: 'run_remote_evaluation',
      dataset_id: 'dataset_sales',
      execution_target_id: 'target_customer',
      candidate_model_artifact_id: candidateModel.id,
      metrics: [{ name: 'accuracy' }],
    });
    expect(evaluation).toMatchObject({
      sample_size: 3,
      recommendation: 'promote',
      artifact_id: remoteEvaluationReport.id,
      metrics: [{ name: 'accuracy', candidate: 0.91, passed: true }],
      metadata: {
        execution_target_id: 'target_customer',
        execution_operation: 'evaluation',
      },
    });
    expect(leases).toEqual([
      'acquired:lease_remote_1',
      'released:lease_remote_1',
      'acquired:lease_remote_3',
      'released:lease_remote_3',
    ]);
  });

  it('dispatches configured local Python training and persists redacted outputs', async () => {
    const previousCommand = process.env['KIMI_CODE_ML_TRAIN_COMMAND'];
    const previousArgs = process.env['KIMI_CODE_ML_TRAIN_ARGS'];
    process.env['KIMI_CODE_ML_TRAIN_COMMAND'] = 'fake-ml-trainer';
    delete process.env['KIMI_CODE_ML_TRAIN_ARGS'];
    let request = '';
    const localTrainer: ISessionProcessRunner = {
      _serviceBrand: undefined,
      exec: async (args) => {
        expect(args).toEqual(['fake-ml-trainer']);
        const stdin = new Writable({
          write(chunk, _encoding, callback) {
            request += chunk.toString();
            callback();
          },
        });
        const model = {
          schema_version: 1,
          task: 'classification',
          algorithm: 'python-logistic',
          target: 'target',
          features: ['feature'],
          prediction: 'yes',
          training_rows: 3,
          metrics: { accuracy: 0.8 },
        };
        const process: IProcess = {
          stdin,
          stdout: Readable.from([JSON.stringify({
            metrics: { accuracy: 0.8 },
            model,
            checkpoint: { ...model, checkpoint: true },
            logs: 'api_key=do-not-persist\ntrainer complete',
            environment: { python: '3.12', executor: 'fake' },
          })]),
          stderr: Readable.from([]),
          pid: 123,
          exitCode: 0,
          wait: async () => 0,
          kill: async () => undefined,
          dispose: () => undefined,
        };
        return process;
      },
    };
    try {
      disposables.dispose();
      build({ localTrainer });
      const service = ix.get(IWorkspaceMlService);
      const experiment = await service.createExperiment({
        request_id: 'python_experiment_create',
        run_id: 'run_python_experiment',
        name: 'python trainer',
        dataset_id: 'dataset_sales',
        target: 'target',
        features: ['feature'],
        task: 'classification',
        algorithm: 'python-logistic',
        metrics: [{ name: 'accuracy' }],
      });
      const training = await service.startTraining(experiment.id, {
        request_id: 'python_training_start',
        run_id: 'run_python_training',
      });
      expect(training).toMatchObject({
        status: 'succeeded',
        executor: 'local',
        metrics: { accuracy: 0.8 },
        environment: { python: '3.12', executor: 'fake' },
      });
      expect(JSON.parse(request)).toMatchObject({
        schema_version: 1,
        experiment_id: experiment.id,
        dataset_artifact_id: 'artifact_dataset',
        dataset_csv: sourceCsv,
        algorithm: 'python-logistic',
      });
      const logs = [...artifacts.values()].find((artifact) => artifact.kind === 'log');
      expect(logs).toBeDefined();
      expect(Buffer.from(contents.get(logs!.id)!, 'base64').toString('utf8')).toContain('[REDACTED]');
      expect(Buffer.from(contents.get(logs!.id)!, 'base64').toString('utf8')).not.toContain('do-not-persist');
    } finally {
      if (previousCommand === undefined) delete process.env['KIMI_CODE_ML_TRAIN_COMMAND'];
      else process.env['KIMI_CODE_ML_TRAIN_COMMAND'] = previousCommand;
      if (previousArgs === undefined) delete process.env['KIMI_CODE_ML_TRAIN_ARGS'];
      else process.env['KIMI_CODE_ML_TRAIN_ARGS'] = previousArgs;
    }
  });

  it('cancels an in-flight configured local trainer and makes the experiment retryable', async () => {
    const previousCommand = process.env['KIMI_CODE_ML_TRAIN_COMMAND'];
    process.env['KIMI_CODE_ML_TRAIN_COMMAND'] = 'blocking-ml-trainer';
    let started = false;
    try {
      const localTrainer: ISessionProcessRunner = {
        _serviceBrand: undefined,
        exec: async () => {
          started = true;
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          let resolveWait!: (exitCode: number) => void;
          const wait = new Promise<number>((resolve) => {
            resolveWait = resolve;
          });
          let killed = false;
          const process: IProcess = {
            stdin: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
            stdout,
            stderr,
            pid: 456,
            exitCode: null,
            wait: () => wait,
            kill: async () => {
              if (killed) return;
              killed = true;
              stdout.end();
              stderr.end();
              resolveWait(137);
            },
            dispose: () => undefined,
          };
          return process;
        },
      };
      disposables.dispose();
      build({ localTrainer });
      const service = ix.get(IWorkspaceMlService);
      const experiment = await service.createExperiment({
        request_id: 'cancel_experiment_create',
        run_id: 'run_cancel_experiment',
        name: 'cancellable trainer',
        dataset_id: 'dataset_sales',
        target: 'target',
        features: ['feature'],
        task: 'classification',
        algorithm: 'python-logistic',
        metrics: [{ name: 'accuracy' }],
      });
      const trainingPromise = service.startTraining(experiment.id, {
        request_id: 'cancel_training_start',
        run_id: 'run_cancel_training',
      });
      for (let attempt = 0; attempt < 100 && !started; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const running = (await service.listTrainingRuns(experiment.id))[0];
      expect(running).toMatchObject({ status: 'running' });
      const cancelled = await service.cancelTraining(running!.id, {
        request_id: 'cancel_training_request',
      });
      const training = await trainingPromise;
      expect(cancelled).toMatchObject({ status: 'cancelled', error: 'cancelled_by_request' });
      expect(training).toMatchObject({ status: 'cancelled', error: 'cancelled_by_request' });
      expect(await service.getExperiment(experiment.id)).toMatchObject({ state: 'ready' });
    } finally {
      if (previousCommand === undefined) delete process.env['KIMI_CODE_ML_TRAIN_COMMAND'];
      else process.env['KIMI_CODE_ML_TRAIN_COMMAND'] = previousCommand;
    }
  });
});
