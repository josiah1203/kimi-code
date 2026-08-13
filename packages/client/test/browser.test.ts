/**
 * Browser platform client contract tests.
 *
 * The fetch and WebSocket implementations are external boundaries; the tests
 * drive the public client and verify envelope parsing, secret-safe projections,
 * cursor replay, and duplicate suppression.
 */

import { describe, expect, it } from 'vitest';

import {
  BrowserPlatformClient,
  type BrowserFetch,
  type BrowserWebSocketLike,
} from '../src/transports/browser';

const workspaceId = 'wd_test_0123456789ab';

function envelope(data: unknown, requestId = 'request_browser_test'): string {
  return JSON.stringify({ code: 0, msg: 'success', data, request_id: requestId });
}

function connection() {
  return {
    id: 'connection_openai',
    workspace_id: workspaceId,
    name: 'OpenAI',
    provider: 'openai',
    scope: 'workspace',
    state: 'active',
    secret_ref: 'secret_opaque',
    capabilities: ['chat'],
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:00.000Z',
  };
}

function event(sequence: number) {
  return {
    event_id: `event_${sequence}`,
    event_type: 'artifact.created',
    entity_type: 'artifact',
    entity_id: `artifact_${sequence}`,
    workspace_id: workspaceId,
    sequence,
    occurred_at: '2026-08-09T00:00:00.000Z',
    actor: 'agent',
    payload: { sequence },
  };
}

function collaborationMessage(sequence: number, eventSequence = sequence, state: 'queued' | 'completed' = 'completed') {
  return {
    id: `message_${sequence}`,
    workspace_id: workspaceId,
    channel_id: 'channel_general',
    thread_id: 'thread_general',
    sequence,
    event_sequence: eventSequence,
    author_id: 'actor_test',
    author_kind: 'user',
    author_display_name: 'Test user',
    content: `message ${sequence}`,
    state,
    artifact_ids: [],
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:00.000Z',
  };
}

class FakeWebSocket implements BrowserWebSocketLike {
  readonly OPEN = 1;
  readyState = this.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe('BrowserPlatformClient', () => {
  it('uses authenticated REST projections without returning secret material', async () => {
    const calls: Array<{ url: string; init?: unknown }> = [];
    const fetch: BrowserFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => envelope([connection()]) };
    };
    const client = new BrowserPlatformClient({
      baseUrl: 'https://client.example.test',
      token: 'opaque-session-token',
      fetch,
    });

    const result = await client.workspace(workspaceId).listConnections();

    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('api_key');
    expect(JSON.stringify(result)).not.toContain('opaque-session-token');
    expect(calls[0]?.url).toBe(`https://client.example.test/api/v2/workspaces/${workspaceId}/platform/connections`);
    expect((calls[0]?.init as { readonly headers: Record<string, string> }).headers['authorization']).toBe('Bearer opaque-session-token');
  });

  it('recovers a WebSocket cursor gap through replay and suppresses duplicates', async () => {
    const socket = new FakeWebSocket();
    const fetch: BrowserFetch = async (url) => {
      if (url.includes('/platform/events')) {
        return {
          ok: true,
          status: 200,
          text: async () => envelope({ events: [event(1)], next_sequence: 1, has_more: false }),
        };
      }
      return { ok: true, status: 200, text: async () => envelope([]) };
    };
    const received: number[] = [];
    let protocols: string | readonly string[] | undefined;
    const client = new BrowserPlatformClient({
      baseUrl: 'https://client.example.test',
      token: 'opaque-ws-token',
      fetch,
      webSocket: (_url, requestedProtocols) => {
        protocols = requestedProtocols;
        return socket;
      },
    });
    const subscription = client.workspace(workspaceId).subscribeEvents({
      onEvent: (item) => received.push(item.sequence),
    }, { reconnect: false });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.open();
    socket.emit({ type: 'platform_event', event: event(2) });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.emit({ type: 'platform_event', event: event(2) });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual([1, 2]);
    expect(subscription.cursor).toBe(2);
    expect(JSON.parse(socket.sent[0]!).type).toBe('subscribe');
    expect(protocols).toEqual(['spiderbyte.bearer.opaque-ws-token']);
    subscription.dispose();
  });

