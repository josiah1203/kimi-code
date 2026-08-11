import { type McpServerConfig } from '#/config/schema';
import type { Logger } from '#/logging/types';
import type { Tool } from '@spiderbyte/kosong';
import type { McpOAuthService } from './oauth';
import { type MCPClient, type MCPToolDefinition } from './types';
export type McpServerStatus = 'pending' | 'connected' | 'failed' | 'disabled' | 'needs-auth';
export interface McpServerEntry {
    readonly name: string;
    readonly transport: McpServerConfig['transport'];
    readonly status: McpServerStatus;
    readonly toolCount: number;
    readonly error?: string;
}
export type McpStatusListener = (entry: McpServerEntry) => void;
export declare const MCP_STARTUP_TIMEOUT_ENV = "KIMI_MCP_STARTUP_TIMEOUT_MS";
export declare const MCP_TOOL_TIMEOUT_ENV = "KIMI_MCP_TOOL_TIMEOUT_MS";
/**
 * Resolve the global default MCP server startup (connect + tool discovery)
 * timeout. Precedence: `KIMI_MCP_STARTUP_TIMEOUT_MS` (integer ms) →
 * `configMs` (`[mcp] startup_timeout_ms`) → `undefined` (the manager's
 * built-in default applies). A per-server `startupTimeoutMs` in `mcp.json`
 * always wins over the resolved value.
 */
export declare function resolveMcpStartupTimeoutMs(configMs?: number): number | undefined;
/**
 * Resolve the global default single MCP tool-call timeout. Precedence:
 * `KIMI_MCP_TOOL_TIMEOUT_MS` (integer ms) → `configMs`
 * (`[mcp] tool_timeout_ms`) → `undefined` (the client built-in default
 * applies). A per-server `toolTimeoutMs` in `mcp.json` always wins over the
 * resolved value.
 */
export declare function resolveMcpToolTimeoutMs(configMs?: number): number | undefined;
export interface McpConnectionManagerOptions {
    readonly envLookup?: (name: string) => string | undefined;
    readonly stdioCwd?: string;
    /**
     * Optional OAuth orchestrator. When provided, remote servers without a
     * static bearer token participate in the OAuth-via-synthetic-tool flow:
     *  - If `oauthService.hasTokens(name, url)` is true, the provider is
     *    attached to the transport so the SDK can refresh tokens on 401.
     *  - Connection failures that look like 401 / `UnauthorizedError` flip
     *    the entry into `needs-auth` instead of `failed`; `/mcp-config`
     *    drives the browser flow through the synthetic auth tool.
     */
    readonly oauthService?: McpOAuthService;
    /**
     * Parent logger. Defaults to the global `log`; Session passes its own
     * `session.log` so MCP events land in the session log too.
     */
    readonly log?: Logger;
    /**
     * Global default startup (connect + tool discovery) timeout applied when a
     * server entry does not set its own `startupTimeoutMs`. Falls back to the
     * built-in default when unset.
     */
    readonly defaultStartupTimeoutMs?: number;
    /**
     * Global default single tool-call timeout applied when a server entry does
     * not set its own `toolTimeoutMs`. Falls back to the client built-in when
     * unset.
     */
    readonly defaultToolTimeoutMs?: number;
}
/**
 * Owns the lifecycle of every configured MCP server for a Session.
 *
 * Servers are connected in parallel; per-server failures are isolated so a
 * crashed or misconfigured entry never blocks Session startup. State
 * transitions are surfaced through {@link onStatusChange} so callers (the
 * Session) can react — registering tools onto the main agent, emitting
 * wire events, or updating the TUI.
 */
export declare class McpConnectionManager {
    private readonly options;
    private readonly entries;
    private readonly listeners;
    private initialLoad;
    private initialLoadAttemptId;
    private initialLoadStartedAt;
    private initialLoadFinishedAt;
    /**
     * OAuth orchestrator injected at construction time. Consumed by the
     * {@link ToolManager} `needs-auth` branch to build the synthetic
     * `authenticate` tool.
     */
    readonly oauthService: McpOAuthService | undefined;
    private readonly log;
    constructor(options?: McpConnectionManagerOptions);
    /**
     * Returns the URL of a remote MCP server by name, or `undefined` for
     * unknown / non-remote / disabled entries. Used by the synthetic auth tool
     * to drive OAuth discovery against the right base URL.
     */
    getRemoteServerUrl(name: string): string | undefined;
    /**
     * @deprecated Use {@link getRemoteServerUrl}. Kept for in-repo callers that
     * were written before legacy SSE support shared the same OAuth path.
     */
    getHttpServerUrl(name: string): string | undefined;
    onStatusChange(listener: McpStatusListener): () => void;
    list(): readonly McpServerEntry[];
    get(name: string): McpServerEntry | undefined;
    /**
     * Returns the MCP client, the discovered tools, and the allow-list of tool
     * names for a given connected server, or `undefined` if the server is not
     * currently connected. The allow-list combines the server's `enabledTools`
     * and `disabledTools` filters; callers should only register names in the
     * set.
     */
    resolved(name: string): {
        client: MCPClient;
        tools: readonly Tool[];
        rawTools: readonly MCPToolDefinition[];
        enabledNames: ReadonlySet<string>;
    } | undefined;
    connectAll(configs: Record<string, McpServerConfig>): Promise<void>;
    connect(name: string, config: McpServerConfig): Promise<void>;
    remove(name: string): Promise<boolean>;
    waitForInitialLoad(signal?: AbortSignal): Promise<void>;
    initialLoadDurationMs(): number;
    private connectAllNow;
    reconnect(name: string): Promise<void>;
    shutdown(): Promise<void>;
    private connectOne;
    private watchForUnexpectedClose;
    private beginConnectAttempt;
    private createClient;
    private resolveOAuthProvider;
    private shouldMarkNeedsAuth;
    private connectAndDiscoverTools;
    private closeClient;
    private closeRuntimeClient;
    private isCurrent;
    private emit;
}
