import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore, toDisposable } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import {
  IWorkspaceProviderConnectionService,
} from '#/workspace/providerConnections/providerConnection';
import {
  WorkspaceProviderConnectionService,
} from '#/workspace/providerConnections/providerConnectionService';
import { ProviderConnectionSecretError } from '#/workspace/providerConnections/errors';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import type { IWorkspaceContext as WorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { PLATFORM_NO_CREDENTIAL_SECRET_REF } from '@spiderbyte/protocol';

const context: WorkspaceContext = {
  _serviceBrand: undefined,
  workspaceId: 'wd_workspace_0123456789ab',
  cwd: '/tmp/workspace',
  source: 'local',
  meta: {
    id: 'wd_workspace_0123456789ab',
    root: '/tmp/workspace',
    name: 'workspace',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  },
  persistenceScope: 'workspaces/wd_workspace_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspaceProviderConnectionService', () => {
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
    ix.set(IWorkspaceProviderConnectionService, new SyncDescriptor(WorkspaceProviderConnectionService));
  });

  afterEach(() => disposables.dispose());

  it('persists reference-only connections, validates, activates, discovers, and revokes', async () => {
    const service = ix.get(IWorkspaceProviderConnectionService);
    const created = await service.create({
      request_id: 'request_connection_create',
      name: 'OpenAI BYOK',
      provider: 'openai',
      scope: 'workspace',
      secret_ref: 'secret_openai_primary',
      capabilities: ['chat', 'embeddings'],
      metadata: {
        models: [{ id: 'gpt-4.1', capabilities: ['chat'] }],
      },
    });

    expect(created).toMatchObject({
      workspace_id: context.workspaceId,
      state: 'configured',
      secret_ref: 'secret_openai_primary',
    });

    const validated = await service.validate(created.id, { request_id: 'request_validate' });
    expect(validated?.state).toBe('validated');
    const active = await service.activate(created.id, { request_id: 'request_activate' });
    expect(active?.state).toBe('active');

    const discovery = await service.discoverModels(created.id);
    expect(discovery?.models).toEqual([{ id: 'gpt-4.1', capabilities: ['chat'] }]);

    const revoked = await service.revoke(created.id, { request_id: 'request_revoke' });
    expect(revoked?.state).toBe('revoked');

    const stored = await ix
      .get(IAtomicDocumentStore)
      .get<unknown>('workspaces/wd_workspace_0123456789ab/platform', 'provider-connections.json');
    expect(JSON.stringify(stored)).not.toContain('sk-');
    expect(JSON.stringify(stored)).toContain('secret_openai_primary');
  });

  it('makes create retries idempotent and rejects secret-shaped metadata', async () => {
    const service = ix.get(IWorkspaceProviderConnectionService);
    const input = {
      request_id: 'request_same',
      name: 'Local model',
      provider: 'local' as const,
      scope: 'member' as const,
      secret_ref: 'secret_local',
    };
    const first = await service.create(input);
    const retry = await service.create(input);
    expect(retry.id).toBe(first.id);

    await expect(
      service.create({
        ...input,
        request_id: 'request_secret_metadata',
        name: 'Unsafe',
        metadata: { api_key: 'sk-live-secret' },
      }),
    ).rejects.toBeInstanceOf(ProviderConnectionSecretError);

    await expect(
      service.create({
        ...input,
        request_id: 'request_nonlocal_no_credential',
        name: 'Invalid unauthenticated OpenAI',
        provider: 'openai',
        secret_ref: PLATFORM_NO_CREDENTIAL_SECRET_REF,
      }),
    ).rejects.toMatchObject({ code: 'provider_connection.secret_material' });
  });

  it('reloads the durable registry into a fresh workspace service', async () => {
    const service = ix.get(IWorkspaceProviderConnectionService);
    const created = await service.create({
      request_id: 'request_reload',
      name: 'Anthropic',
      provider: 'anthropic',
      scope: 'workspace',
      secret_ref: 'secret_anthropic',
    });
    const fresh = disposables.add(ix.createInstance(WorkspaceProviderConnectionService));
    await fresh.ready;
    await expect(fresh.get(created.id)).resolves.toMatchObject({ id: created.id });
  });
});
