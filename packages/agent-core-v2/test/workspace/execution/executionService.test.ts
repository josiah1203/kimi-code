import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IPlatformSecretStore } from '#/app/secrets/platformSecretStore';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { WorkspaceExecutionService } from '#/workspace/execution/executionService';
import { IWorkspaceCommercialService } from '#/workspace/commercial/commercial';

const context = {
  _serviceBrand: undefined,
  workspaceId: 'wd_kimi_execution_0123456789ab',
  cwd: '/tmp/kimi-execution',
  source: 'local' as const,
  meta: { id: 'wd_kimi_execution_0123456789ab', root: '/tmp/kimi-execution', name: 'execution-test', createdAt: Date.now(), lastOpenedAt: Date.now() },
  persistenceScope: 'workspaces/wd_kimi_execution_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspaceExecutionService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let created: Record<string, unknown>[];
  let documents: Map<string, unknown>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    created = [];
    documents = new Map();
    ix.stub(IAtomicDocumentStore, {
      _serviceBrand: undefined,
      get: async (_scope: string, key: string) => documents.get(key),
      set: async (_scope: string, key: string, value: unknown) => { documents.set(key, value); },
      delete: async (_scope: string, key: string) => { documents.delete(key); },
      list: async () => [],
      watch: (() => ({ dispose: () => {} })) as never,
      acquire: () => ({ dispose: () => {} }),
    } as unknown as IAtomicDocumentStore);
    ix.stub(IWorkspaceContext, context);
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      get: async () => ({
        id: 'target_customer_worker',
        workspace_id: context.workspaceId,
        name: 'customer worker',
        type: 'customer-managed' as const,
        state: 'ready' as const,
        locality: 'customer-region' as const,
        capabilities: ['analysis'],
        credential_ref: 'secret_worker',
        created_at: '2026-08-09T00:00:00.000Z',
        updated_at: '2026-08-09T00:00:00.000Z',
        metadata: { worker_endpoint: 'https://worker.example.test/execute' },
      }),
      getLease: async () => ({
        id: 'lease_customer_worker',
        workspace_id: context.workspaceId,
        target_id: 'target_customer_worker',
        lease_ref: 'lease-ref-customer-worker',
        state: 'active' as const,
        issued_at: '2026-08-09T00:00:00.000Z',
        expires_at: '2099-01-01T00:00:00.000Z',
      }),
    });
    ix.stub(IPlatformSecretStore, {
      _serviceBrand: undefined,
      get: async () => 'worker-secret',
    });
    ix.stub(IWorkspaceCommercialService, {
      _serviceBrand: undefined,
      recordUsage: async (input: Record<string, unknown>) => input,
    } as unknown as IWorkspaceCommercialService);
    ix.stub(IWorkspaceArtifactService, {
      _serviceBrand: undefined,
      get: async (id: string) => ['artifact_dataset', 'artifact_model'].includes(id)
        ? { id, workspace_id: context.workspaceId, name: `${id}.csv`, kind: 'dataset', media_type: 'text/csv' }
        : undefined,
      download: async (id: string) => ['artifact_dataset', 'artifact_model'].includes(id)
        ? { id, content_base64: Buffer.from('feature,target\n1,yes\n2,no\n').toString('base64') }
        : undefined,
      create: async (input: Record<string, unknown>) => {
        created.push(input);
        return { id: 'artifact_remote_metrics' };
      },
    } as unknown as IWorkspaceArtifactService);
    ix.set(IWorkspaceExecutionService, new SyncDescriptor(WorkspaceExecutionService));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    disposables.dispose();
  });

  it('dispatches to a worker, keeps credentials out of the payload, and ingests artifacts', async () => {
    let request: Request | undefined;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({
        status: 'succeeded',
        output_artifacts: [{
          name: 'metrics.json',
          kind: 'metrics',
          content_base64: Buffer.from('{"accuracy":0.9}').toString('base64'),
          media_type: 'application/json',
          source_artifact_ids: ['artifact_dataset'],
        }],
        metrics: { accuracy: 0.9 },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);

    const input = {
      request_id: 'execution_request',
      run_id: 'run_execution',
      target_id: 'target_customer_worker',
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: {
        dataset_id: 'dataset_sales',
        dataset_artifact_id: 'artifact_dataset',
        steps: [{ config: { model_artifact_id: 'artifact_model' } }],
      },
    } as const;
    const result = await ix.get(IWorkspaceExecutionService).execute(input);

    expect(result).toMatchObject({ status: 'succeeded', output_artifact_ids: ['artifact_remote_metrics'], metrics: { accuracy: 0.9 } });
    expect(request?.headers.get('authorization')).toBe('Bearer worker-secret');
    const body = await request?.clone().text();
    expect(body).not.toContain('worker-secret');
    expect(body).toContain('input_artifacts');
    expect(created[0]).toMatchObject({
      run_id: 'run_execution',
      source_artifact_ids: ['artifact_dataset', 'artifact_model'],
    });

    const reloaded = new WorkspaceExecutionService(
      ix.get(IAtomicDocumentStore),
      ix.get(IWorkspaceContext),
      ix.get(IWorkspaceExecutionTargetService),
      ix.get(IWorkspaceArtifactService),
      ix.get(IPlatformSecretStore),
      ix.get(IWorkspaceCommercialService),
    );
    await expect(reloaded.execute(input)).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects reusing a request id for different remote work', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'failed', error: 'worker rejected' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const service = ix.get(IWorkspaceExecutionService);
    const input = {
      request_id: 'execution_reused',
      run_id: 'run_execution',
      target_id: 'target_customer_worker',
      lease_id: 'lease_customer_worker',
      operation: 'analysis' as const,
      payload: { dataset_id: 'dataset_sales' },
    };
    await service.execute(input);
    await expect(service.execute({ ...input, payload: { dataset_id: 'dataset_other' } }))
      .rejects.toMatchObject({ code: 'execution.request_reused' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects secret-bearing worker payloads before network dispatch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_secret_request',
      run_id: 'run_execution',
      target_id: 'target_customer_worker',
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: { api_key: 'should-not-leave-process' },
    })).rejects.toMatchObject({ code: 'execution.secret_material' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels an in-flight worker request through the execution contract', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      markStarted();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetch);

    const service = ix.get(IWorkspaceExecutionService);
    const input = {
      request_id: 'execution_cancel',
      run_id: 'run_execution',
      target_id: 'target_customer_worker',
      lease_id: 'lease_customer_worker',
      operation: 'analysis' as const,
      payload: { dataset_artifact_id: 'artifact_dataset' },
    };
    const pending = service.execute(input);
    await started;

    await expect(service.cancel(input.request_id)).resolves.toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'execution.worker_request_failed' });
    await expect(service.cancel(input.request_id)).resolves.toBe(false);
  });

  it('retries a transient worker failure with the same idempotent request', async () => {
    let attempts = 0;
    const fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return new Response('temporary outage', { status: 503 });
      return new Response(JSON.stringify({ status: 'succeeded', output_artifacts: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);

    const result = await ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_retry',
      run_id: 'run_execution',
      target_id: 'target_customer_worker',
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: { dataset_artifact_id: 'artifact_dataset' },
    });

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
