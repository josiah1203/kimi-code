import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { lookup } from 'node:dns/promises';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import type { ServiceIdentifier, ServicesAccessor } from '#/_base/di/instantiation';
import { type IAgentScopeHandle, type ISessionScopeHandle } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { AppendLogStore } from '#/persistence/backends/node-fs/appendLogStore';
import { BlobStoreService } from '#/persistence/backends/node-fs/blobStoreService';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IBlobStore } from '#/persistence/interface/blobStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { WorkspacePlatformEventService } from '#/workspace/platformEvents/platformEventService';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { WorkspacePolicyService } from '#/workspace/policy/policyService';
import { IWorkspaceResourceService } from '#/workspace/resources/resource';
import { WorkspaceResourceService } from '#/workspace/resources/resourceService';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { WorkspaceArtifactService } from '#/workspace/artifacts/artifactService';
import { IWorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTarget';
import { WorkspaceExecutionTargetService } from '#/workspace/executionTargets/executionTargetService';
import { IWorkspaceExecutionService } from '#/workspace/execution/execution';
import { IWorkspaceSshDaemonService } from '#/workspace/execution/sshDaemon';
import { IWorkspaceMlService } from '#/workspace/ml/ml';
import { IWorkspaceAutomationService } from '#/workspace/automations/automation';
import { WorkspaceAutomationService } from '#/workspace/automations/automationService';
import { IWorkspacePipelineService } from '#/workspace/pipelines/pipeline';
import { WorkspacePipelineService } from '#/workspace/pipelines/pipelineService';
import { ISessionRunService } from '#/session/run/run';
import { ISessionLifecycleService, type ISessionLifecycleService as SessionLifecycleService } from '#/workspace/sessionLifecycle/sessionLifecycle';
import { IWorkspaceUsageService } from '#/workspace/usage/usage';
import { WorkspaceUsageService } from '#/workspace/usage/usageService';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import type { IWorkspaceContext as WorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const lookupMock = lookup as unknown as Mock;

function makeAccessor(
  entries: ReadonlyArray<readonly [ServiceIdentifier<unknown>, unknown]>,
): ServicesAccessor {
  return {
    get<T>(id: ServiceIdentifier<T>): T {
      for (const [key, value] of entries) {
        if (key === id) return value as T;
      }
      throw new Error(`unexpected service request: ${String(id)}`);
    },
  };
}

const context: WorkspaceContext = {
  _serviceBrand: undefined,
  workspaceId: 'wd_platform_services_0123456789ab',
  cwd: '/tmp/workspace-platform',
  source: 'local',
  meta: {
    id: 'wd_platform_services_0123456789ab',
    root: '/tmp/workspace-platform',
    name: 'platform',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  },
  persistenceScope: 'workspaces/wd_platform_services_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('workspace platform services', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let sshProbeRequestId: string | undefined;

  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    sshProbeRequestId = undefined;
    ix.stub(IWorkspaceContext, context);
    ix.set(IFileSystemStorageService, new SyncDescriptor(InMemoryStorageService));
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    ix.set(IBlobStore, new SyncDescriptor(BlobStoreService));
    ix.set(IWorkspacePlatformEventService, new SyncDescriptor(WorkspacePlatformEventService));
    ix.stub(IWorkspaceSshDaemonService, {
      _serviceBrand: undefined,
      probe: async (
        target: { id: string },
        workspaceId: string,
        options: { readonly requestId: string },
      ) => {
        sshProbeRequestId = options.requestId;
        return {
        target_id: target.id,
        workspace_id: workspaceId,
        status: 'healthy' as const,
        checked_at: '2026-08-09T00:00:00.000Z',
        message: 'SSH daemon probe passed',
        capabilities: ['execute_analysis', 'train_model'],
        version_compatibility: {
          required_protocol_version: 1,
          observed_protocol_version: 1,
          compatible: true,
        },
        };
      },
      execute: async () => { throw new Error('SSH execution not expected in target tests'); },
    });
    ix.set(IWorkspacePolicyService, new SyncDescriptor(WorkspacePolicyService));
    ix.set(IWorkspaceResourceService, new SyncDescriptor(WorkspaceResourceService));
    ix.set(IWorkspaceArtifactService, new SyncDescriptor(WorkspaceArtifactService));
    ix.set(IWorkspaceExecutionTargetService, new SyncDescriptor(WorkspaceExecutionTargetService));
    ix.set(IWorkspaceAutomationService, new SyncDescriptor(WorkspaceAutomationService));
    ix.stub(IWorkspaceMlService, {
      _serviceBrand: undefined,
      analyze: async () => ({
        id: 'analysis_pipeline_automation',
        workspace_id: context.workspaceId,
        run_id: 'run_pipeline_automation',
        dataset_id: 'dataset_pipeline_automation',
        dataset_version: 1,
        dataset_artifact_id: 'artifact_pipeline_dataset',
        kind: 'summary' as const,
        row_count: 0,
        column_count: 0,
        report_artifact_id: 'artifact_pipeline_report',
        visualization_artifact_ids: [],
        input_digest: 'a'.repeat(64),
        created_at: '2026-08-09T00:00:00.000Z',
      }),
    } as unknown as IWorkspaceMlService);
    ix.stub(IWorkspaceExecutionService, {
      _serviceBrand: undefined,
    } as unknown as IWorkspaceExecutionService);
    ix.set(IWorkspacePipelineService, new SyncDescriptor(WorkspacePipelineService));
    ix.set(IWorkspaceUsageService, new SyncDescriptor(WorkspaceUsageService));

    const prompt = {
      enqueue: async () => ({
        id: 'prompt_automation',
        runId: 'run_automation',
      }),
    } as unknown as IAgentPromptService;
    const sessionRuns = {
      create: async () => ({ id: 'run_pipeline_automation', status: 'queued' }),
      transition: async (_id: string, input: { status: string }) => ({ id: 'run_pipeline_automation', status: input.status }),
    } as unknown as ISessionRunService;
    const agent: IAgentScopeHandle = {
      id: 'main',
      kind: LifecycleScope.Agent,
      accessor: makeAccessor([[IAgentPromptService, prompt], [ISessionRunService, sessionRuns]]),
      dispose: () => {},
    };
    const agents = {
      create: async () => agent,
    } as unknown as IAgentLifecycleService;
    const session: ISessionScopeHandle = {
      id: 'session_automation',
      kind: LifecycleScope.Session,
      accessor: makeAccessor([[IAgentLifecycleService, agents]]),
      dispose: () => {},
    };
    const sessions = {
      _serviceBrand: undefined,
      onDidCreateSession: () => ({ dispose: () => {} }),
      onDidCloseSession: () => ({ dispose: () => {} }),
      onDidArchiveSession: () => ({ dispose: () => {} }),
      onDidForkSession: () => ({ dispose: () => {} }),
      create: async () => session,
      get: () => undefined,
      list: () => [],
      resume: async () => undefined,
      close: async () => {},
      archive: async () => {},
      restore: async () => undefined,
      delete: async () => {},
      fork: async () => session,
      createChild: async () => session,
    } as unknown as SessionLifecycleService;
    ix.stub(ISessionLifecycleService, sessions);
  });

  afterEach(() => { disposables.dispose(); });

  it('governs native resources and persists content-addressed artifact lineage', async () => {
    const resources = ix.get(IWorkspaceResourceService);
    const resource = await resources.create({
      request_id: 'resource_create',
      type: 'dataset',
      name: 'training-data',
    });
    const execution = await resources.execute(resource.id, {
      request_id: 'resource_execute',
      action: 'read:private',
      run_id: 'run_resource',
    });
    expect(execution.status).toBe('awaiting_approval');
    expect(execution.policy_decision_id).toBeDefined();
    const decision = await ix.get(IWorkspacePolicyService).approve(execution.policy_decision_id!, {
      request_id: 'resource_policy_approve',
      decided_by: 'user',
    });
    expect(decision?.state).toBe('approved');
    const resumed = await resources.execute(resource.id, {
      request_id: 'resource_execute_after_approval',
      action: 'read:private',
      run_id: 'run_resource',
      policy_decision_id: execution.policy_decision_id,
    });
    expect(resumed.status).toBe('completed');

    const artifacts = ix.get(IWorkspaceArtifactService);
    const source = await artifacts.create({
      request_id: 'artifact_source',
      name: 'source.csv',
      kind: 'dataset',
      content_base64: Buffer.from('a,b\n1,2\n').toString('base64'),
      run_id: 'run_resource',
    });
    const derived = await artifacts.create({
      request_id: 'artifact_derived',
      name: 'features.csv',
      kind: 'table',
      content_base64: Buffer.from('feature\n1\n').toString('base64'),
      source_artifact_ids: [source.id],
    });
    await expect(artifacts.download(derived.id)).resolves.toMatchObject({
      artifact: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      content_base64: Buffer.from('feature\n1\n').toString('base64'),
    });
    await expect(artifacts.downloadRange(source.id, { start: 2, end: 4 })).resolves.toMatchObject({
      start: 2,
      end: 4,
      total_bytes: Buffer.byteLength('a,b\n1,2\n'),
      content_base64: Buffer.from('b\n1').toString('base64'),
      complete: false,
    });
    await expect(artifacts.lineage(source.id)).resolves.toMatchObject({
      downstream_artifacts: [{ id: derived.id }],
    });
  });

  it('rejects malformed content, expired artifacts, and corrupted blobs', async () => {
    const artifacts = ix.get(IWorkspaceArtifactService);
    await expect(
      artifacts.create({
        request_id: 'artifact_invalid_base64',
        name: 'invalid.bin',
        kind: 'file',
        content_base64: 'not base64!',
      }),
    ).rejects.toMatchObject({ code: 'artifact.invalid_content' });

    const expired = await artifacts.create({
      request_id: 'artifact_expired',
      name: 'expired.bin',
      kind: 'file',
      content_base64: Buffer.from('expired').toString('base64'),
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    await expect(artifacts.download(expired.id)).rejects.toMatchObject({ code: 'artifact.expired' });

    const intact = await artifacts.create({
      request_id: 'artifact_corrupted',
      name: 'corrupted.bin',
      kind: 'file',
      content_base64: Buffer.from('intact').toString('base64'),
    });
    await ix.get(IBlobStore).put(
      `${context.persistenceScope}/platform/artifacts`,
      `sha256/${intact.sha256}`,
      Buffer.from('tampered'),
    );
    await expect(artifacts.download(intact.id)).rejects.toMatchObject({ code: 'artifact.invalid_content' });
  });

  it('leases execution targets, schedules approval-gated automations, and exposes local usage meters', async () => {
    const targets = ix.get(IWorkspaceExecutionTargetService);
    const target = await targets.register({
      request_id: 'target_register',
      name: 'local-runner',
      type: 'local',
      locality: 'local',
      capabilities: ['python'],
    });
    await targets.test(target.id, { request_id: 'target_health' });
    await targets.markReady(target.id, { request_id: 'target_ready' });
    const lease = await targets.acquireLease(target.id, {
      request_id: 'target_lease',
      run_id: 'run_target',
      duration_seconds: 60,
    });
    expect(lease.state).toBe('active');
    await expect(targets.releaseLease(target.id, lease.id, { request_id: 'target_release' })).resolves.toMatchObject({
      state: 'released',
    });
    const restartedTargets = disposables.add(ix.createInstance(WorkspaceExecutionTargetService));
    await restartedTargets.ready;
    await expect(restartedTargets.get(target.id)).resolves.toMatchObject({
      id: target.id,
      state: 'ready',
      capabilities: ['python'],
    });

    const remoteTarget = await targets.register({
      request_id: 'target_remote_register',
      name: 'customer-runner',
      type: 'ssh',
      locality: 'customer-region',
      capabilities: ['python'],
      endpoint: 'ssh://customer-runner.example',
      authentication_method: 'ssh_agent',
      ssh: {
        host: 'customer-runner.example',
        user: 'runner',
        host_key_hash: 'sha256',
        host_key_fingerprint: 'b'.repeat(64),
        remote_root: '/srv/spiderbyte/workspace',
      },
    });
    await targets.test(remoteTarget.id, { request_id: 'target_remote_health' });
    await targets.markReady(remoteTarget.id, { request_id: 'target_remote_ready' });
    const pendingLease = await targets.acquireLease(remoteTarget.id, {
      request_id: 'target_remote_lease',
      run_id: 'run_remote',
      duration_seconds: 60,
    });
    expect(pendingLease.state).toBe('awaiting_approval');
    await expect(ix.get(IWorkspacePolicyService).approve(pendingLease.policy_decision_id!, {
      request_id: 'target_remote_policy_approve',
      decided_by: 'user',
    })).resolves.toMatchObject({ state: 'approved' });
    await expect(targets.acquireLease(remoteTarget.id, {
      request_id: 'target_remote_lease_approved',
      run_id: 'run_remote',
      duration_seconds: 60,
      policy_decision_id: pendingLease.policy_decision_id,
    })).resolves.toMatchObject({ state: 'active', policy_decision_id: pendingLease.policy_decision_id });

    const automations = ix.get(IWorkspaceAutomationService);
    const automation = await automations.create({
      request_id: 'automation_create',
      name: 'nightly-evaluation',
      trigger: 'cron',
      schedule: '0 2 * * *',
      prompt: 'Run the evaluation pipeline.',
      approval_required: true,
    });
    await expect(automations.fire(automation.id, { request_id: 'automation_fire' })).resolves.toMatchObject({
      status: 'awaiting_approval',
      attempt: 1,
    });
    await ix.get(IWorkspacePolicyService).setRules({
      request_id: 'automation_allow_cloud',
      rules: [{
        capability: 'cloud',
        effect: 'allow',
        reason: 'automation linkage test policy',
      }, {
        capability: 'model',
        effect: 'allow',
        reason: 'pipeline automation test policy',
      }],
    });
    const linked = await automations.create({
      request_id: 'automation_linked_create',
      name: 'linked-evaluation',
      trigger: 'event',
      prompt: 'Run the linked evaluation.',
      approval_required: false,
    });
    await expect(automations.fire(linked.id, { request_id: 'automation_linked_fire' })).resolves.toMatchObject({
      status: 'queued',
      run_id: 'run_automation',
    });
    const pipeline = await ix.get(IWorkspacePipelineService).create({
      request_id: 'pipeline_automation_create',
      name: 'pipeline automation',
      steps: [{
        id: 'profile',
        name: 'Profile dataset',
        kind: 'analysis',
        config: { dataset_id: 'dataset_pipeline_automation' },
      }],
    });
    const pipelineAutomation = await automations.create({
      request_id: 'automation_pipeline_create',
      name: 'linked-pipeline',
      trigger: 'event',
      pipeline_id: pipeline.id,
      prompt: 'Run the native pipeline.',
      approval_required: false,
    });
    const pipelineFire = await automations.fire(pipelineAutomation.id, { request_id: 'automation_pipeline_fire' });
    expect(pipelineFire).toMatchObject({
      status: 'succeeded',
      run_id: 'run_pipeline_automation',
    });
    expect(pipelineFire.pipeline_run_id).toMatch(/^pipeline_run_/);
    await expect(ix.get(IWorkspacePipelineService).listRuns(pipeline.id)).resolves.toMatchObject([{
      id: pipelineFire.pipeline_run_id,
      pipeline_id: pipeline.id,
      run_id: 'run_pipeline_automation',
      status: 'succeeded',
    }]);
    await expect(automations.fire(pipelineAutomation.id, { request_id: 'automation_pipeline_fire' })).resolves.toEqual(pipelineFire);
    const restartedAutomation = ix.createInstance(
      new SyncDescriptor<WorkspaceAutomationService>(WorkspaceAutomationService),
    ) as unknown as WorkspaceAutomationService;
    disposables.add(restartedAutomation);
    await restartedAutomation.ready;
    await expect(restartedAutomation.history(pipelineAutomation.id)).resolves.toMatchObject([{
      request_id: 'automation_pipeline_fire',
      status: 'succeeded',
      pipeline_run_id: pipelineFire.pipeline_run_id,
    }]);
    const restartedPipeline = disposables.add(ix.createInstance(WorkspacePipelineService));
    await restartedPipeline.ready;
    await expect(restartedPipeline.getRun(pipelineFire.pipeline_run_id!)).resolves.toMatchObject({
      status: 'succeeded',
      pipeline_id: pipeline.id,
    });
    const recurring = await automations.create({
      request_id: 'automation_recurring_create',
      name: 'every-minute-evaluation',
      trigger: 'cron',
      schedule: '* * * * *',
      prompt: 'Run the recurring evaluation pipeline.',
      approval_required: true,
    });
    expect(recurring.next_run_at).toBeDefined();
    await expect(
      automations.fireDue(new Date(Date.parse(recurring.next_run_at!) + 1)),
    ).resolves.toMatchObject([{ automation_id: recurring.id, status: 'awaiting_approval' }]);
    await expect(
      automations.fireDue(new Date(Date.parse(recurring.next_run_at!) + 1)),
    ).resolves.toEqual([]);
    await expect(automations.history(automation.id)).resolves.toMatchObject([
      { automation_id: automation.id, status: 'awaiting_approval' },
    ]);

    const usage = ix.get(IWorkspaceUsageService);
    await expect(
      usage.recordUsage({
        request_id: 'workspace_usage_intelligence',
        actor_id: 'local-owner',
        run_id: 'run_target',
        meter: 'intelligence',
        unit: 'intelligence_percent',
        amount: 3.5,
        metadata: { provider: 'example-provider' },
      }),
    ).resolves.toMatchObject({ meter: 'intelligence', amount: 3.5 });
    await expect(usage.usageSummary()).resolves.toMatchObject({
      intelligence_percent: 3.5,
      record_count: 1,
    });
    await usage.recordUsage({
      request_id: 'workspace_usage_model',
      actor_id: 'local-owner',
      run_id: 'run_target',
      meter: 'model',
      unit: 'units',
      amount: 4,
      source: 'local',
    });
    await usage.recordUsage({
      request_id: 'workspace_usage_execution',
      actor_id: 'local-owner',
      run_id: 'run_target',
      meter: 'execution',
      unit: 'seconds',
      amount: 2,
      source: 'local',
    });
    await expect(usage.usageSummary()).resolves.toMatchObject({
      model_units: 4,
      execution_seconds: 2,
      record_count: 3,
    });
  });

  it('durably expires leases and does not let a late release clear a newer lease', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-09T00:00:00.000Z') });
    try {
      const targets = ix.get(IWorkspaceExecutionTargetService);
      const target = await targets.register({
        request_id: 'lease_expiry_register',
        name: 'lease-expiry-target',
        type: 'local',
        locality: 'local',
      });
      await targets.test(target.id, { request_id: 'lease_expiry_test' });
      await targets.markReady(target.id, { request_id: 'lease_expiry_ready' });
      const first = await targets.acquireLease(target.id, {
        request_id: 'lease_expiry_first',
        duration_seconds: 1,
      });

      vi.setSystemTime(new Date('2026-08-09T00:00:01.001Z'));
      await expect(targets.getLease(target.id, first.id)).resolves.toMatchObject({ state: 'expired' });
      await expect(targets.get(target.id)).resolves.toMatchObject({ lease_ref: undefined });

      const second = await targets.acquireLease(target.id, {
        request_id: 'lease_expiry_second',
        duration_seconds: 60,
      });
      await expect(targets.releaseLease(target.id, first.id, {
        request_id: 'lease_expiry_late_release',
      })).resolves.toMatchObject({ state: 'expired' });
      await expect(targets.get(target.id)).resolves.toMatchObject({ lease_ref: second.lease_ref });
      await expect(ix.get(IWorkspacePlatformEventService).replay()).resolves.toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            event_type: 'execution_target.lease_expired',
            entity_id: target.id,
          }),
        ]),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses readiness for targets without a healthy validation result', async () => {
    const targets = ix.get(IWorkspaceExecutionTargetService);
    const target = await targets.register({
      request_id: 'readiness_gate_register',
      name: 'readiness-gate-docker',
      type: 'docker',
      locality: 'customer-region',
    });

    await expect(targets.markReady(target.id, { request_id: 'readiness_gate_ready_before_test' }))
      .rejects.toMatchObject({ code: 'execution_target.not_validated' });
    await expect(targets.test(target.id, { request_id: 'readiness_gate_test' })).resolves.toMatchObject({
      status: 'adapter-dependent',
    });
    await expect(targets.markReady(target.id, { request_id: 'readiness_gate_ready_after_test' }))
      .rejects.toMatchObject({ code: 'execution_target.not_validated' });
    await expect(targets.update(target.id, {
      request_id: 'readiness_gate_update_ready',
      state: 'ready',
    })).rejects.toMatchObject({ code: 'execution_target.not_validated' });
  });

  it('bounds remote health responses before parsing them', async () => {
    const targets = ix.get(IWorkspaceExecutionTargetService);
    const target = await targets.register({
      request_id: 'health_size_register',
      name: 'health-size-worker',
      type: 'customer-managed',
      locality: 'customer-region',
      endpoint: 'https://worker.example/v1/execute',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(65 * 1024), { status: 200 })));
    try {
      await expect(targets.test(target.id, { request_id: 'health_size_test' })).resolves.toMatchObject({
        status: 'unhealthy',
        message: 'execution target health response is too large',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tests target health, persists discovered capabilities, reports adapter gaps, and revokes targets', async () => {
    const targets = ix.get(IWorkspaceExecutionTargetService);
    const local = await targets.register({
      request_id: 'connection_local_register',
      name: 'local-connection',
      type: 'local',
      locality: 'local',
      capabilities: ['analysis'],
    });
    await expect(targets.test(local.id, { request_id: 'connection_local_test' })).resolves.toMatchObject({
      target_id: local.id,
      workspace_id: context.workspaceId,
      status: 'healthy',
      capabilities: ['analysis'],
    });
    await targets.markReady(local.id, { request_id: 'connection_local_ready' });
    const localLease = await targets.acquireLease(local.id, {
      request_id: 'connection_local_lease',
      duration_seconds: 60,
    });
    await expect(targets.revoke(local.id, { request_id: 'connection_local_revoke' })).resolves.toMatchObject({
      state: 'disabled',
      lease_ref: undefined,
    });
    await expect(targets.getLease(local.id, localLease.id)).resolves.toMatchObject({ state: 'released' });

    const remote = await targets.register({
      request_id: 'connection_remote_register',
      name: 'remote-connection',
      type: 'customer-managed',
      locality: 'customer-region',
      endpoint: 'https://worker.example/v1/execute',
      version_compatibility: { required_protocol_version: 1 },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'ready',
      protocol_version: 1,
      capabilities: ['analysis', 'training'],
      models: ['local-model'],
      providers: ['customer-runtime'],
      resources: { cpu_cores: 4, memory_bytes: 8_192, gpu_count: 1, gpu_models: ['test-gpu'] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(targets.test(remote.id, {
        request_id: 'connection_remote_test',
        timeout_ms: 1_000,
      })).resolves.toMatchObject({
        target_id: remote.id,
        status: 'healthy',
        capabilities: ['analysis', 'training'],
        available_models: ['local-model'],
        available_providers: ['customer-runtime'],
        version_compatibility: {
          required_protocol_version: 1,
          observed_protocol_version: 1,
          compatible: true,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/health', expect.objectContaining({
      method: 'GET',
      redirect: 'error',
    }));
    await expect(targets.get(remote.id)).resolves.toMatchObject({
      health_status: 'healthy',
      last_health_check_at: expect.any(String),
      resources: { cpu_cores: 4, gpu_count: 1 },
    });
    await targets.markReady(remote.id, { request_id: 'connection_remote_ready' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'unavailable' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    try {
      await expect(targets.test(remote.id, {
        request_id: 'connection_remote_unhealthy_test',
        timeout_ms: 1_000,
      })).resolves.toMatchObject({ status: 'unhealthy' });
    } finally {
      vi.unstubAllGlobals();
    }
    await expect(targets.get(remote.id)).resolves.toMatchObject({
      state: 'draining',
      health_status: 'unhealthy',
    });

    const ssh = await targets.register({
      request_id: 'connection_ssh_register',
      name: 'ssh-connection',
      type: 'ssh',
      locality: 'customer-region',
      endpoint: 'ssh://host.example',
      authentication_method: 'ssh_agent',
      ssh: {
        host: 'host.example',
        user: 'runner',
        host_key_hash: 'sha256',
        host_key_fingerprint: 'a'.repeat(64),
        remote_root: '/srv/spiderbyte/workspace',
      },
    });
    await expect(targets.test(ssh.id, { request_id: 'connection_ssh_test' })).resolves.toMatchObject({
      status: 'healthy',
      capabilities: ['execute_analysis', 'train_model'],
    });
    expect(sshProbeRequestId).toBe('connection_ssh_test');

    await expect(targets.register({
      request_id: 'connection_bad_endpoint',
      name: 'bad-endpoint',
      type: 'customer-managed',
      locality: 'customer-region',
      endpoint: 'https://user:password@worker.example',
    })).rejects.toMatchObject({ code: 'execution_target.endpoint_invalid' });
    await expect(targets.register({
      request_id: 'connection_private_customer_worker',
      name: 'private-customer-worker',
      type: 'customer-managed',
      locality: 'customer-region',
      endpoint: 'https://10.20.0.5/v1/execute',
    })).rejects.toMatchObject({ code: 'execution_target.endpoint_invalid' });
    await expect(targets.register({
      request_id: 'connection_localhost_customer_worker',
      name: 'localhost-customer-worker',
      type: 'customer-managed',
      locality: 'customer-region',
      endpoint: 'https://localhost/v1/execute',
    })).rejects.toMatchObject({ code: 'execution_target.endpoint_invalid' });

    await expect(targets.revoke(remote.id, { request_id: 'connection_remote_revoke' })).resolves.toMatchObject({
      state: 'disabled',
    });
    await expect(targets.test(remote.id, { request_id: 'connection_remote_test_after_revoke' })).resolves.toMatchObject({
      status: 'unavailable',
    });
    await expect(ix.get(IWorkspacePlatformEventService).replay()).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ event_type: 'execution_target.validated', entity_id: remote.id }),
        expect.objectContaining({ event_type: 'execution_target.revoked', entity_id: remote.id }),
      ]),
    });
  });

  it('keeps the durable Run linked when an automation pipeline launch fails', async () => {
    const failingPipeline = {
      get: async () => ({ id: 'pipeline_archived', state: 'ready' }),
      run: async () => {
        throw new Error('pipeline worker unavailable');
      },
    } as unknown as IWorkspacePipelineService;
    const automations = disposables.add(new WorkspaceAutomationService(
      ix.get(IAtomicDocumentStore),
      context,
      ix.get(IWorkspacePolicyService),
      ix.get(ISessionLifecycleService),
      ix.get(IWorkspacePlatformEventService),
      ix,
      failingPipeline,
      ix.get(IWorkspaceArtifactService),
    ));
    const automation = await automations.create({
      request_id: 'automation_failed_pipeline_create',
      name: 'failed-pipeline-launch',
      trigger: 'event',
      pipeline_id: 'pipeline_archived',
      prompt: 'Run the unavailable pipeline.',
      approval_required: false,
    });
    await ix.get(IWorkspacePolicyService).setRules({
      request_id: 'automation_failed_pipeline_policy',
      rules: [{ capability: 'cloud', effect: 'allow', reason: 'test' }],
    });
    const fire = await automations.fire(automation.id, { request_id: 'automation_failed_pipeline_fire' });
    expect(fire).toMatchObject({
      status: 'failed',
      run_id: 'run_pipeline_automation',
      error: 'pipeline worker unavailable',
    });
    await expect(automations.get(automation.id)).resolves.toMatchObject({ last_run_id: 'run_pipeline_automation' });
  });

  it('replays platform events after a durable sequence cursor', async () => {
    const events = ix.get(IWorkspacePlatformEventService);
    await events.append({
      event_type: 'workspace.updated',
      entity_type: 'workspace',
      entity_id: context.workspaceId,
      actor: 'system',
    });
    await events.append({
      event_type: 'workspace.updated',
      entity_type: 'workspace',
      entity_id: context.workspaceId,
      actor: 'system',
    });
    const replay = await events.replay();
    expect(replay.events[0]).toMatchObject({
      previous_event_hash: expect.stringMatching(/^0{64}$/),
      event_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(replay.events[1]).toMatchObject({
      previous_event_hash: replay.events[0]?.event_hash,
      event_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(events.replay(1, 1)).resolves.toMatchObject({
      events: [{ sequence: 2 }],
      next_sequence: 2,
      has_more: false,
    });
  });
});
