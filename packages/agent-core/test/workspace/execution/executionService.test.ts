import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { lookup } from 'node:dns/promises';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IPlatformSecretStore } from '#/app/secrets/platformSecretStore';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceBudgetService } from '#/workspace/budgets/budget';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { WorkspaceExecutionService } from '#/workspace/execution/executionService';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspaceSshDaemonService } from '#/workspace/execution/sshDaemon';
import { IWorkspaceUsageService } from '#/workspace/usage/usage';
import type { ExecutionTarget } from '@spiderbyte/protocol';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const lookupMock = lookup as unknown as Mock;

const context = {
  _serviceBrand: undefined,
  workspaceId: 'wd_workspace_execution_0123456789ab',
  cwd: '/tmp/workspace-execution',
  source: 'local' as const,
  meta: { id: 'wd_workspace_execution_0123456789ab', root: '/tmp/workspace-execution', name: 'execution-test', createdAt: Date.now(), lastOpenedAt: Date.now() },
  persistenceScope: 'workspaces/wd_workspace_execution_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspaceExecutionService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let created: Record<string, unknown>[];
  let documents: Map<string, unknown>;
  let executionTarget: ExecutionTarget;
  let sshResponse: unknown;
  let sshCalls: unknown[][];
  let sshWaitForAbort: boolean;
  let appendedEvents: Record<string, unknown>[];

  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    created = [];
    documents = new Map();
    sshResponse = { status: 'succeeded', output_artifacts: [], metrics: { remote: 1 } };
    sshCalls = [];
    sshWaitForAbort = false;
    appendedEvents = [];
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
    executionTarget = {
        id: 'target_customer_worker',
        workspace_id: context.workspaceId,
        name: 'customer worker',
        type: 'customer-managed' as const,
        state: 'ready' as const,
        locality: 'customer-region' as const,
        capabilities: ['analysis'],
        health_status: 'healthy' as const,
        credential_ref: 'secret_worker',
        created_at: '2026-08-09T00:00:00.000Z',
        updated_at: '2026-08-09T00:00:00.000Z',
        metadata: { worker_endpoint: 'https://worker.example.test/execute' },
      };
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      get: async () => executionTarget,
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
      get: async (ref: string) => ref === 'secret_modal'
        ? JSON.stringify({ key: 'modal-key', secret: 'modal-secret' })
        : 'worker-secret',
    });
    ix.stub(IWorkspaceUsageService, {
      _serviceBrand: undefined,
      recordUsage: async (input: Record<string, unknown>) => input,
    } as unknown as IWorkspaceUsageService);
    ix.stub(IWorkspacePlatformEventService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      append: async (input: Record<string, unknown>) => {
        appendedEvents.push(input);
        return input;
      },
      replay: async () => ({ events: [], next_sequence: 0, has_more: false }),
    } as unknown as IWorkspacePlatformEventService);
    ix.stub(IWorkspaceSshDaemonService, {
      _serviceBrand: undefined,
      probe: async () => { throw new Error('SSH probe not expected in HTTP execution tests'); },
      execute: async (...args: Parameters<IWorkspaceSshDaemonService['execute']>) => {
        sshCalls.push([...args]);
        if (sshWaitForAbort) {
          const signal = args[3];
          return await new Promise<Awaited<ReturnType<IWorkspaceSshDaemonService['execute']>>>((resolve, reject) => {
            const abort = () => reject(new Error('SSH daemon command was cancelled'));
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
            void resolve;
          });
        }
        return sshResponse as Awaited<ReturnType<IWorkspaceSshDaemonService['execute']>>;
      },
    });
    ix.stub(IWorkspaceBudgetService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => undefined })) as never,
      reserve: async (input: Record<string, unknown>) => ({
        status: 'unbudgeted',
        warnings: [],
        reservation: {
          id: `reservation_${String(input['request_id'])}`,
          budget_id: 'budget_unbudgeted',
          workspace_id: context.workspaceId,
          run_id: input['run_id'],
          request_id: input['request_id'],
          scope: input['scope'],
          scope_id: input['scope_id'],
          meter: input['meter'],
          unit: input['unit'],
          estimated_amount: input['amount'],
          reserved_amount: 0,
          state: 'reserved',
          created_at: '2026-08-09T00:00:00.000Z',
          updated_at: '2026-08-09T00:00:00.000Z',
        },
      }),
      reconcile: async (input: Record<string, unknown>) => input,
      release: async (input: Record<string, unknown>) => input,
    } as unknown as IWorkspaceBudgetService);
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
      attempt_id: 'attempt_execution',
      project_id: 'project_execution',
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
    expect(body).toContain('"attempt_id":"attempt_execution"');
    expect(created[0]).toMatchObject({
      run_id: 'run_execution',
      metadata: { attempt_id: 'attempt_execution' },
      source_artifact_ids: ['artifact_dataset', 'artifact_model'],
    });

    const reloaded = new WorkspaceExecutionService(
      ix.get(IAtomicDocumentStore),
      ix.get(IWorkspaceContext),
      ix.get(IWorkspaceExecutionTargetService),
      ix.get(IWorkspaceArtifactService),
      ix.get(IPlatformSecretStore),
      ix.get(IWorkspaceUsageService),
      ix.get(IWorkspacePlatformEventService),
      ix.get(IWorkspaceSshDaemonService),
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

  it('dispatches SSH targets through semantic daemon operations and records run audit events', async () => {
    executionTarget = {
      id: 'target_ssh_daemon',
      workspace_id: context.workspaceId,
      name: 'ssh daemon',
      type: 'ssh',
      state: 'ready',
      locality: 'customer-region',
      capabilities: ['execute_analysis'],
      health_status: 'healthy',
      authentication_method: 'ssh_agent',
      ssh: {
        host: 'runner.example.test',
        port: 22,
        user: 'spiderbyte',
        host_key_hash: 'sha256',
        host_key_fingerprint: 'a'.repeat(64),
        remote_root: '/srv/spiderbyte/workspaces/demo',
        connection_timeout_ms: 1_000,
        command_timeout_ms: 2_000,
      },
      created_at: '2026-08-09T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    };
    const input = {
      request_id: 'execution_ssh',
      run_id: 'run_ssh',
      target_id: 'target_ssh_daemon',
      lease_id: 'lease_customer_worker',
      operation: 'analysis' as const,
      payload: {
        workspace_id: context.workspaceId,
        working_directory: 'datasets',
      },
    };
    await expect(ix.get(IWorkspaceExecutionService).execute(input)).resolves.toMatchObject({
      status: 'succeeded',
      metrics: { remote: 1 },
    });
    expect(sshCalls).toHaveLength(1);
    expect(sshCalls[0]?.[0]).toMatchObject({ id: 'target_ssh_daemon', type: 'ssh' });
    expect(sshCalls[0]?.[1]).toBe(context.workspaceId);
    expect(sshCalls[0]?.[2]).toMatchObject({ operation: 'analysis', request_id: 'execution_ssh' });
    expect(appendedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'run.updated', entity_id: 'run_ssh' }),
      expect.objectContaining({ event_type: 'run.completed', entity_id: 'run_ssh' }),
    ]));
    expect(JSON.stringify(appendedEvents)).not.toContain('secret_');
  });

  it('cancels an in-flight SSH daemon operation and records the failed run event', async () => {
    sshWaitForAbort = true;
    executionTarget = {
      id: 'target_ssh_cancel',
      workspace_id: context.workspaceId,
      name: 'ssh cancel',
      type: 'ssh',
      state: 'ready',
      locality: 'customer-region',
      capabilities: ['execute_analysis'],
      health_status: 'healthy',
      authentication_method: 'ssh_agent',
      ssh: {
        host: 'runner.example.test',
        port: 22,
        user: 'spiderbyte',
        host_key_hash: 'sha256',
        host_key_fingerprint: 'a'.repeat(64),
        remote_root: '/srv/spiderbyte/workspaces/demo',
        connection_timeout_ms: 1_000,
        command_timeout_ms: 2_000,
      },
      created_at: '2026-08-09T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    };
    const service = ix.get(IWorkspaceExecutionService);
    const pending = service.execute({
      request_id: 'execution_ssh_cancel',
      run_id: 'run_ssh_cancel',
      target_id: 'target_ssh_cancel',
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: { workspace_id: context.workspaceId },
    });
    await vi.waitFor(() => expect(sshCalls).toHaveLength(1));
    await expect(service.cancel('execution_ssh_cancel')).resolves.toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'execution.worker_request_failed' });
    expect(appendedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'run.failed', entity_id: 'run_ssh_cancel', state: 'failed' }),
    ]));
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

  it('rejects an oversized worker response before materializing the full body', async () => {
    let pulls = 0;
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulls >= 17) controller.close();
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_oversized_response',
      run_id: 'run_execution',
      target_id: 'target_customer_worker',
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: {},
    })).rejects.toMatchObject({ code: 'execution.worker_invalid_response' });
    expect(pulls).toBeLessThanOrEqual(17);
  });

  it('uses Modal key and secret headers from an opaque credential without exposing them in the payload', async () => {
    executionTarget = {
      ...executionTarget,
      type: 'customer-managed',
      credential_ref: 'secret_modal',
      metadata: { provider: 'modal', worker_endpoint: 'https://modal.example.test/execute' },
    };
    let request: Request | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ status: 'succeeded', output_artifacts: [] }), { status: 200 });
    }));

    await ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_modal',
      run_id: 'run_execution',
      target_id: executionTarget.id,
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: { dataset_id: 'dataset_sales' },
    });

    expect(request?.headers.get('Modal-Key')).toBe('modal-key');
    expect(request?.headers.get('Modal-Secret')).toBe('modal-secret');
    expect(request?.headers.get('authorization')).toBeNull();
    const body = await request?.clone().text();
    expect(body).not.toContain('modal-key');
    expect(body).not.toContain('modal-secret');
  });

  it('rejects private endpoints for managed targets before dispatch', async () => {
    executionTarget = {
      ...executionTarget,
      type: 'customer-managed',
      metadata: { provider: 'modal', worker_endpoint: 'https://127.0.0.1/execute' },
    };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_private_managed',
      run_id: 'run_execution',
      target_id: executionTarget.id,
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: {},
    })).rejects.toMatchObject({ code: 'execution.target_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects localhost aliases before dispatch', async () => {
    executionTarget = {
      ...executionTarget,
      type: 'customer-managed',
      metadata: { provider: 'modal', worker_endpoint: 'https://localhost/execute' },
    };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_localhost_worker',
      run_id: 'run_execution',
      target_id: executionTarget.id,
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: { dataset_id: 'dataset_1' },
    })).rejects.toMatchObject({ code: 'execution.target_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dispatches explicitly configured private gateways while blocking loopback', async () => {
    executionTarget = {
      ...executionTarget,
      type: 'private-gateway',
      metadata: { worker_endpoint: 'https://10.20.0.5/execute' },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'succeeded', output_artifacts: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_private_gateway',
      run_id: 'run_execution',
      target_id: executionTarget.id,
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: {},
    })).resolves.toMatchObject({ status: 'succeeded' });
    expect(fetch).toHaveBeenCalledWith('https://10.20.0.5/execute', expect.anything());

    executionTarget = {
      ...executionTarget,
      metadata: { worker_endpoint: 'https://127.0.0.1/execute' },
    };
    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_private_gateway_loopback',
      run_id: 'run_execution',
      target_id: executionTarget.id,
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: {},
    })).rejects.toMatchObject({ code: 'execution.target_unavailable' });
  });

  it('rejects credential-bearing legacy worker endpoints before dispatch', async () => {
    executionTarget = {
      ...executionTarget,
      metadata: { worker_endpoint: 'https://worker.example.test/execute?api_key=leak' },
    };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(ix.get(IWorkspaceExecutionService).execute({
      request_id: 'execution_credential_endpoint',
      run_id: 'run_execution',
      target_id: executionTarget.id,
      lease_id: 'lease_customer_worker',
      operation: 'analysis',
      payload: {},
    })).rejects.toMatchObject({ code: 'execution.target_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
