/** Stateless Streamable HTTP route for the headless SpiderByte MCP adapter. */

import type { FastifyInstance } from 'fastify';
import {
  createMcpHandler,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { Scope } from '@spiderbyte/agent-core';

import {
  createSpyderbyteMcpServer,
  type SpyderbyteMcpOptions,
  type SpyderbyteMcpProfile,
} from './server';
import type { ServerLogger } from '../services/pinoLoggerService';

const MCP_CORS_HEADERS =
  'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name';
const MCP_EXPOSE_HEADERS = 'MCP-Protocol-Version';
const MAX_REQUESTS_PER_WINDOW = 120;
const REQUEST_WINDOW_MS = 60_000;

export interface RegisterMcpRoutesOptions {
  readonly logger?: ServerLogger;
  readonly profile?: SpyderbyteMcpProfile;
  readonly defaultWorkspaceId?: string;
  readonly actorId?: string;
}

interface RateEntry {
  readonly requests: number[];
}

/**
 * Create the current MCP HTTP handler for tests, fetch-native deployments, and
 * the Fastify adapter below. The v2 SDK owns protocol classification and
 * creates a fresh server instance for every HTTP request. Legacy clients are
 * supported only through the SDK's stateless fallback; no protocol session is
 * retained and no `Mcp-Session-Id` is issued.
 */
export function createSpyderbyteMcpHandler(
  core: Scope,
  options: RegisterMcpRoutesOptions = {},
): McpHttpHandler {
  const serverOptions: SpyderbyteMcpOptions = {
    core,
    mode: 'local-http',
    profile: options.profile,
    defaultWorkspaceId: options.defaultWorkspaceId,
    actorId: options.actorId,
    clientName: 'streamable-http',
    logger: options.logger,
  };

  return createMcpHandler(
    () => createSpyderbyteMcpServer(serverOptions),
    {
      legacy: 'stateless',
      responseMode: 'auto',
      onerror: (error) => {
        options.logger?.warn(
          { err: error.message },
          'MCP handler error',
        );
      },
    },
  );
}

/**
 * Register the MCP endpoint. Authentication and host/origin checks are
 * installed by `startServer` before this route is registered. The endpoint
 * owns only HTTP adaptation, rate limiting, and lifecycle; protocol behavior
 * is delegated to the official 2026-07-28 handler.
 */
export async function registerMcpRoutes(
  app: FastifyInstance,
  core: Scope,
  options: RegisterMcpRoutesOptions = {},
): Promise<void> {
  const rateEntries = new Map<string, RateEntry>();
  const mcpHandler = createSpyderbyteMcpHandler(core, options);
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => {
      options.logger?.warn({ err: error.message }, 'MCP Node adapter error');
    },
  });
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - REQUEST_WINDOW_MS;
    for (const [source, entry] of rateEntries) {
      entry.requests.splice(0, entry.requests.length, ...entry.requests.filter((at) => at > cutoff));
      if (entry.requests.length === 0) rateEntries.delete(source);
    }
  }, REQUEST_WINDOW_MS);
  cleanupTimer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
    rateEntries.clear();
    await mcpHandler.close();
  });

  app.route({
    method: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    url: '/mcp',
    handler: async (request, reply) => {
      reply.header('Access-Control-Expose-Headers', MCP_EXPOSE_HEADERS);
      reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', MCP_CORS_HEADERS);

      if (request.method === 'OPTIONS') {
        return reply.code(204).send();
      }

      const source = request.ip || 'unknown';
      if (!allowRequest(rateEntries, source)) {
        return reply
          .code(429)
          .header('Retry-After', '60')
          .send({ error: 'mcp_rate_limited', message: 'MCP request rate limit exceeded' });
      }

      // Fastify has already parsed JSON for this route. Passing the parsed body
      // prevents the Node adapter from attempting to consume the raw stream
      // twice. The handler itself remains stateless and owns protocol errors.
      reply.hijack();
      try {
        await nodeHandler(request.raw, reply.raw, request.body);
      } catch (error) {
        options.logger?.warn(
          { err: error instanceof Error ? error.message : String(error), requestId: request.id },
          'MCP request failed',
        );
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.end(JSON.stringify({ error: 'mcp_request_failed', request_id: request.id }));
        }
      }
    },
  });
}

function allowRequest(entries: Map<string, RateEntry>, source: string): boolean {
  const now = Date.now();
  const cutoff = now - REQUEST_WINDOW_MS;
  const entry = entries.get(source) ?? { requests: [] };
  entry.requests.splice(0, entry.requests.length, ...entry.requests.filter((at) => at > cutoff));
  if (entry.requests.length >= MAX_REQUESTS_PER_WINDOW) {
    entries.set(source, entry);
    return false;
  }
  entry.requests.push(now);
  entries.set(source, entry);
  return true;
}
