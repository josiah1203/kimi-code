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
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import { Event } from '#/_base/event';

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
  let emittedPlatformEvents: unknown[];

  beforeEach(() => {
    disposables = new DisposableStore();
    emittedPlatformEvents = [];
    ix = disposables.add(new TestInstantiationService());
    ix.stub(ISessionContext, makeContext());
    ix.stub(IWorkspacePlatformEventService, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: Event.None as IWorkspacePlatformEventService['onDidChange'],
      append: async (input: unknown) => {
        emittedPlatformEvents.push(input);
        return input as never;
      },
    });
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
      attempt_count: 1,
    });
    const attempts = await service.listAttempts(created.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ run_id: created.id, kind: 'initial', status: 'queued' });
    expect(await service.list()).toEqual([created]);
    expect(changed).toEqual([created.id]);

    const stored = await ix
      .get(IAtomicDocumentStore)
      .get<{ version: number; runs: readonly unknown[] }>(RUN_SCOPE, 'runs.json');
    expect(stored).toMatchObject({ version: 2, runs: [created], attempts: attempts });
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

  it('prevents a parent Run from succeeding while a required child is incomplete', async () => {
    const service = ix.get(ISessionRunService);
    const parent = await service.create({ request_id: 'request_required_parent' });
    const child = await service.create({
      request_id: 'request_required_child',
      parent_run_id: parent.id,
      metadata: { required: true, operation: 'provider' },
    });
    await service.transition(parent.id, {
      request_id: 'request_required_parent_running',
      status: 'running',
    });

    await expect(
      service.transition(parent.id, {
        request_id: 'request_required_parent_premature_success',
        status: 'succeeded',
      }),
    ).rejects.toMatchObject({ code: 'request.invalid' });

    await service.transition(child.id, {
      request_id: 'request_required_child_running',
      status: 'running',
    });
    await service.transition(child.id, {
      request_id: 'request_required_child_failed',
      status: 'failed',
      status_reason: 'provider rejected the request',
    });
    await expect(
      service.transition(parent.id, {
        request_id: 'request_required_parent_failed',
        status: 'succeeded',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      status_reason: `required child Run ${child.id} ended with status failed`,
    });
  });

  it('does not attach a required child after the parent has succeeded', async () => {
    const service = ix.get(ISessionRunService);
    const parent = await service.create({ request_id: 'request_completed_parent' });
    await service.transition(parent.id, {
      request_id: 'request_completed_parent_running',
      status: 'running',
    });
    await service.transition(parent.id, {
      request_id: 'request_completed_parent_succeeded',
      status: 'succeeded',
    });

    await expect(
      service.create({
        request_id: 'request_late_required_child',
        parent_run_id: parent.id,
        metadata: { required: true },
      }),
    ).rejects.toMatchObject({ code: 'request.invalid' });
  });

  it('includes the session identity on every lifecycle event for reconnect filtering', async () => {
    const service = ix.get(ISessionRunService);
    const created = await service.create({ request_id: 'request_event_identity' });
    await service.transition(created.id, {
      request_id: 'request_event_running',
      status: 'running',
    });
    await service.transition(created.id, {
      request_id: 'request_event_finished',
      status: 'succeeded',
      output_artifacts: [{ id: 'artifact_report', version: 1 }],
    });

    expect(emittedPlatformEvents).toContainEqual(expect.objectContaining({
      event_type: 'run.completed',
      payload: {
        agent_session_id: 's1',
        output_artifacts: [{ id: 'artifact_report', version: 1 }],
      },
    }));
  });

  it('can surface an approval gate discovered after execution starts', async () => {
    const service = ix.get(ISessionRunService);
    const created = await service.create({ request_id: 'request_approval_create' });
    await service.transition(created.id, {
      request_id: 'request_approval_start',
      status: 'running',
    });

    const awaiting = await service.transition(created.id, {
      request_id: 'request_approval_gate',
      status: 'awaiting_approval',
      status_reason: 'execution target approval is required',
      policy_decision_ids: ['policy_approval'],
    });
    expect(awaiting).toMatchObject({
      status: 'awaiting_approval',
      policy_decision_ids: ['policy_approval'],
    });

    const resumed = await service.transition(created.id, {
      request_id: 'request_approval_resume',
      status: 'running',
    });
    expect(resumed).toMatchObject({ status: 'running' });
  });

  it('preserves Run metadata and references across status-only transitions', async () => {
    const service = ix.get(ISessionRunService);
    const created = await service.create({
      request_id: 'request_patch_create',
      input_resources: [{ id: 'dataset_sales', type: 'dataset', version: 1 }],
      execution_target_id: 'target_local',
      metadata: {
        kind: 'analysis',
        operation: 'dataset_profile',
        platform_operation: {
          version: 1,
          domain: 'dataset',
          operation: 'profile',
          input: { dataset_id: 'dataset_sales', version: 1 },
        },
      },
    });

    const planning = await service.transition(created.id, {
      request_id: 'request_patch_planning',
      status: 'planning',
    });
    expect(planning).toMatchObject({
      input_resources: [{ id: 'dataset_sales' }],
      execution_target_id: 'target_local',
      metadata: {
        kind: 'analysis',
        operation: 'dataset_profile',
        platform_operation: {
          version: 1,
          domain: 'dataset',
          operation: 'profile',
          input: { dataset_id: 'dataset_sales', version: 1 },
        },
      },
    });

    await service.transition(created.id, {
      request_id: 'request_patch_running',
      status: 'running',
    });
    const finished = await service.transition(created.id, {
      request_id: 'request_patch_finished',
      status: 'succeeded',
      output_artifacts: [{ id: 'artifact_report', version: 1 }],
    });
    expect(finished).toMatchObject({
      input_resources: [{ id: 'dataset_sales' }],
      execution_target_id: 'target_local',
      output_artifacts: [{ id: 'artifact_report', version: 1 }],
      metadata: { kind: 'analysis', operation: 'dataset_profile' },
    });
  });

  it('allows an active executor to append safe metadata without changing Run state', async () => {
    const service = ix.get(ISessionRunService);
    const created = await service.create({
      request_id: 'request_same_status_create',
      metadata: { kind: 'provider_model_request' },
    });
    const running = await service.transition(created.id, {
      request_id: 'request_same_status_start',
      status: 'running',
    });
    const updated = await service.transition(created.id, {
      request_id: 'request_same_status_usage',
      status: 'running',
      metadata: {
        kind: 'provider_model_request',
        provider_connection_id: 'connection_openai',
        model: 'gpt-test',
        duration_ms: 42,
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    });
    expect(running?.status).toBe('running');
    expect(updated).toMatchObject({
      status: 'running',
      metadata: {
        provider_connection_id: 'connection_openai',
        model: 'gpt-test',
        duration_ms: 42,
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    });
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
    expect((await fresh.listAttempts()).map((attempt) => attempt.run_id)).toEqual([
      parent.id,
      (await fresh.list())[1]!.id,
    ]);
  });

  it('reloads the active Attempt after a service restart', async () => {
    const service = ix.get(ISessionRunService);
    const run = await service.create({ request_id: 'request_restart' });
    await service.transition(run.id, { request_id: 'request_restart_running', status: 'running' });
    const active = (await service.listAttempts(run.id))[0]!;

    const fresh = disposables.add(ix.createInstance(SessionRunService));
    await fresh.ready;

    expect(await fresh.getAttempt(active.id)).toMatchObject({
      id: active.id,
      run_id: run.id,
      status: 'running',
    });
    expect((await fresh.get(run.id))?.active_attempt_id).toBe(active.id);
  });

  it('creates one idempotent retry Attempt on the same Run', async () => {
    const service = ix.get(ISessionRunService);
    const run = await service.create({ request_id: 'request_attempt_retry' });
    await service.transition(run.id, { request_id: 'request_attempt_retry_running', status: 'running' });
    const failed = await service.transitionAttempt(
      (await service.listAttempts(run.id))[0]!.id,
      { request_id: 'request_attempt_retry_failed', status: 'failed', status_reason: 'provider unavailable' },
    );
    expect(failed?.status).toBe('failed');

    const retry = await service.retryAttempt(run.id, { request_id: 'request_attempt_retry_new' });
    const duplicate = await service.retryAttempt(run.id, {
      request_id: 'request_attempt_retry_new',
      metadata: { ignored: true },
    });

    expect(retry).toMatchObject({
      run_id: run.id,
      attempt_number: 2,
      kind: 'retry',
      retry_of_attempt_id: failed?.id,
      status: 'queued',
    });
    expect(duplicate).toEqual(retry);
    expect((await service.get(run.id))?.status).toBe('queued');
  });

  it('cancels the logical Run when its active Attempt is cancelled', async () => {
    const service = ix.get(ISessionRunService);
    const run = await service.create({ request_id: 'request_attempt_cancel' });
    await service.transition(run.id, { request_id: 'request_attempt_cancel_running', status: 'running' });
    const attempt = (await service.listAttempts(run.id))[0]!;

    const cancelled = await service.cancelAttempt(attempt.id, { request_id: 'request_attempt_cancelled' });

    expect(cancelled).toMatchObject({ id: attempt.id, status: 'cancelled' });
    expect(await service.get(run.id)).toMatchObject({ status: 'cancelled', active_attempt_id: attempt.id });
  });

  it('does not let a historical Attempt mutate the active Run projection', async () => {
    const service = ix.get(ISessionRunService);
    const run = await service.create({ request_id: 'request_attempt_history' });
    await service.transition(run.id, { request_id: 'request_attempt_history_running', status: 'running' });
    const initial = (await service.listAttempts(run.id))[0]!;
    await service.transitionAttempt(initial.id, {
      request_id: 'request_attempt_history_failed',
      status: 'failed',
    });
    const retry = await service.retryAttempt(run.id, { request_id: 'request_attempt_history_retry' });

    await expect(service.transitionAttempt(initial.id, {
      request_id: 'request_attempt_history_stale',
      status: 'failed',
    })).rejects.toMatchObject({ code: 'request.invalid' });
    expect((await service.get(run.id))?.active_attempt_id).toBe(retry?.id);
  });

  it('preserves partial artifacts when an Attempt fails after producing output', async () => {
    const service = ix.get(ISessionRunService);
    const run = await service.create({ request_id: 'request_attempt_partial' });
    await service.transition(run.id, { request_id: 'request_attempt_partial_running', status: 'running' });
    const attempt = (await service.listAttempts(run.id))[0]!;

    const partial = await service.transitionAttempt(attempt.id, {
      request_id: 'request_attempt_partial_failed',
      status: 'partial',
      status_reason: 'worker disconnected after checkpoint',
      partial_artifacts: [{ id: 'artifact_checkpoint', version: 1 }],
      usage: { duration_ms: 1250 },
    });

    expect(partial).toMatchObject({
      status: 'partial',
      partial_artifacts: [{ id: 'artifact_checkpoint', version: 1 }],
    });
    expect(await service.get(run.id)).toMatchObject({
      status: 'failed',
      partial_result: {
        attempt_id: attempt.id,
        artifact_refs: [{ id: 'artifact_checkpoint', version: 1 }],
      },
    });
  });

  it('creates idempotent linked retry, rerun, and fork Runs with durable overrides', async () => {
    const service = ix.get(ISessionRunService);
    const source = await service.create({
      request_id: 'request_replay_source',
      plan: [{ id: 'step_1', title: 'Analyze', status: 'pending' }],
      input_resources: [{ id: 'dataset_sales', type: 'dataset', version: 1 }],
      execution_target_id: 'target_local',
      metadata: {
        kind: 'analysis',
        operation: 'dataset_profile',
        platform_operation: {
          version: 1,
          domain: 'dataset',
          operation: 'profile',
          input: { dataset_id: 'dataset_sales', version: 1 },
        },
      },
    });
    await service.transition(source.id, { request_id: 'request_replay_start', status: 'running' });
    const completed = await service.transition(source.id, {
      request_id: 'request_replay_finish',
      status: 'succeeded',
    });
    expect(completed?.status).toBe('succeeded');

    const retry = await service.retry(source.id, {
      request_id: 'request_retry',
      metadata: { attempt: 2 },
    });
    const sameRetry = await service.retry(source.id, {
      request_id: 'request_retry',
      metadata: { ignored: true },
    });
    const rerun = await service.rerun(source.id, { request_id: 'request_rerun' });
    const fork = await service.fork(source.id, {
      request_id: 'request_fork',
      plan: [{ id: 'step_2', title: 'Compare', status: 'pending' }],
      input_resources: [{ id: 'dataset_validation', type: 'dataset' }],
      execution_target_id: 'target_customer',
      metadata: { branch: 'validation' },
    });

    expect(retry).toMatchObject({
      parent_run_id: source.id,
      status: 'queued',
      plan: source.plan,
      input_resources: source.input_resources,
      execution_target_id: source.execution_target_id,
      metadata: {
        kind: 'analysis',
        operation: 'dataset_profile',
        platform_operation: {
          version: 1,
          domain: 'dataset',
          operation: 'profile',
          input: { dataset_id: 'dataset_sales', version: 1 },
        },
        attempt: 2,
        retry_of: source.id,
      },
    });
    expect(sameRetry).toEqual(retry);
    expect(rerun).toMatchObject({ parent_run_id: source.id, metadata: { rerun_of: source.id } });
    expect(fork).toMatchObject({
      parent_run_id: source.id,
      plan: [{ id: 'step_2' }],
      input_resources: [{ id: 'dataset_validation' }],
      execution_target_id: 'target_customer',
      metadata: { operation: 'dataset_profile', branch: 'validation' },
    });

    const fresh = disposables.add(ix.createInstance(SessionRunService));
    await fresh.ready;
    expect((await fresh.list()).map((run) => run.id)).toEqual([
      source.id,
      retry?.id,
      rerun?.id,
      fork?.id,
    ]);
  });
});
