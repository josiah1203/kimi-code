import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocketClient from 'ws';

import { type RunningServer, startServer } from '../src/start';
import {
  DELEGATED_PRINCIPAL_HEADER,
  createDelegatedPrincipalAssertion,
} from '../src/services/auth/delegatedPrincipal';
import { authedFetch } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { WS_BEARER_PROTOCOL_PREFIX } from '../src/transport/ws/bearerProtocol';

interface Envelope<T> {
  readonly code: number;
  readonly msg: string;
  readonly data: T | null;
  readonly request_id: string;
}

interface WorkspaceWire {
  readonly id: string;
}

interface ChannelWire {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

interface ThreadWire {
  readonly id: string;
  readonly channel_id: string;
}

interface MessageWire {
  readonly id: string;
  readonly author_id?: string;
  readonly sequence: number;
  readonly event_sequence?: number;
  readonly content: string;
  readonly state: string;
}

interface RunWire {
  readonly id: string;
  readonly status: string;
}

describe('server collaboration projections', () => {
  const delegatedSecret = 'test-identity-bridge-secret-0123456789';
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    vi.stubEnv('SPIDERBYTE_EXPERIMENTAL_PLATFORM_SERVICES', '1');
    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'collaboration-user');
    home = await mkdtemp(join(tmpdir(), 'spiderbyte-collaboration-'));
    await writeFile(join(home, 'config.toml'), [
      'default_model = "stub"',
      '',
      '[providers.stub]',
      'type = "openai"',
      'base_url = "http://127.0.0.1:9999"',
      'api_key = "stub"',
      '',
      '[models.stub]',
      'provider = "stub"',
      'model = "stub"',
      'max_context_size = 1000',
      '',
    ].join('\n'), 'utf-8');
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
      delegatedPrincipalSecret: delegatedSecret,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('persists channels, threads, messages, and idempotency across restart', async () => {
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: home, name: 'collaboration-test' }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    expect(workspace.code).toBe(0);
    const workspaceId = workspace.data?.id as string;

    const channelsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels`,
    );
    const channels = (await channelsResponse.json()) as Envelope<readonly ChannelWire[]>;
    expect(channels).toMatchObject({ code: 0, data: expect.arrayContaining([
      expect.objectContaining({ name: 'general', kind: 'public' }),
      expect.objectContaining({ name: 'run-monitor', kind: 'public' }),
      expect.objectContaining({ name: 'approvals', kind: 'public' }),
    ]) });
    const general = channels.data?.find((channel) => channel.name === 'general') as ChannelWire;

    const threadsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/threads`,
    );
    const threads = (await threadsResponse.json()) as Envelope<{ items: readonly ThreadWire[] }>;
    expect(threads.code).toBe(0);
    const thread = threads.data?.items[0] as ThreadWire;

    const createMessage = async (content: string) => authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'message_1',
          client_message_id: 'web_message_1',
          thread_id: thread.id,
          content,
        }),
      },
    );

    const first = (await (await createMessage('hello SpiderByte')).json()) as Envelope<MessageWire>;
    expect(first).toMatchObject({ code: 0, data: { sequence: 1, content: 'hello SpiderByte', state: 'queued' } });

    const replay = (await (await createMessage('hello SpiderByte')).json()) as Envelope<MessageWire>;
    expect(replay).toMatchObject({ code: 0, data: { id: first.data?.id, sequence: 1 } });

    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'different-actor');
    const crossActorReplay = (await (await createMessage('hello SpiderByte')).json()) as Envelope<null>;
    expect(crossActorReplay.code).toBe(40302);
    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'collaboration-user');

    const conflict = (await (await createMessage('different content')).json()) as Envelope<null>;
    expect(conflict.code).toBe(40923);

    const messagesResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages?thread_id=${thread.id}`,
    );
    const messages = (await messagesResponse.json()) as Envelope<{ items: readonly MessageWire[] }>;
    expect(messages).toMatchObject({ code: 0, data: { items: [expect.objectContaining({ content: 'hello SpiderByte' })] } });

    const sessionResponse = await authedFetch(
      server as RunningServer,
      base,
      '/api/v1/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, title: 'collaboration command' }),
      },
    );
    const session = (await sessionResponse.json()) as Envelope<{ id: string }>;
    expect(session.code).toBe(0);

    const commandBody = {
      request_id: 'command_1',
      client_message_id: 'web_command_1',
      thread_id: thread.id,
      content: 'run the collaboration command',
      session_id: session.data?.id,
    };
    const command = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/command`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(commandBody),
      },
    )).json()) as Envelope<{ message: MessageWire; session_id: string; run_id?: string }>;
    expect(command.code).toBe(0);
    expect(command.data?.session_id).toBe(session.data?.id);
    expect(command.data?.message).toMatchObject({
      content: commandBody.content,
      session_id: session.data?.id,
    });
    expect(command.data?.run_id).toEqual(expect.any(String));

    const commandReplay = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/command`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(commandBody),
      },
    )).json()) as Envelope<{ message: MessageWire; session_id: string; run_id?: string }>;
    expect(commandReplay).toMatchObject({
      code: 0,
      data: {
        message: { id: command.data?.message.id },
        run_id: command.data?.run_id,
      },
    });

    const cancellationSession = (await (await authedFetch(
      server as RunningServer,
      base,
      '/api/v1/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, title: 'collaboration cancellation' }),
      },
    )).json()) as Envelope<{ id: string }>;
    const queuedRun = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/sessions/${cancellationSession.data?.id}/runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'cancel_run_create' }),
      },
    )).json()) as Envelope<RunWire>;
    expect(queuedRun).toMatchObject({ code: 0, data: { status: 'queued' } });

    const cancellationMessage = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'cancel_message_create',
          client_message_id: 'cancel_message_1',
          thread_id: thread.id,
          content: 'queued cancellation target',
        }),
      },
    )).json()) as Envelope<MessageWire>;
    expect(cancellationMessage.code).toBe(0);

    const linkedCancellationMessage = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/${cancellationMessage.data?.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'cancel_message_link',
          session_id: cancellationSession.data?.id,
          run_id: queuedRun.data?.id,
          state: 'running',
        }),
      },
    )).json()) as Envelope<MessageWire>;
    expect(linkedCancellationMessage).toMatchObject({
      code: 0,
      data: { run_id: queuedRun.data?.id, state: 'running' },
    });

    const cancel = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/${cancellationMessage.data?.id}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'command_cancel_1',
          reason: 'cancelled by test',
        }),
      },
    )).json()) as Envelope<{ message: MessageWire; session_id: string; run_id?: string }>;
    expect(cancel).toMatchObject({
      code: 0,
      data: {
        message: { id: cancellationMessage.data?.id, state: 'cancelled' },
        run_id: queuedRun.data?.id,
      },
    });

    const commandConflict = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/command`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...commandBody, content: 'different command' }),
      },
    )).json()) as Envelope<null>;
    expect(commandConflict.code).toBe(40923);

    const metadataRejected = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'message_sensitive',
          client_message_id: 'web_message_sensitive',
          thread_id: thread.id,
          content: 'metadata must be safe',
          metadata: { api_key: 'do-not-store' },
        }),
      },
    )).json()) as Envelope<null>;
    expect(metadataRejected.code).toBe(40302);

    const invalidRunLink = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/${command.data?.message.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'message_invalid_run_link',
          session_id: session.data?.id,
          run_id: 'run_not_owned_by_session',
        }),
      },
    )).json()) as Envelope<null>;
    expect(invalidRunLink.code).toBe(40302);

    const invalidArtifactLink = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/${command.data?.message.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'message_invalid_artifact_link',
          session_id: session.data?.id,
          artifact_ids: ['artifact_not_owned_by_workspace'],
        }),
      },
    )).json()) as Envelope<null>;
    expect(invalidArtifactLink.code).toBe(40302);

    const privateResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: 'private_channel',
          kind: 'private',
          name: 'private-test',
          member_ids: ['another-actor'],
        }),
      },
    );
    const privateChannel = (await privateResponse.json()) as Envelope<ChannelWire>;
    expect(privateChannel.code).toBe(0);

    vi.stubEnv('SPIDERBYTE_LOCAL_ACTOR_ID', 'outsider');
    const hiddenList = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels`,
    )).json()) as Envelope<readonly ChannelWire[]>;
    expect(hiddenList.data?.some((channel) => channel.id === privateChannel.data?.id)).toBe(false);

    const forbidden = (await (await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${privateChannel.data?.id}/threads`,
    )).json()) as Envelope<null>;
    expect(forbidden.code).toBe(40302);

    await server?.close();
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home as string,
      logLevel: 'silent',
      delegatedPrincipalSecret: delegatedSecret,
    });
    base = `http://127.0.0.1:${server.port}`;

    const afterRestart = (await (await authedFetch(
      server,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages?thread_id=${thread.id}`,
    )).json()) as Envelope<{ items: readonly MessageWire[] }>;
    expect(afterRestart).toMatchObject({
      code: 0,
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({ sequence: 1 }),
          expect.objectContaining({ sequence: 2, run_id: command.data?.run_id }),
        ]),
      },
    });
  });

  it('does not resolve an unknown workspace through the collaboration surface', async () => {
    const response = await authedFetch(
      server as RunningServer,
      base,
      '/api/v2/workspaces/wd_missing_000000000000/collaboration/channels',
    );
    const body = (await response.json()) as Envelope<null>;
    expect(body).toMatchObject({ code: 40410, data: null });
  });

  it('binds concurrent collaboration requests to their verified delegated principals', async () => {
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: home, name: 'delegated-principal-test' }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    const workspaceId = workspace.data?.id as string;
    const channelsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels`,
    );
    const channels = (await channelsResponse.json()) as Envelope<readonly ChannelWire[]>;
    const general = channels.data?.find((channel) => channel.name === 'general') as ChannelWire;
    const threadsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/threads`,
    );
    const threads = (await threadsResponse.json()) as Envelope<{ items: readonly ThreadWire[] }>;
    const thread = threads.data?.items[0] as ThreadWire;

    const assertion = (actorId: string) => createDelegatedPrincipalAssertion({
      version: 1,
      audience: 'spiderbyte-platform',
      actor_id: actorId,
      subject_id: `subject_${actorId}`,
      issued_at: new Date(Date.now() - 1_000).toISOString(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    }, delegatedSecret);
    const createMessage = (actorId: string, suffix: string) => authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [DELEGATED_PRINCIPAL_HEADER]: assertion(actorId),
        },
        body: JSON.stringify({
          request_id: `delegated_request_${suffix}`,
          client_message_id: `delegated_message_${suffix}`,
          thread_id: thread.id,
          content: `delegated message ${suffix}`,
        }),
      },
    );

    const [firstResponse, secondResponse] = await Promise.all([
      createMessage('actor_a', 'a'),
      createMessage('actor_b', 'b'),
    ]);
    const first = (await firstResponse.json()) as Envelope<MessageWire>;
    const second = (await secondResponse.json()) as Envelope<MessageWire>;
    expect(first).toMatchObject({ code: 0, data: { author_id: 'actor_a' } });
    expect(second).toMatchObject({ code: 0, data: { author_id: 'actor_b' } });

    const signedAssertion = assertion('actor_a');
    const signedParts = signedAssertion.split('.');
    const signature = signedParts[2] as string;
    const tamperedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    const malformed = [signedParts[0], signedParts[1], tamperedSignature].join('.');
    const rejected = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels`,
      { headers: { [DELEGATED_PRINCIPAL_HEADER]: malformed } },
    );
    expect(rejected.status).toBe(401);
  });

  it('streams durable collaboration revisions over an authorized replayable websocket', async () => {
    const workspaceResponse = await authedFetch(server as RunningServer, base, '/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: home, name: 'collaboration-ws-test' }),
    });
    const workspace = (await workspaceResponse.json()) as Envelope<WorkspaceWire>;
    const workspaceId = workspace.data?.id as string;
    const channelsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels`,
    );
    const channels = (await channelsResponse.json()) as Envelope<readonly ChannelWire[]>;
    const general = channels.data?.find((channel) => channel.name === 'general') as ChannelWire;
    const threadsResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/threads`,
    );
    const threads = (await threadsResponse.json()) as Envelope<{ items: readonly ThreadWire[] }>;
    const thread = threads.data?.items[0] as ThreadWire;
    const createMessage = (suffix: string) => authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: `ws_request_${suffix}`,
          client_message_id: `ws_message_${suffix}`,
          thread_id: thread.id,
          content: `websocket message ${suffix}`,
        }),
      },
    );
    const initialResponse = await createMessage('initial');
    const initialEnvelope = (await initialResponse.json()) as Envelope<MessageWire>;
    const initialMessage = initialEnvelope.data as MessageWire;

    const token = server?.authTokenService.getToken() ?? '';
    const ws = new WebSocketClient(
      `ws://127.0.0.1:${server?.port}/api/v2/collaboration/ws`,
      `${WS_BEARER_PROTOCOL_PREFIX}${token}`,
    );
    const queued: unknown[] = [];
    const waiters: Array<{ readonly predicate: (value: unknown) => boolean; readonly resolve: (value: unknown) => void }> = [];
    ws.on('message', (raw) => {
      const value = JSON.parse(raw.toString()) as unknown;
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(value));
      if (waiterIndex >= 0) {
        const waiter = waiters.splice(waiterIndex, 1)[0] as { readonly resolve: (value: unknown) => void };
        waiter.resolve(value);
      } else {
        queued.push(value);
      }
    });
    const next = (predicate: (value: unknown) => boolean): Promise<unknown> => {
      const queuedIndex = queued.findIndex(predicate);
      if (queuedIndex >= 0) return Promise.resolve(queued.splice(queuedIndex, 1)[0]);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    };
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => { resolve(); });
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({
      type: 'subscribe',
      request_id: 'ws_subscribe_initial',
      workspace_id: workspaceId,
      channel_id: general.id,
      thread_id: thread.id,
      after_sequence: 0,
      limit: 20,
    }));
    const ack = await next((value) => isRecord(value) && value['type'] === 'ack');
    expect(ack).toMatchObject({ type: 'ack', code: 0 });
    const initialEvent = await next((value) => isRecord(value) && value['type'] === 'collaboration_message');
    expect(initialEvent).toMatchObject({
      type: 'collaboration_message',
      message: { id: initialMessage.id, content: 'websocket message initial', sequence: 1, event_sequence: 1 },
    });

    const revisionResponse = await authedFetch(
      server as RunningServer,
      base,
      `/api/v2/workspaces/${workspaceId}/collaboration/channels/${general.id}/messages/${initialMessage.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'ws_revision_request', state: 'completed' }),
      },
    );
    expect(revisionResponse.status).toBe(200);
    const revisionEvent = await next((value) => isRecord(value) && value['type'] === 'collaboration_message');
    expect(revisionEvent).toMatchObject({
      type: 'collaboration_message',
      message: { id: initialMessage.id, sequence: 1, event_sequence: 2, state: 'completed' },
    });

    await createMessage('live');
    const liveEvent = await next((value) => isRecord(value) && value['type'] === 'collaboration_message');
    expect(liveEvent).toMatchObject({
      type: 'collaboration_message',
      message: { content: 'websocket message live', sequence: 2, event_sequence: 3 },
    });
    ws.close();
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
