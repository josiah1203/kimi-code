/**
 * Scenario: durable session Run persistence and lifecycle transitions.
 *
 * Exercises `ISessionRunService` through DI with an atomic document store and
 * a fresh independent service instance to verify reload behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { ISessionContext, makeSessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionRunService } from '#/session/run/run';
import { SessionRunService } from '#/session/run/runService';

const RUN_SCOPE = 'sessions/wd_test_0123456789ab/s1/platform';

function makeContext(): ISessionContext {
  return makeSessionContext({
    sessionId: 's1',
    workspaceId: 'wd_test_0123456789ab',
    sessionDir: '/tmp/sessions/wd_test_0123456789ab/s1',
    sessionScope: 'sessions/wd_test_0123456789ab/s1',
    cwd: '/tmp/sessions/wd_test/s1',
  });
}

describe('SessionRunService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(ISessionContext, makeContext());
    ix.set(IFileSystemStorageService, new SyncDescriptor(InMemoryStorageService));
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.set(ISessionRunService, new SyncDescriptor(SessionRunService));
  });

  afterEach(() => disposables.dispose());

  it('materializes an empty document and persists created Runs', async () => {
    const service = ix.get(ISessionRunService);
    const changed: string[] = [];
    service.onDidChange((run) => changed.push(run.id));

    await service.ready;
    const created = await service.create({
      request_id: 'request_create',
      plan: [{ id: 'step_1', title: 'Prepare', status: 'pending' }],
      metadata: { source: 'test' },
    });

    expect(created).toMatchObject({
      workspace_id: 'wd_test_0123456789ab',
      agent_session_id: 's1',
      status: 'queued',
      request_id: 'request_create',
    });
    expect(await service.list()).toEqual([created]);
    expect(changed).toEqual([created.id]);

    const stored = await ix
      .get(IAtomicDocumentStore)
      .get<{ version: number; runs: readonly unknown[] }>(RUN_SCOPE, 'runs.json');
    expect(stored).toMatchObject({ version: 1, runs: [created] });
  });

  it('enforces the lifecycle graph and records start/completion timestamps', async () => {
    const service = ix.get(ISessionRunService);
    const created = await service.create({ request_id: 'request_create' });

    const running = await service.transition(created.id, {
      request_id: 'request_start',
      status: 'running',
    });
    expect(running).toMatchObject({ status: 'running' });
    expect(running?.started_at).toEqual(expect.any(String));

    const succeeded = await service.transition(created.id, {
      request_id: 'request_finish',
      status: 'succeeded',
    });
    expect(succeeded).toMatchObject({ status: 'succeeded' });
    expect(succeeded?.completed_at).toEqual(expect.any(String));

    await expect(
      service.transition(created.id, {
        request_id: 'request_invalid',
        status: 'running',
      }),
    ).rejects.toMatchObject({ code: 'request.invalid', name: 'RunStateError' });
  });

  it('loads Runs from the same durable session document', async () => {
    const service = ix.get(ISessionRunService);
    const parent = await service.create({ request_id: 'request_parent' });
    await service.create({ request_id: 'request_child', parent_run_id: parent.id });

    // A second independent instance is required to exercise reload from the
    // same document rather than the first instance's in-memory cache.
    const fresh = disposables.add(ix.createInstance(SessionRunService));
    await fresh.ready;

    expect((await fresh.list()).map((run) => run.parent_run_id)).toEqual([undefined, parent.id]);
  });
});
