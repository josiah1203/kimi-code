/**
 * Scenario: durable model packaging and endpoint lifecycle.
 * Responsibilities: persist local and remote deployments, route serving actions
 * through the execution boundary, and preserve policy/metadata constraints. Real
 * serving persistence is wired with the test container; worker, policy, target,
 * artifact, and ML services are boundary stubs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspaceServingService } from '#/workspace/serving/serving';
import { WorkspaceServingService } from '#/workspace/serving/servingService';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import type { IWorkspaceContext as WorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';

const context: WorkspaceContext = {
  _serviceBrand: undefined,
  workspaceId: 'wd_workspace_serving_0123456789ab',
  cwd: '/tmp/workspace-serving',
  source: 'local',
  meta: { id: 'wd_workspace_serving_0123456789ab', root: '/tmp/workspace-serving', name: 'serving', createdAt: Date.now(), lastOpenedAt: Date.now() },
  persistenceScope: 'workspaces/wd_workspace_serving_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspaceServingService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let policyOutcome: 'allow' | 'approval_required';
  let workerCalls: unknown[];
  let workerFailureAction: string | undefined;
  let releasedLeases: Array<{ readonly targetId: string; readonly leaseId: string; readonly requestId: string }>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    policyOutcome = 'allow';
    workerCalls = [];
    workerFailureAction = undefined;
    releasedLeases = [];
    ix.stub(IWorkspaceContext, context);
    ix.set(IFileSystemStorageService, new SyncDescriptor(InMemoryStorageService));
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.stub(IWorkspacePlatformEventService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: (() => ({ dispose: () => {} })) as never,
      append: async (input: unknown) => input,
      replay: async () => ({ events: [], next_sequence: 0, has_more: false }),
    } as unknown as IWorkspacePlatformEventService);
    ix.stub(IWorkspacePolicyService, {
      _serviceBrand: undefined,
      evaluate: async (input: { capability: 'model' | 'deploy' }) => ({ id: 'policy_serving_test', capability: input.capability, outcome: policyOutcome, state: 'evaluated', reason: 'serving test policy' }),
      get: async () => undefined,
    } as unknown as IWorkspacePolicyService);
    ix.stub(IWorkspaceMlService, {
      _serviceBrand: undefined,
      getModel: async () => ({
        id: 'model_version_sales',
        model_name: 'sales-model',
        version: 1,
        artifact_id: 'artifact_model',
      }),
    } as unknown as IWorkspaceMlService);
    ix.stub(IWorkspaceArtifactService, {
      _serviceBrand: undefined,
      download: async (id: string) => id === 'artifact_model'
        ? { artifact: { media_type: 'application/json' }, content_base64: Buffer.from('{"model":true}').toString('base64') }
        : undefined,
      create: async (input: Record<string, unknown>) => ({
        id: 'artifact_bundle_sales',
        version: 1,
        name: input['name'],
        kind: 'bundle',
      }),
    } as unknown as IWorkspaceArtifactService);
    ix.stub(IWorkspaceExecutionTargetService, {
      _serviceBrand: undefined,
      get: async (id: string) => id === 'target_customer' ? {
        id,
        type: 'customer-managed',
        state: 'ready',
      } : id === 'target_local' ? { id, type: 'local', state: 'ready' } : undefined,
      acquireLease: async () => ({ state: 'active', id: 'lease_serving' }),
      releaseLease: async (targetId: string, leaseId: string, input: { readonly request_id: string }) => {
        releasedLeases.push({ targetId, leaseId, requestId: input.request_id });
        return undefined;
      },
    } as unknown as IWorkspaceExecutionTargetService);
    ix.stub(IWorkspaceExecutionService, {
      _serviceBrand: undefined,
      execute: async (input: unknown) => {
        workerCalls.push(input);
        const action = (input as { readonly payload?: { readonly action?: string } }).payload?.action;
        if (action === workerFailureAction) {
          return { status: 'failed', output_artifact_ids: [], error: `worker rejected ${action}` };
        }
        return { status: 'succeeded', output_artifact_ids: [], metadata: { endpoint_url: 'https://endpoint.example.test/sales' } };
      },
    } as unknown as IWorkspaceExecutionService);
    ix.set(IWorkspaceServingService, new SyncDescriptor(WorkspaceServingService));
  });

  afterEach(() => disposables.dispose());

  it('packages a model, deploys a local endpoint, and reloads lifecycle state', async () => {
    const serving = ix.get(IWorkspaceServingService);
    const packaged = await serving.createPackage({
      request_id: 'package_sales',
      run_id: 'run_package_sales',
      model_version_id: 'model_version_sales',
    });
    expect(packaged).toMatchObject({ state: 'ready', bundle_artifact_id: 'artifact_bundle_sales' });
    const endpoint = await serving.deploy({
      request_id: 'deploy_sales',
      run_id: 'run_deploy_sales',
      name: 'sales-endpoint',
      model_package_id: packaged!.id,
    });
    expect(endpoint).toMatchObject({ state: 'ready', endpoint_url: `local://${endpoint!.id}` });
    await expect(serving.action(endpoint!.id, 'pause', { request_id: 'pause_sales' })).resolves.toMatchObject({ state: 'paused' });
    await expect(serving.action(endpoint!.id, 'resume', { request_id: 'resume_sales' })).resolves.toMatchObject({ state: 'ready' });

    const reloaded = new WorkspaceServingService(
      ix.get(IAtomicDocumentStore),
      context,
      ix.get(IWorkspaceMlService),
      ix.get(IWorkspaceArtifactService),
      ix.get(IWorkspaceExecutionTargetService),
      ix.get(IWorkspaceExecutionService),
      ix.get(IWorkspacePolicyService),
      ix.get(IWorkspacePlatformEventService),
    );
    await expect(reloaded.listPackages()).resolves.toHaveLength(1);
    await expect(reloaded.listEndpoints()).resolves.toHaveLength(1);
    reloaded.dispose();
  });

  it('dispatches customer-managed deployment through the governed worker adapter', async () => {
    const serving = ix.get(IWorkspaceServingService);
    const packaged = await serving.createPackage({ request_id: 'package_remote', model_version_id: 'model_version_sales' });
    const endpoint = await serving.deploy({
      request_id: 'deploy_remote',
      run_id: 'run_deploy_remote',
      name: 'remote-sales-endpoint',
      model_package_id: packaged!.id,
      execution_target_id: 'target_customer',
    });
    expect(endpoint).toMatchObject({ state: 'ready', endpoint_url: 'https://endpoint.example.test/sales' });
    expect(workerCalls[0]).toMatchObject({ operation: 'serving', target_id: 'target_customer' });
  });

  it('dispatches pause and resume actions to a remote serving worker', async () => {
    const serving = ix.get(IWorkspaceServingService);
    const packaged = await serving.createPackage({ request_id: 'package_remote_actions', model_version_id: 'model_version_sales' });
    const endpoint = await serving.deploy({
      request_id: 'deploy_remote_actions',
      run_id: 'run_deploy_remote_actions',
      name: 'remote-actions-endpoint',
      model_package_id: packaged!.id,
      execution_target_id: 'target_customer',
    });

    await expect(serving.action(endpoint!.id, 'pause', { request_id: 'pause_remote_actions' })).resolves.toMatchObject({ state: 'paused' });
    await expect(serving.action(endpoint!.id, 'resume', { request_id: 'resume_remote_actions' })).resolves.toMatchObject({ state: 'ready' });

    expect(workerCalls.map((call) => (call as { readonly payload?: { readonly action?: string } }).payload?.action)).toEqual([
      'deploy',
      'pause',
      'resume',
    ]);
  });

  it('rolls back a newly acquired lease when remote resume fails', async () => {
    const serving = ix.get(IWorkspaceServingService);
    const packaged = await serving.createPackage({ request_id: 'package_remote_resume_failure', model_version_id: 'model_version_sales' });
    const endpoint = await serving.deploy({
      request_id: 'deploy_remote_resume_failure',
      run_id: 'run_deploy_remote_resume_failure',
      name: 'remote-resume-failure-endpoint',
      model_package_id: packaged!.id,
      execution_target_id: 'target_customer',
    });

    await expect(serving.action(endpoint!.id, 'pause', { request_id: 'pause_remote_resume_failure' })).resolves.toMatchObject({
      state: 'paused',
      lease_id: undefined,
    });
    workerFailureAction = 'resume';
    await expect(serving.action(endpoint!.id, 'resume', { request_id: 'resume_remote_resume_failure' }))
      .rejects.toMatchObject({ code: 'serving.target_unavailable' });

    await expect(serving.getEndpoint(endpoint!.id)).resolves.toMatchObject({ state: 'paused', lease_id: undefined });
    expect(releasedLeases.map((release) => release.requestId)).toEqual([
      'pause_remote_resume_failure:lease:release',
      'resume_remote_resume_failure:lease:rollback',
    ]);
  });

  it('persists approval state and rejects sensitive metadata', async () => {
    policyOutcome = 'approval_required';
    const serving = ix.get(IWorkspaceServingService);
    await expect(serving.createPackage({
      request_id: 'package_approval',
      model_version_id: 'model_version_sales',
    })).resolves.toMatchObject({ state: 'awaiting_approval', policy_decision_id: 'policy_serving_test' });
    await expect(serving.createPackage({
      request_id: 'package_secret',
      model_version_id: 'model_version_sales',
      metadata: { api_key: 'do-not-persist' },
    })).rejects.toMatchObject({ code: 'serving.secret_material' });
  });
});
