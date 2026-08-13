import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/server';
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import type { Scope } from '@spiderbyte/agent-core';
import { createSpyderbyteMcpHandler } from '../src/mcp/routes';
import {
  createSpyderbyteMcpServer,
  SPIDERBYTE_MCP_CURATED_TOOLS,
  SPIDERBYTE_MCP_PROTOCOL_VERSION,
} from '../src/mcp/server';
import { startServer, type RunningServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

describe('SpiderByte MCP adapter', () => {
  it('publishes modern tool metadata and headless structured results', async () => {
    const handler = createSpyderbyteMcpHandler(fakeCore());
    const discovery = await sendModern(handler, modernMessage('server/discover', 'discover-1'));
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get('mcp-session-id')).toBeNull();
    const discoveryBody = await discovery.json() as JsonRpcResponse;
    expect(discoveryBody.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: expect.arrayContaining([SPIDERBYTE_MCP_PROTOCOL_VERSION]),
    });
    expect(discoveryBody.result?._meta).toMatchObject({
      [SERVER_INFO_META_KEY]: {
        name: 'spiderbyte',
        version: SPIDERBYTE_MCP_PROTOCOL_VERSION,
      },
    });
    const rawCall = await sendModern(handler, modernMessage('tools/call', 'call-1', {
      name: 'spiderbyte_capabilities',
      arguments: {},
    }));
    expect((await rawCall.json() as JsonRpcResponse).result?.resultType).toBe('complete');

    const transport = new StreamableHTTPClientTransport(new URL('http://spiderbyte.test/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client(
      { name: 'mcp-contract-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: SPIDERBYTE_MCP_PROTOCOL_VERSION } } },
    );
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools.length).toBeGreaterThan(30);
      expect(tools.map((tool) => tool.name)).toContain('spiderbyte_capabilities');
      expect(tools.map((tool) => tool.name)).toContain('search');
      for (const tool of tools) {
        expect(tool.description?.startsWith('Use when')).toBe(true);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        expect(tool.annotations?.readOnlyHint).toBeDefined();
        expect(tool.annotations?.openWorldHint).toBeDefined();
        expect(tool.annotations?.destructiveHint).toBeDefined();
      }

      const capabilities = await client.callTool({ name: 'spiderbyte_capabilities', arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({
        status: 'ok',
        capability_status: 'local-only',
      });

      const unavailable = await client.callTool({
        name: 'spiderbyte_explain_unavailable',
        arguments: { capability: 'submit_hosted_job' },
      });
      expect(unavailable.structuredContent).toMatchObject({
        status: 'ok',
        capability_status: 'hosted-required',
      });
      expect(JSON.stringify(unavailable.structuredContent)).toContain('Hosted compute');

      const malformed = await client.callTool({
        name: 'spiderbyte_explain_unavailable',
        arguments: { capability: 'not-a-capability' },
      });
      expect(malformed.isError).toBe(true);
      expect(malformed.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text' }),
      ]));
    } finally {
      await client.close().catch(() => undefined);
      await handler.close().catch(() => undefined);
    }
  });

  it('serves modern discovery over stdio without a protocol session', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handle = serveStdio(
      () => createSpyderbyteMcpServer({
        core: fakeCore(),
        mode: 'local-stdio',
      }),
      {
        legacy: 'reject',
        transport: new StdioServerTransport(input, output),
      },
    );
    try {
      input.write(`${JSON.stringify(modernMessage('server/discover', 'stdio-discover-1'))}\n`);
      const response = JSON.parse(await readLine(output)) as JsonRpcResponse;
      expect(response.result).toMatchObject({
        resultType: 'complete',
        supportedVersions: expect.arrayContaining([SPIDERBYTE_MCP_PROTOCOL_VERSION]),
      });
    } finally {
      await handle.close().catch(() => undefined);
      input.end();
    }
  });

  it('exposes only the semantic Otis contract in the curated profile', async () => {
    const handler = createSpyderbyteMcpHandler(fakeCore(), { profile: 'curated' });
    const transport = new StreamableHTTPClientTransport(new URL('http://spiderbyte.test/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client(
      { name: 'otis-curated-contract-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: SPIDERBYTE_MCP_PROTOCOL_VERSION } } },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(new Set(tools.tools.map((tool) => tool.name)).size).toBe(SPIDERBYTE_MCP_CURATED_TOOLS.length);
      expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual([...SPIDERBYTE_MCP_CURATED_TOOLS].toSorted());
      expect(tools.tools.some((tool) => tool.name.startsWith('spiderbyte_'))).toBe(false);

      const cancel = tools.tools.find((tool) => tool.name === 'cancel_run');
      expect(cancel?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      expect(cancel?.inputSchema).toMatchObject({
        type: 'object',
        properties: expect.objectContaining({ confirmed: expect.anything() }),
      });

      const capabilities = await client.callTool({ name: 'get_capabilities', arguments: {} });
      expect(capabilities.structuredContent).toMatchObject({
        status: 'ok',
        data: {
          mcp_profile: 'curated',
          curated_tools: expect.arrayContaining(['train_baseline_model', 'run_sql_analysis']),
        },
      });

      const unsupported = await sendModern(handler, modernMessage('tools/call', 'curated-unsupported-1', {
        name: 'spiderbyte_capabilities',
        arguments: {},
      }));
      expect((await unsupported.json() as JsonRpcResponse).error).toBeDefined();
    } finally {
      await client.close().catch(() => undefined);
      await handler.close().catch(() => undefined);
    }
  });

  it('protects Streamable HTTP with the existing bearer boundary', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spiderbyte-mcp-test-'));
    let server: RunningServer | undefined;
    try {
      server = await startServer({
        hostIdentity: TEST_HOST_IDENTITY,
        host: '127.0.0.1',
        port: 0,
        homeDir: home,
        logLevel: 'silent',
      });
      const base = `http://127.0.0.1:${server.port}/mcp`;
      const unauthorized = await fetch(base, { method: 'POST', body: '{}' });
      expect(unauthorized.status).toBe(401);

      const auth = `Bearer ${server.authTokenService.getToken()}`;
      const discoveryMessage = modernMessage('server/discover', 'discover-http-1');
      const discovery = await fetch(base, {
        method: 'POST',
        headers: {
          Authorization: auth,
          ...modernHeaders(discoveryMessage),
        },
        body: JSON.stringify(discoveryMessage),
      });
      expect(discovery.status).toBe(200);
      expect(discovery.headers.get('mcp-session-id')).toBeNull();
      const discoveryBody = await discovery.json() as JsonRpcResponse;
      expect(discoveryBody.result).toMatchObject({
        resultType: 'complete',
        supportedVersions: expect.arrayContaining([SPIDERBYTE_MCP_PROTOCOL_VERSION]),
      });

      const missingMethodMessage = modernMessage('tools/list', 'missing-method-1');
      const missingMethod = await fetch(base, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': SPIDERBYTE_MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify(missingMethodMessage),
      });
      expect(missingMethod.status).toBe(400);
      expect((await missingMethod.json() as JsonRpcResponse).error?.code).toBe(-32020);

      const client = new Client(
        { name: 'mcp-http-test', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: SPIDERBYTE_MCP_PROTOCOL_VERSION } } },
      );
      const transport = new StreamableHTTPClientTransport(new URL(base), {
        requestInit: {
          headers: {
            Authorization: auth,
          },
        },
      });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain('spiderbyte_capabilities');
        const result = await client.callTool({ name: 'spiderbyte_capabilities', arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ status: 'ok' });
      } finally {
        await client.close().catch(() => undefined);
      }
    } finally {
      await server?.close();
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
});

