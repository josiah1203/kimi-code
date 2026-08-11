/**
 * Synthetic `mcp__<server>__authenticate` tool.
 *
 * When a remote MCP server lands in the `needs-auth` state — i.e. its
 * initial connection failed with a 401 / `UnauthorizedError` and no static
 * bearer token is configured — the {@link ToolManager} swaps the real MCP
 * tool list for this single tool. Calling it:
 *
 *  1. Asks {@link McpOAuthService} to perform RFC 9728 / RFC 8414 / RFC 7591
 *     discovery and produce an authorization URL.
 *  2. Streams that URL back to the model via `onUpdate({kind:'status'})`
 *     and returns it in the tool output so the model can hand it to the
 *     human user.
 *  3. Blocks (up to {@link DEFAULT_AUTH_TIMEOUT_MS}) on the one-shot
 *     localhost callback listener owned by the OAuth service.
 *  4. Drives a manager-level `reconnect(name)` once tokens have been
 *     persisted, which flips the entry to `connected` and lets
 *     `ToolManager` swap the synthetic tool out for the real MCP tools.
 *
 * The blocking shape (option 1 in the plan) keeps the implementation
 * simple at the cost of holding one tool call open for the duration of
 * the human's browser flow. If the model ends up re-invoking the tool
 * mid-flow we just start a fresh flow; the new callback server supersedes
 * the old one.
 */
import { type ExecutableTool } from '../loop';
import { type McpOAuthService } from './oauth';
export interface CreateMcpAuthToolOptions {
    /** Friendly MCP server name as configured in `mcp.json`. */
    readonly serverName: string;
    /** Base URL of the MCP server (used for OAuth resource metadata discovery). */
    readonly serverUrl: string;
    /** OAuth orchestrator, typically `Session`-scoped. */
    readonly oauthService: McpOAuthService;
    /**
     * Triggers a manager-level reconnect once tokens land on disk. Implemented
     * by the {@link McpConnectionManager} and bound in the {@link ToolManager}
     * `needs-auth` branch.
     */
    readonly reconnect: (signal?: AbortSignal) => Promise<void>;
    /**
     * Overrides the per-call OAuth wait timeout. Tests set this to a small
     * number; production callers should accept the default.
     */
    readonly timeoutMs?: number;
}
export declare function createMcpAuthTool(options: CreateMcpAuthToolOptions): ExecutableTool;