  it('uses an explicit identity subprotocol instead of a browser bearer token when configured', async () => {
    const socket = new FakeWebSocket();
    let protocols: string | readonly string[] | undefined;
    const client = new BrowserPlatformClient({
      baseUrl: 'https://client.example.test',
      token: 'clerk-jwt-not-for-kap-server',
      fetch: async () => ({ ok: true, status: 200, text: async () => envelope({ events: [], next_sequence: 0, has_more: false }) }),
      webSocketProtocols: async () => ['spiderbyte.identity.short-lived-assertion'],
      webSocket: (_url, requestedProtocols) => {
        protocols = requestedProtocols;
        return socket;
      },
    });

    const subscription = client.workspace(workspaceId).subscribeEvents({ onEvent: () => {} }, { reconnect: false });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(protocols).toEqual(['spiderbyte.identity.short-lived-assertion']);
    subscription.dispose();
  });

  it('replays durable collaboration messages after a cursor gap and suppresses duplicates', async () => {
    const socket = new FakeWebSocket();
    const received: number[] = [];
    const fetch: BrowserFetch = async (url) => {
      if (url.includes('/collaboration/channels/') && url.includes('/messages')) {
        return {
          ok: true,
          status: 200,
          text: async () => envelope({
            items: [collaborationMessage(1), collaborationMessage(2)],
          }),
        };
      }
      return { ok: true, status: 200, text: async () => envelope([]) };
    };
    const client = new BrowserPlatformClient({
      baseUrl: 'https://client.example.test',
      fetch,
      webSocket: () => socket,
      webSocketProtocols: async () => ['spiderbyte.identity.short-lived-assertion'],
    });
    const subscription = client.workspace(workspaceId).subscribeCollaboration(
      'channel_general',
      { onMessage: (message) => received.push(message.sequence) },
      { reconnect: false },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.open();
    socket.emit({ type: 'ack', request_id: 'subscribe', code: 0, msg: 'ok', data: { items: [], next_cursor: undefined } });
    socket.emit({ type: 'collaboration_message', message: collaborationMessage(3) });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.emit({ type: 'collaboration_message', message: collaborationMessage(3) });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual([1, 2, 3]);
    expect(subscription.cursor).toBe(3);
    expect(JSON.parse(socket.sent[0]!).type).toBe('subscribe');
    subscription.dispose();
  });

  it('advances the collaboration cursor for a projection revision with stable message identity', async () => {
    const socket = new FakeWebSocket();
    const received: Array<{ readonly id: string; readonly state: string; readonly eventSequence: number | undefined }> = [];
    const client = new BrowserPlatformClient({
      baseUrl: 'https://client.example.test',
      fetch: async () => ({ ok: true, status: 200, text: async () => envelope({ items: [] }) }),
      webSocket: () => socket,
      webSocketProtocols: async () => ['spiderbyte.identity.short-lived-assertion'],
    });
    const subscription = client.workspace(workspaceId).subscribeCollaboration(
      'channel_general',
      { onMessage: (message) => received.push({ id: message.id, state: message.state, eventSequence: message.event_sequence }) },
      { reconnect: false },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.open();
    socket.emit({ type: 'collaboration_message', message: collaborationMessage(1, 1, 'queued') });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.emit({ type: 'collaboration_message', message: collaborationMessage(1, 2, 'completed') });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    socket.emit({ type: 'collaboration_message', message: collaborationMessage(1, 2, 'completed') });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual([
      { id: 'message_1', state: 'queued', eventSequence: 1 },
      { id: 'message_1', state: 'completed', eventSequence: 2 },
    ]);
    expect(subscription.cursor).toBe(2);
    subscription.dispose();
  });

  it('reads transcript snapshots and op catch-up through the existing SpiderByte REST surface', async () => {
    const fetch: BrowserFetch = async (url) => {
      if (url.includes('/transcript/ops')) {
        return {
          ok: true,
          status: 200,
          text: async () => envelope({ agent_id: 'main', batches: [{ seq: 2, ops: [] }], latest_seq: 2, complete: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => envelope({ agent_id: 'main', items: [], has_more: false, tasks: [], meta: {}, agents: [], pending_interactions: [] }),
      };
    };
    const client = new BrowserPlatformClient({ baseUrl: 'https://client.example.test', fetch });
    const workspace = client.workspace(workspaceId);

    await expect(workspace.getTranscript('session_test')).resolves.toMatchObject({ agent_id: 'main', items: [] });
    await expect(workspace.getTranscriptOps('session_test', 'main', 1)).resolves.toMatchObject({ latest_seq: 2, complete: true });
  });
});