function fakeCore(): Scope {
  return {
    accessor: {
      get: () => {
        throw new Error('service not required for metadata contract test');
      },
    },
  } as unknown as Scope;
}

interface JsonRpcResponse {
  readonly result?: {
    readonly resultType?: string;
    readonly supportedVersions?: readonly string[];
    readonly _meta?: Record<string, unknown>;
  };
  readonly error?: { readonly code?: number };
}

function modernMessage(method: string, id: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: SPIDERBYTE_MCP_PROTOCOL_VERSION,
        [CLIENT_INFO_META_KEY]: { name: 'mcp-contract-test', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  };
}

function modernHeaders(message: Record<string, unknown>): Record<string, string> {
  const params = message['params'] as Record<string, unknown>;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': SPIDERBYTE_MCP_PROTOCOL_VERSION,
    'Mcp-Method': String(message['method']),
  };
  if (message['method'] === 'tools/call' || message['method'] === 'prompts/get' || message['method'] === 'resources/read') {
    const name = params['name'] ?? params['uri'];
    if (typeof name === 'string') headers['Mcp-Name'] = name;
  }
  return headers;
}

async function sendModern(
  handler: ReturnType<typeof createSpyderbyteMcpHandler>,
  message: Record<string, unknown>,
): Promise<Response> {
  return handler.fetch(new Request('http://spiderbyte.test/mcp', {
    method: 'POST',
    headers: modernHeaders(message),
    body: JSON.stringify(message),
  }));
}

async function readLine(stream: PassThrough): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const onData = (chunk: Buffer | string): void => {
      buffered += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      stream.off('data', onData);
      stream.off('error', onError);
      resolve(buffered.slice(0, newline));
    };
    const onError = (error: Error): void => {
      stream.off('data', onData);
      reject(error);
    };
    stream.on('data', onData);
    stream.once('error', onError);
  });
}
