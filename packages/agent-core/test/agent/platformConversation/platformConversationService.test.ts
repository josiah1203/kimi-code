/**
 * Scenario: conversational Run references survive the model's natural
 * language follow-up and update as the durable Run changes state.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { Emitter } from '#/_base/event';
import { IPlatformConversationService } from '#/agent/platformConversation/platformConversation';
import { PlatformConversationService } from '#/agent/platformConversation/platformConversationService';
import { ISessionRunService } from '#/session/run/run';
import type { Run } from '@spiderbyte/protocol';

const genericRun: Run = {
  id: 'run_prompt',
  workspace_id: 'wd_test_0123456789ab',
  agent_session_id: 'ses_test',
  request_id: 'prompt_request',
  status: 'succeeded',
  created_at: '2026-08-09T00:00:00.000Z',
  updated_at: '2026-08-09T00:00:01.000Z',
};

const platformRun: Run = {
  ...genericRun,
  id: 'run_analysis',
  request_id: 'platform_request',
  status: 'running',
  updated_at: '2026-08-09T00:00:02.000Z',
  metadata: { kind: 'dataset_analysis' },
};

describe('PlatformConversationService', () => {
  let disposables: DisposableStore;

  afterEach(() => disposables.dispose());

  it('ignores ordinary prompt Runs and resolves current/last aliases', async () => {
    disposables = new DisposableStore();
    const changes = new Emitter<Run>();
    let records = [genericRun, platformRun];
    const runs = {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      list: async () => records,
      get: async (id: string) => records.find((run) => run.id === id),
      create: async () => platformRun,
      transition: async () => platformRun,
      resume: async () => platformRun,
      cancel: async () => platformRun,
      retry: async () => platformRun,
      rerun: async () => platformRun,
      fork: async () => platformRun,
      onDidChange: changes.event,
    } as unknown as ISessionRunService;
    const ix = disposables.add(new TestInstantiationService());
    ix.stub(ISessionRunService, runs);
    ix.set(IPlatformConversationService, new SyncDescriptor(PlatformConversationService));

    const service = ix.get(IPlatformConversationService);
    expect((await service.resolveRunReference('last'))?.id).toBe('run_analysis');
    expect((await service.resolveRunReference('current run'))?.id).toBe('run_analysis');
    expect((await service.resolveRunReference('run_prompt'))?.id).toBe('run_prompt');

    const next = {
      ...platformRun,
      id: 'run_training',
      status: 'succeeded' as const,
      updated_at: '2026-08-09T00:00:03.000Z',
      metadata: { kind: 'training' },
    };
    records = [genericRun, platformRun, next];
    const seen: string[] = [];
    service.onDidChange((event) => seen.push(`${event.run.id}:${event.run.status}`));
    changes.fire(next);

    expect((await service.current())?.id).toBe('run_training');
    expect(seen).toEqual(['run_training:succeeded']);
  });
});
