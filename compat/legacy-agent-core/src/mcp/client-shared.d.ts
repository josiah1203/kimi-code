import type { MCPToolDefinition, MCPToolResult } from './types';
export declare const KIMI_MCP_CLIENT_NAME = "kimi-code";
export declare const KIMI_MCP_CLIENT_VERSION: string;
/**
 * Why-context attached when a runtime client notices its underlying transport
 * has gone away on its own — i.e. {@link RuntimeMcpClient.close} was NOT
 * called. The connection manager turns this into a `failed` status so the
 * UI/SDK do not keep advertising tools backed by a dead transport.
 *
 * - `error` is the last error reported via the SDK's `onerror` channel, if
 *   any. Useful for HTTP where there is no stderr.
 * - `stderr` is the tail of bytes captured from the child process's stderr;
 *   populated only for the stdio transport.
 */
export interface UnexpectedCloseReason {
    readonly error?: Error;
    readonly stderr?: string;
}
export type UnexpectedCloseListener = (reason: UnexpectedCloseReason) => void;
export interface McpRequestOptions {
    readonly timeout?: number;
    readonly signal?: AbortSignal;
}
/**
 * Build the `RequestOptions` object accepted by MCP SDK requests, including
 * either a configured timeout, an in-flight abort signal, both, or neither.
 * Returns `undefined` when nothing needs to be passed so the SDK falls back
 * to its defaults.
 */
export declare function buildRequestOptions(timeoutMs: number | undefined, signal: AbortSignal | undefined): McpRequestOptions | undefined;
interface SdkListedTool {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Record<string, unknown>;
}
export declare function toMcpToolDefinition(tool: SdkListedTool): MCPToolDefinition;
/**
 * Normalise the SDK's `callTool` return into kosong's {@link MCPToolResult}.
 * The SDK can return either the modern `{ content, isError }` shape or a
 * legacy `{ toolResult }` shape; we collapse the legacy shape to a single
 * text content block.
 */
export declare function toMcpToolResult(result: unknown): MCPToolResult;
export {};
