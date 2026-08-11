import type { McpServerStdioConfig } from '#/config/schema';
import { type UnexpectedCloseListener } from './client-shared';
import type { MCPClient, MCPToolDefinition, MCPToolResult } from './types';
export interface StdioMcpClientOptions {
    readonly clientName?: string;
    readonly clientVersion?: string;
    readonly startupTimeoutMs?: number;
    readonly toolCallTimeoutMs?: number;
    readonly defaultCwd?: string;
}
/**
 * Wraps the `@modelcontextprotocol/sdk` stdio client and exposes the small
 * surface required by kosong's {@link MCPClient}. Lifecycle is explicit:
 * the caller must `connect()` before use and `close()` to terminate the
 * child process.
 */
export declare class StdioMcpClient implements MCPClient {
    private readonly client;
    private readonly transport;
    private readonly startupTimeoutMs?;
    private readonly toolCallTimeoutMs?;
    private readonly stderrBuffer;
    private started;
    private closed;
    private ready;
    private hooksInstalled;
    private unexpectedCloseListener;
    private lastTransportError;
    private pendingUnexpectedClose;
    /** Capacity (in characters) of the stderr tail captured for diagnostics. */
    static readonly stderrBufferCapacity: number;
    constructor(config: McpServerStdioConfig, options?: StdioMcpClientOptions);
    connect(): Promise<void>;
    close(): Promise<void>;
    /**
     * Register a listener that fires when the underlying transport closes on
     * its own — i.e. the caller has not yet invoked {@link close}. At most one
     * listener can be installed; later registrations replace earlier ones.
     * Intentional closes never invoke the listener.
     *
     * If the transport already closed before this method was called, the
     * buffered reason is replayed synchronously so the close is never dropped.
     */
    onUnexpectedClose(listener: UnexpectedCloseListener): void;
    /**
     * Returns the tail of bytes captured from the child's stderr since spawn.
     * Bounded by {@link StdioMcpClient.stderrBufferCapacity} so a noisy server
     * cannot exhaust memory.
     */
    stderrSnapshot(): string;
    listTools(): Promise<MCPToolDefinition[]>;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<MCPToolResult>;
    private closeStartedClient;
    private installTransportHooks;
}
export declare function resolveStdioCwd(configCwd: string | undefined, defaultCwd: string | undefined): string | undefined;
export declare function mergeStdioEnv(configEnv?: Record<string, string>, parentEnv?: Readonly<Record<string, string | undefined>>): Record<string, string>;
