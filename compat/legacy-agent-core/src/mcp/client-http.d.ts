import type { McpServerHttpConfig } from '#/config/schema';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { type UnexpectedCloseListener } from './client-shared';
import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';
export interface HttpMcpClientOptions {
    readonly clientName?: string;
    readonly clientVersion?: string;
    readonly startupTimeoutMs?: number;
    readonly toolCallTimeoutMs?: number;
    /**
     * Reads `process.env[name]` by default. Tests can inject a deterministic
     * lookup function so they do not have to mutate global env.
     */
    readonly envLookup?: (name: string) => string | undefined;
    /**
     * Lets tests inject a fake `fetch` for the underlying transport.
     */
    readonly fetch?: typeof fetch;
    /**
     * OAuth client provider attached to the transport. Set only when the server
     * has no static token configuration; the SDK uses this to handle 401s with
     * RFC 9728 / RFC 8414 / DCR discovery and PKCE. The connection manager wires
     * this in and surfaces `UnauthorizedError` as a `needs-auth` status.
     */
    readonly oauthProvider?: OAuthClientProvider;
}
/**
 * Wraps the SDK streamable-HTTP transport as a kosong {@link MCPClient}.
 * Static bearer tokens are looked up from `process.env[bearerTokenEnvVar]`.
 * OAuth providers are attached separately by the connection manager.
 */
export declare class HttpMcpClient implements MCPClient {
    private readonly client;
    private readonly transport;
    private readonly startupTimeoutMs?;
    private readonly toolCallTimeoutMs?;
    private started;
    private closed;
    private ready;
    private hooksInstalled;
    private unexpectedCloseListener;
    private lastTransportError;
    private pendingUnexpectedClose;
    private unexpectedCloseFired;
    constructor(config: McpServerHttpConfig, options?: HttpMcpClientOptions);
    connect(): Promise<void>;
    close(): Promise<void>;
    /**
     * Register a listener for unsolicited transport drops. See
     * `StdioMcpClient.onUnexpectedClose` for semantics. If the transport
     * already signalled a terminal failure, the buffered reason is replayed
     * synchronously.
     */
    onUnexpectedClose(listener: UnexpectedCloseListener): void;
    listTools(): Promise<MCPToolDefinition[]>;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<MCPToolResult>;
    private closeStartedClient;
    private installTransportHooks;
    private fireUnexpectedClose;
}
/**
 * Returns true when an error reported via `Client.onerror` indicates the
 * underlying HTTP transport is dead. The streamable-http SDK does not call
 * `onclose` for remote disconnects; instead it surfaces them through
 * `onerror`, but only a few specific messages mean "give up" rather than
 * "we will retry":
 *
 * - `UnauthorizedError` — RFC 9728/8414 auth flow gave up; the SDK won't
 *   retry without a fresh provider call.
 * - "Maximum reconnection attempts ... exceeded." — emitted from
 *   `_scheduleReconnection` after the SSE reconnect budget is gone
 *   (`streamableHttp.js`, `_scheduleReconnection`).
 *
 * Transient signals (per-request fetch failures, single SSE flaps that the
 * SDK is about to reconnect from) MUST NOT match; otherwise a brief network
 * blip would tear down every HTTP MCP entry.
 */
export declare function isTerminalTransportError(error: Error): boolean;
export declare function buildMcpHttpHeaders(config: McpServerHttpConfig, envLookup: (name: string) => string | undefined): Record<string, string> | undefined;
