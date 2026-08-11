import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSpiderByteHarness, type SpiderByteError, type Event } from '#/index';

import { makeTempDir, removeTempDirs, waitForSDKEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';
import { startOpenAITestServer, type OpenAITestServer } from './openai-test-server';

const tempDirs: string[] = [];
let provider: OpenAITestServer;

beforeEach(async () => {
  provider = await startOpenAITestServer({ hang: true });
});

afterEach(async () => {
  await provider.close();
  await removeTempDirs(tempDirs);
});

describe('Session.cancel', () => {
  it('cancels an active streaming turn and emits turn_ended(cancelled)', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-cancel-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-cancel-work-');
    await writeFakeModelConfig(homeDir, provider.baseUrl);
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_cancel_active_turn', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });
      const started = waitForSDKEvent(session, (event) => event.type === 'turn.started');
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.prompt('start a turn that will be cancelled');
      const startedEvent = await started;
      await session.cancel();
      const endedEvent = await ended;
      unsubscribe();

      expect(startedEvent).toMatchObject({
        type: 'turn.started',
        sessionId: session.id,
      });
      expect(endedEvent).toMatchObject({
        type: 'turn.ended',
        sessionId: session.id,
        turnId: startedEvent.type === 'turn.started' ? startedEvent.turnId : undefined,
        reason: 'cancelled',
      });
      expect(events).toContainEqual(expect.objectContaining({ type: 'turn.started' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'turn.ended' }));
    } finally {
      await harness.close();
    }
  });

  it('rejects manual compaction on an empty session with compaction.unable', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-cancel-compact-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-cancel-compact-work-');
    await writeFakeModelConfig(homeDir, provider.baseUrl);
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_cancel_compaction', workDir });

      await expect(session.compact({ instruction: 'Keep the compact test pending.' })).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'compaction.unable',
      } satisfies Partial<SpiderByteError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-cancel-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-cancel-work-');
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_cancel_closed', workDir });
      await session.close();

      await expect(session.cancel()).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'session.closed',
      } satisfies Partial<SpiderByteError>);
      await expect(session.cancelCompaction()).rejects.toMatchObject({
        name: 'SpiderByteError',
        code: 'session.closed',
      } satisfies Partial<SpiderByteError>);
    } finally {
      await harness.close();
    }
  });
});

describe('SpiderByteHarness.forkSession', () => {
  it('rejects while the source session has an active turn', async () => {
    const homeDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-fork-active-home-');
    const workDir = await makeTempDir(tempDirs, 'spiderbyte-sdk-fork-active-work-');
    await writeFakeModelConfig(homeDir, provider.baseUrl);
    const harness = createSpiderByteHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_fork_active_turn', workDir });
      const started = waitForSDKEvent(session, (event) => event.type === 'turn.started');
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.prompt('keep this turn active');
      await started;
      try {
        await expect(
          harness.forkSession({
            id: session.id,
            forkId: 'ses_fork_active_child',
          }),
        ).rejects.toMatchObject({
          name: 'SpiderByteError',
          code: 'session.fork_active_turn',
        } satisfies Partial<SpiderByteError>);
      } finally {
        await session.cancel().catch(() => undefined);
        await ended.catch(() => undefined);
      }
    } finally {
      await harness.close();
    }
  });
});

async function writeFakeModelConfig(homeDir: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(homeDir, 'config.toml'),
    `
default_model = "fake-model"

[providers.local]
type = "openai"
base_url = "${baseUrl}"
api_key = "sk-test"

[models.fake-model]
provider = "local"
model = "fake-model"
max_context_size = 1000
`,
    'utf-8',
  );
}
