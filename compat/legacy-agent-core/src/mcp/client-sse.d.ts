import type { McpServerSseConfig } from '#/config/schema';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { type UnexpectedCloseListener } from './client-shared';
import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';
export interface SseMcpClientOptions {
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
     * has no static token configuration; the connection manager wires this in
     * and surfaces `UnauthorizedError` as a `needs-auth` status.
     */
    readonly oauthProvider?: OAuthClientProvider;
}
/**
 * Wraps the SDK's deprecated HTTP+SSE transport as a kosong
 * {@link MCPClient}. This exists for compatibility with older MCP servers;
 * new remote servers should prefer streamable HTTP.
 */
export declare class SseMcpClient implements MCPClient {
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
    constructor(config: McpServerSseConfig, options?: SseMcpClientOptions);
    connect(): Promise<void>;
    close(): Promise<void>;
    /**
     * Register a listener for unsolicited terminal transport drops. Brief SSE
     * stream flaps are left to EventSource's retry loop; terminal HTTP status
     * errors after startup remove the tools from the agent.
     */
    onUnexpectedClose(listener: UnexpectedCloseListener): void;
    listTools(): Promise<MCPToolDefinition[]>;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<MCPToolResult>;
    private closeStartedClient;
    private installTransportHooks;
    private fireUnexpectedClose;
}
export declare function isTerminalSseTransportError(error: Error): boolean;
