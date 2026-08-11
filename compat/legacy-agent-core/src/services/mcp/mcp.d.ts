/**
 * `IMcpService` — daemon-facing MCP server surface.
 *
 * Wraps `ICoreProcessService.rpc.{listMcpServers, reconnectMcpServer}` and adapts
 * the agent-core `McpServerInfo` shape into SCHEMAS §8 `McpServer`. The
 * adapter helper (`toProtocolMcpServer`) is co-located here.
 *
 * **CoreAPI surface used**:
 *   - `core.rpc.listMcpServers({}) => readonly McpServerInfo[]`
 *     (packages/agent-core/src/rpc/core-api.ts:344).
 *   - `core.rpc.reconnectMcpServer({name})` (line 346).
 *
 * **Server identity**: REST.md §3.8 uses `{mcp_server_id}` in the path;
 * agent-core surfaces only `name`. We treat name-as-id at the wire boundary
 * (stable within a daemon process lifetime).
 *
 * **Error model**:
 *   - `MCP_SERVER_NOT_FOUND` (40408) is raised by the impl via
 *     `McpServerNotFoundError`. The route maps it to envelope code 40408.
 *
 * **Anti-corruption**: imports `@spiderbyte/legacy-agent-core` only for the
 * `createDecorator` value and the `McpServerInfo` type.
 *
 * **MCP status mapping** (`McpServerInfo.status` → `McpServer.status`):
 *   agent-core 'pending'    → wire 'connecting'
 *   agent-core 'connected'  → wire 'connected'
 *   agent-core 'failed'     → wire 'error'
 *   agent-core 'disabled'   → wire 'disconnected'
 *   agent-core 'needs-auth' → wire 'error'   (last_error carries the hint)
 *   agent-core 'removed'    → wire 'disconnected' (v2-only tombstone status)
 *
 * **MCP id**: agent-core's `McpServerInfo` has only `name`. We adopt
 * name-as-id at the wire boundary. Both are 1:1 within a daemon process.
 */
import type { McpServerInfo } from '../../rpc';
import type { McpServer } from '@spiderbyte/protocol';
export declare function toProtocolMcpServer(info: McpServerInfo): McpServer;
export interface IMcpService {
    readonly _serviceBrand: undefined;
    /** Return all MCP servers known to the in-process KimiCore. */
    list(): Promise<readonly McpServer[]>;
    /**
     * Trigger an MCP server reconnect. Returns `{ restarting: true }` on a
     * successful enqueue. Throws `McpServerNotFoundError` (→ 40408) when the
     * server id is not registered.
     */
    restart(serverId: string): Promise<{
        restarting: true;
    }>;
}
export declare const IMcpService: import("../..").ServiceIdentifier<IMcpService>;
/**
 * Sentinel — daemon's route layer catches this and maps to envelope `code:
 * 40408 mcp.server_not_found`. Other thrown errors fall through to
 * `installErrorHandler` (→ 50001).
 */
export declare class McpServerNotFoundError extends Error {
    readonly serverId: string;
    constructor(serverId: string);
}
