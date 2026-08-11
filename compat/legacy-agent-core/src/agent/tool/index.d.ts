import type { Tool } from '@spiderbyte/kosong';
import type { Agent } from '..';
import type { ContextMessage } from '../context/types';
import type { ExecutableTool } from '../../loop';
import type { MCPClient } from '../../mcp/types';
import * as b from '../../tools/builtin';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../tools/store';
import type { BuiltinTool, McpServerRegistrationResult, ToolInfo, UserToolRegistration } from './types';
export * from './types';
interface McpToolEntry {
    readonly tool: ExecutableTool;
    readonly serverName: string;
}
export declare class ToolManager {
    protected readonly agent: Agent;
    protected builtinTools: Map<string, BuiltinTool>;
    protected readonly userTools: Map<string, ExecutableTool>;
    private readonly deferredUserTools;
    protected readonly mcpTools: Map<string, McpToolEntry>;
    private loopToolsOverride;
    /** server name → list of qualified tool names registered for that server. */
    protected readonly mcpToolsByServer: Map<string, string[]>;
    protected enabledTools: Set<string>;
    /** Glob patterns (e.g. `mcp__*`, `mcp__github__*`) gating which MCP tools the profile exposes. */
    private mcpAccessPatterns;
    /**
     * Exact builtin/user tool names the profile denies, evaluated on top of the
     * allowlist result (`enabledTools`).
     */
    private disabledTools;
    /** Glob patterns (`mcp__…`) the profile denies, evaluated on top of `mcpAccessPatterns`. */
    private mcpDenyPatterns;
    /**
     * Defer-window lead for the loaded-tools ledger: names marked loaded whose
     * schema message may still sit in the context's deferred queue (an open tool
     * exchange). The history itself is the source of truth —
     * `loadedDynamicToolNames()` unions this set with a history scan — so
     * undo/compaction/resume never need to roll this back.
     */
    private readonly pendingLoadedDynamicTools;
    protected readonly store: Partial<ToolStoreData>;
    private mcpToolStatusUnsubscribe;
    /**
     * `serverName\nhash` keys of `mcp.tools_discovered` records already durable
     * in this wire log. Restored on replay; reconnects with an unchanged raw
     * tool list, allow-list, and collision outcome do not re-log.
     */
    private readonly seenMcpDiscoveries;
    /**
     * Discoveries observed before the record log opened (constructor-time
     * attach can run before `agent.resume()` replays the wire — see
     * `AgentRecords.observabilityReady`). The dedup decision must be re-made at
     * drain time, after replay has restored `seenMcpDiscoveries`.
     */
    private readonly pendingMcpDiscoveries;
    private mcpDiscoveryDrainSubscribed;
    /** Abort controllers for in-flight `!` shell commands, keyed by commandId so
     *  the TUI can cancel (Esc / Ctrl+C) a running command. */
    private readonly shellCommandControllers;
    constructor(agent: Agent);
    protected get toolStore(): ToolStore;
    attachMcpTools(): void;
    updateStore<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void;
    /**
     * Execute a user-initiated `!` shell command. Reuses the builtin Bash tool
     * (same kaos / cwd / BackgroundManager as the agent), recording the command
     * and its output as `shell_command`-origin messages. It does NOT start a turn
     * — the model is not prompted (parity with claude-code's `shouldQuery: false`).
     */
    runShellCommand(command: string, commandId?: string): Promise<{
        stdout: string;
        stderr: string;
        isError?: boolean;
        backgrounded?: boolean;
    }>;
    cancelShellCommand(commandId: string): void;
    registerUserTool(input: UserToolRegistration): void;
    unregisterUserTool(name: string): void;
    inheritUserTools(parent: ToolManager): void;
    registerMcpServer(serverName: string, client: MCPClient, tools: readonly Tool[], enabledTools?: ReadonlySet<string>): McpServerRegistrationResult;
    unregisterMcpServer(serverName: string): boolean;
    private handleMcpServerStatusChange;
    private registerNeedsAuthMcpServer;
    private registerConnectedMcpServer;
    /** Replay: a discovery with this hash is already durable; never re-log it. */
    restoreMcpDiscovery(serverName: string, hash: string): void;
    /**
     * Observability record: the server's verbatim `tools/list` result plus how
     * this agent gated it (allow-list, collisions). See `records/types.ts`.
     * Parked while the record log has not opened yet (pre-replay window).
     */
    private recordMcpToolsDiscovered;
    private drainPendingMcpDiscoveries;
    private writeMcpDiscovery;
    private emitMcpToolCollisions;
    setActiveTools(names: readonly string[], disallowedNames?: readonly string[]): void;
    copyLoopToolsFrom(source: ToolManager): void;
    private isMcpToolEnabled;
    /** An exact builtin/user tool name survives when allowed and not denied. */
    private isExactToolEnabled;
    /**
     * Whether tools are disclosed progressively: kept out of the top-level
     * `tools[]` and loaded on demand via select_tools. Reads the agent's single
     * three-gate decision point.
     */
    private get progressiveDisclosure();
    /**
     * Names the model may select right now: registered MCP tools that pass the
     * profile's `mcp__*` access patterns, plus active user tools that explicitly
     * opt into deferred disclosure, sorted for byte-stable announcements.
     * In disclosure mode the patterns keep their permission-filter role but stop
     * feeding the top-level `tools[]`.
     */
    loadableDynamicToolNames(): string[];
    /**
     * The active loaded-tools ledger: every still-loadable name whose full
     * definition has been delivered via a `tools`-carrying message, plus the
     * defer-window pending set. History is the single source of truth, so the
     * ledger survives resume (records replay rebuilds the history), keeps its
     * state across undo (schema messages have `injection` origin and are not
     * undone), and empties at compaction (schema messages are discarded with
     * the folded history — the model re-selects what it still needs).
     */
    loadedDynamicToolNames(): ReadonlySet<string>;
    shapeDynamicToolHistory(messages: readonly ContextMessage[]): readonly ContextMessage[];
    private allLoadedDynamicToolNames;
    private isLoadedDynamicToolActive;
    /** Mark names loaded ahead of their schema message landing in history. */
    markDynamicToolsLoaded(names: Iterable<string>): void;
    /**
     * Context was cleared (`/clear`): every schema message is gone, so the
     * defer-window lead must not keep reporting its names as loaded — a stale
     * entry would make select_tools answer "Already available" for a tool whose
     * definition the model can no longer see.
     */
    onContextCleared(): void;
    /**
     * Compaction rebuilt the history and discarded every loaded schema with it
     * — the loaded set is empty from here on. A pending entry surviving past
     * this boundary would report a schema the context no longer carries as
     * loaded, and re-selecting it would wrongly answer "Already available"
     * instead of injecting.
     */
    onContextCompacted(): void;
    /**
     * Plain schema snapshot of a loadable dynamic tool, read from the live
     * registry (never from history) at injection time.
     */
    getDynamicToolSchema(name: string): Tool | undefined;
    /**
     * Disclosure-mode wording for a tool-call preflight miss. A loaded tool
     * whose server dropped is a different situation from a never-announced name;
     * telling them apart stops the model from re-selecting a disconnected tool
     * in a loop or treating a transient disconnect as a permanent removal.
     */
    missingToolMessage(name: string): string | undefined;
    toolInfos(): Iterable<ToolInfo>;
    data(): readonly ToolInfo[];
    storeData(): Readonly<Record<string, unknown>>;
    initializeBuiltinTools(): void;
    refreshBuiltinTools(): void;
    /**
     * Uploader bound to the agent's current provider, for media that arrives
     * outside a tool call (e.g. a video attached to a prompt). `undefined`
     * when no model is bound or the provider has no video upload channel.
     */
    videoUploader(): b.VideoUploader | undefined;
    private createVideoUploader;
    private videoUploadTelemetryProps;
    get loopTools(): readonly ExecutableTool[];
}
