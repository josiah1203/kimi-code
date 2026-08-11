import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSpiderByteHarness,
  ImageLimits,
  SpiderByteHarness,
  type SpiderBytePlatformClient,
} from '#/index';
import { SDKRpcClientBase } from '#/rpc';
import type { SessionRunsFacade } from '@spiderbyte/client';
import type { PlatformLifecycleEvent } from '@spiderbyte/protocol';

import { recordingTelemetry } from './telemetry';
import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The recursive RPC surface SpiderByteHarness touches for the tests below: kept
 * minimal like the StubRpc in create-session-transport.test.ts.
 */
class StubRpc extends SDKRpcClientBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async getRpc(): Promise<any> {
    throw new Error('no core calls expected');
  }
}

class PlatformRpc extends StubRpc {
  override async createSession(input: { readonly id?: string; readonly workDir: string }) {
    return {
      id: input.id ?? 'ses_platform',
      workDir: input.workDir,
      sessionDir: '/tmp/session',
      createdAt: 1,
      updatedAt: 1,
    };
  }

  override async closeSession(): Promise<void> {}
}

function makeHarnessWithRpc(rpc: SDKRpcClientBase): SpiderByteHarness {
  return new SpiderByteHarness(rpc, {
    homeDir: '/tmp/home',
    configPath: '/tmp/config.toml',
    auth: { status: async () => ({ providers: [] }) } as never,
    telemetry: recordingTelemetry([]),
    ensureConfigFile: async () => undefined,
    onClose: () => undefined,
  });
}

describe('SpiderByteHarness conversational platform bridge', () => {
  it('wires session Runs and replay-first lifecycle events without leaking other sessions', async () => {
    const workDir = '/tmp/platform-workspace';
    const runFacade = {} as SessionRunsFacade;
    const first: PlatformLifecycleEvent = {
      event_id: 'event_run_1',
      event_type: 'run.updated',
      entity_type: 'run',
      entity_id: 'run_platform',
      workspace_id: 'workspace_platform',
      sequence: 1,
      occurred_at: '2026-08-09T00:00:00.000Z',
      actor: 'agent',
      payload: { agent_session_id: 'ses_platform' },
    };
    const second: PlatformLifecycleEvent = {
      ...first,
      event_id: 'event_run_2',
      sequence: 2,
      state: 'succeeded',
    };
    const otherSession: PlatformLifecycleEvent = {
      ...first,
      event_id: 'event_run_other',
      entity_id: 'run_other',
      sequence: 3,
      payload: { agent_session_id: 'ses_other' },
    };
    let live: ((event: PlatformLifecycleEvent) => void) | undefined;
    const platform = {
      workspaceIdForRoot: async (root: string) =>
        root === workDir ? 'workspace_platform' : undefined,
      platformEvents: {
        replay: async (_workspaceId: string, afterSequence = 0) => {
          if (afterSequence === 0) live?.(second);
          return {
            events: afterSequence === 0 ? [first] : [],
            next_sequence: 1,
            has_more: false,
          };
        },
        subscribe: (_workspaceId: string, listener: (event: PlatformLifecycleEvent) => void) => {
          live = listener;
          return { dispose: () => { live = undefined; } };
        },
      },
    } as unknown as SpiderBytePlatformClient;
    const harness = new SpiderByteHarness(new PlatformRpc(), {
      homeDir: '/tmp/home',
      configPath: '/tmp/config.toml',
      auth: { status: async () => ({ providers: [] }) } as never,
      telemetry: recordingTelemetry([]),
      ensureConfigFile: async () => undefined,
      onClose: () => undefined,
      platform,
      platformSessionRuns: () => runFacade,
    });

    const session = await harness.createSession({ id: 'ses_platform', workDir });
    expect(session.platformRuns).toBe(runFacade);
    const received: string[] = [];
    const unsubscribe = await session.subscribePlatformEvents((event) => {
      received.push(event.event_id);
    });

    expect(received).toEqual(['event_run_1', 'event_run_2']);
    live?.(first);
    live?.(second);
    live?.(otherSession);
    expect(received).toEqual(['event_run_1', 'event_run_2']);

    unsubscribe?.();
    await harness.close();
  });
});

describe('SpiderByteHarness imageLimits', () => {
  it('exposes the in-process core [image] limits loaded from config.toml', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'spiderbyte-sdk-harness-'));
    tempDirs.push(homeDir);
    await writeFile(
      join(homeDir, 'config.toml'),
      `
[image]
max_edge_px = 1200
read_byte_budget = 65536
`,
      'utf-8',
    );

    const harness = createSpiderByteHarness({ identity: TEST_IDENTITY, homeDir });
    try {
      // The core was constructed in-process; its owner-scoped [image] limits
      // must be readable on the harness for prompt-ingestion paths.
      expect(harness.imageLimits).toBeInstanceOf(ImageLimits);
      expect(harness.imageLimits?.maxEdgePx()).toBe(1200);
      expect(harness.imageLimits?.readByteBudget()).toBe(65536);
    } finally {
      await harness.close();
    }
  });

  it('falls back to built-in defaults when no [image] section is configured', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'spiderbyte-sdk-harness-'));
    tempDirs.push(homeDir);

    const harness = createSpiderByteHarness({ identity: TEST_IDENTITY, homeDir });
    try {
      expect(harness.imageLimits).toBeInstanceOf(ImageLimits);
      expect(harness.imageLimits?.maxEdgePx()).toBe(2000);
      expect(harness.imageLimits?.readByteBudget()).toBe(256 * 1024);
    } finally {
      await harness.close();
    }
  });

  it('a hand-built harness returns the injected ImageLimits as-is', () => {
    const limits = new ImageLimits(process.env, { maxEdgePx: 900 });
    const harness = new SpiderByteHarness(new StubRpc(), {
      homeDir: '/tmp/home',
      configPath: '/tmp/config.toml',
      auth: { status: async () => ({ providers: [] }) } as never,
      telemetry: recordingTelemetry([]),
      ensureConfigFile: async () => undefined,
      onClose: () => undefined,
      imageLimits: limits,
    });

    expect(harness.imageLimits).toBe(limits);
    expect(harness.imageLimits?.maxEdgePx()).toBe(900);
  });
});
