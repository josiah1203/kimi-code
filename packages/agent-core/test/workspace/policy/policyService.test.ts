import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore, toDisposable } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { WorkspacePolicyService } from '#/workspace/policy/policyService';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import type { IWorkspaceContext as WorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';

const context: WorkspaceContext = {
  _serviceBrand: undefined,
  workspaceId: 'wd_workspace_0123456789ab',
  cwd: '/tmp/workspace',
  source: 'local',
  meta: {
    id: 'wd_workspace_0123456789ab',
    root: '/tmp/workspace',
    name: 'example',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  },
  persistenceScope: 'workspaces/wd_workspace_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspacePolicyService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IWorkspaceContext, context);
    ix.set(IFileSystemStorageService, new SyncDescriptor(InMemoryStorageService));
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.stub(IWorkspacePlatformEventService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: () => toDisposable(() => {}),
      append: async (input) => ({
        ...input,
        event_id: 'event_test',
        workspace_id: context.workspaceId,
        sequence: 0,
        occurred_at: new Date().toISOString(),
      }),
      replay: async () => ({ events: [], next_sequence: 0, has_more: false }),
    });
    ix.set(IWorkspacePolicyService, new SyncDescriptor(WorkspacePolicyService));
  });

  afterEach(() => disposables.dispose());

  it('evaluates a sensitive capability, resolves it, audits it, and explains it', async () => {
    const service = ix.get(IWorkspacePolicyService);
    const evaluated = await service.evaluate({
      request_id: 'request_policy_evaluate',
      run_id: 'run_01',
      capability: 'deploy',
      action: 'production:deploy',
      requested_by: 'agent',
    });

    expect(evaluated).toMatchObject({
      workspace_id: context.workspaceId,
      state: 'evaluated',
      outcome: 'approval_required',
    });
    await expect(
      service.evaluate({
        request_id: 'request_policy_evaluate',
        run_id: 'run_01',
        capability: 'deploy',
        action: 'production:deploy',
        requested_by: 'agent',
      }),
    ).resolves.toMatchObject({ id: evaluated.id });

    const approved = await service.approve(evaluated.id, {
      request_id: 'request_policy_approve',
      decided_by: 'user',
      reason: 'Release manager approved the production deployment.',
    });
    expect(approved).toMatchObject({ state: 'approved', outcome: 'allow' });

    const audited = await service.audit(evaluated.id, {
      request_id: 'request_policy_audit',
      audit_ref: 'audit_01',
    });
    expect(audited).toMatchObject({ state: 'audited', audit_ref: 'audit_01' });
    await expect(service.explain(evaluated.id)).resolves.toMatchObject({
      reason: 'Release manager approved the production deployment.',
    });
  });

  it('allows workspace rules to override the default decision', async () => {
    const service = ix.get(IWorkspacePolicyService);
    await service.setRules({
      request_id: 'request_rules',
      rules: [
        {
          capability: 'dataset',
          action: 'read:public',
          effect: 'allow',
          reason: 'Public datasets are approved by workspace policy.',
        },
      ],
    });

    const allowed = await service.evaluate({
      request_id: 'request_public_dataset',
      capability: 'dataset',
      action: 'read:public',
      requested_by: 'agent',
    });
    expect(allowed).toMatchObject({ state: 'evaluated', outcome: 'allow' });

    const stillGated = await service.evaluate({
      request_id: 'request_private_dataset',
      capability: 'dataset',
      action: 'read:private',
      requested_by: 'agent',
    });
    expect(stillGated.outcome).toBe('approval_required');
  });

  it('reloads decisions and rules from the durable workspace document', async () => {
    const service = ix.get(IWorkspacePolicyService);
    const decision = await service.evaluate({
      request_id: 'request_reload_policy',
      capability: 'network',
      action: 'fetch:example.com',
      requested_by: 'agent',
    });
    const fresh = disposables.add(ix.createInstance(WorkspacePolicyService));
    await fresh.ready;
    await expect(fresh.get(decision.id)).resolves.toMatchObject({ id: decision.id });
    await expect(fresh.rules()).resolves.toContainEqual(
      expect.objectContaining({ capability: 'network' }),
    );
  });

  it('does not reuse an approved decision for another action or Run', async () => {
    const service = ix.get(IWorkspacePolicyService);
    const decision = await service.evaluate({
      request_id: 'request_scoped_policy',
      run_id: 'run_scoped',
      capability: 'cloud',
      action: 'lease:customer-managed:worker',
      requested_by: 'agent',
    });
    const approved = await service.approve(decision.id, {
      request_id: 'request_scoped_policy_approve',
      decided_by: 'user',
    });
    expect(approved?.state).toBe('approved');
    await expect(service.assertUsable(decision.id, {
      capability: 'cloud',
      action: 'lease:customer-managed:other-worker',
      run_id: 'run_scoped',
    })).rejects.toMatchObject({ code: 'policy_decision.invalid_state' });
    await expect(service.assertUsable(decision.id, {
      capability: 'cloud',
      action: 'lease:customer-managed:worker',
      run_id: 'run_other',
    })).rejects.toMatchObject({ code: 'policy_decision.invalid_state' });
    await expect(service.assertUsable(decision.id, {
      capability: 'cloud',
      action: 'lease:customer-managed:worker',
      run_id: 'run_scoped',
    })).resolves.toMatchObject({ id: decision.id });
  });
});
