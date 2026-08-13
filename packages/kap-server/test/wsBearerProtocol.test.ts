import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocketClient from 'ws';

import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import {
  WS_BEARER_PROTOCOL_PREFIX,
  WS_DELEGATED_PRINCIPAL_PROTOCOL_PREFIX,
} from '../src/transport/ws/bearerProtocol';
import { createDelegatedPrincipalAssertion } from '../src/services/auth/delegatedPrincipal';

const DELEGATED_SECRET = 'delegated-principal-ws-test-secret-012345';

function openWs(url: string, protocols: string | string[]): Promise<WebSocketClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketClient(url, protocols);
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

describe('server-v2 WS bearer subprotocol', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let wsUrl: string;
  const sockets: WebSocketClient[] = [];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'spiderbyte-server-ws-bearer-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
      delegatedPrincipalSecret: DELEGATED_SECRET,
    });
    wsUrl = `ws://127.0.0.1:${server.port}/api/v1/ws`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      ws.close();
    }
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('accepts a valid bearer subprotocol', async () => {
    const token = server?.authTokenService.getToken() ?? '';
    const ws = await openWs(wsUrl, `${WS_BEARER_PROTOCOL_PREFIX}${token}`);
    sockets.push(ws);
    expect(ws.protocol).toBe(`${WS_BEARER_PROTOCOL_PREFIX}${token}`);
  });

  it('rejects an invalid bearer subprotocol', async () => {
    await expect(openWs(wsUrl, `${WS_BEARER_PROTOCOL_PREFIX}wrong-token`)).rejects.toThrow();
  });

  it('accepts a short-lived delegated identity subprotocol without a daemon bearer', async () => {
    const assertion = createDelegatedPrincipalAssertion({
      version: 1,
      audience: 'spiderbyte-platform',
      actor_id: 'usr_ws_example',
      subject_id: 'clerk_ws_example',
      issued_at: new Date(Date.now() - 1_000).toISOString(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    }, DELEGATED_SECRET);
    const protocol = `${WS_DELEGATED_PRINCIPAL_PROTOCOL_PREFIX}${assertion}`;
    const ws = await openWs(wsUrl, protocol);
    sockets.push(ws);
    expect(ws.protocol).toBe(protocol);
  });
});
