import type { Kaos } from '@spiderbyte/kaos';
import type { SessionWarning } from '@spiderbyte/protocol';
import type { Logger } from '#/logging/types';
import type { KimiConfig, SDKSessionRPC } from '#/rpc';
import { Agent, type AgentOptions, type AgentType } from '../agent';
import { HookEngine, type HookDef } from './hooks';
import type { PermissionRule } from '../agent/permission';
import { type BackgroundConfig, type WorkspaceAdditionalDirsLoadResult } from '../config';
import { McpConnectionManager, type SessionMcpConfig } from '../mcp';
import type { EnabledPluginSessionStart, EnabledPluginSystemPrompt, PluginCommandDef } from '../plugin';
import { SessionAgentProfileCatalog, type AgentFileRoot, type ResolvedAgentProfile } from '../profile';
import type { ProviderManager } from './provider-manager';
import { SessionSkillRegistry, type SkillRoot, type SkillSummary } from '../skill';
import { type TelemetryClient } from '../telemetry';
import type { ToolServices } from '../tools/support/services';
import { type ExperimentalFlagResolver } from '../flags';
import { ImageLimits } from '../tools/support/image-limits';
export interface SessionOptions {
    readonly kaos: Kaos;
    readonly persistenceKaos?: Kaos;
    readonly config?: KimiConfig;
    readonly id?: string | undefined;
    readonly homedir: string;
    readonly kimiHomeDir?: string;
    readonly rpc: SDKSessionRPC;
    readonly toolServices?: ToolServices;
    readonly initializeMainAgent?: boolean | undefined;
    readonly providerManager?: ProviderManager | undefined;
    readonly background?: BackgroundConfig | undefined;
    readonly hooks?: readonly HookDef[];
    readonly permissionRules?: readonly PermissionRule[];
    readonly skills?: SessionSkillConfig;
    readonly agents?: SessionAgentCatalogConfig;
    readonly mcpConfig?: SessionMcpConfig;
    readonly telemetry?: TelemetryClient | undefined;
    readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
    readonly pluginCommands?: readonly PluginCommandDef[];
    readonly pluginSystemPrompts?: readonly EnabledPluginSystemPrompt[];
    readonly appVersion?: string;
    readonly experimentalFlags?: ExperimentalFlagResolver;
    /** Owner-scoped [image] limits, threaded from the owning core into every agent. */
    readonly imageLimits?: ImageLimits;
    readonly additionalDirs?: readonly string[];
    /**
     * Print-mode (`kimi -p`) only: hold the main turn open while background
     * subagents (`kind === 'agent'`) are still running, idle-waiting until they
     * finish before the run exits. Set via the SDK `createSession` option.
     */
    readonly drainAgentTasksOnStop?: boolean;
}
export interface SessionSkillConfig {
    readonly userHomeDir?: string;
    /** Brand data dir (KIMI_CODE_HOME); user brand skills live under `<brandHomeDir>/skills`. */
    readonly brandHomeDir?: string;
    readonly explicitDirs?: readonly string[];
    readonly extraDirs?: readonly string[];
    readonly pluginSkillRoots?: readonly SkillRoot[];
    readonly mergeAllAvailableSkills?: boolean;
    readonly builtinDir?: string;
}
/**
 * File-defined agent (agentfile) discovery for a session. Mirrors the skill
 * discovery layout: user brand dir `<kimiHomeDir>/agents` and
 * `~/.agents/agents`, project `.kimi-code/agents` and `.agents/agents`, plus
 * configured extra dirs and explicit single files (`--agent-file`, fatal
 * when invalid). `profileName` selects the main agent's profile (`--agent`).
 */
export interface SessionAgentCatalogConfig {
    readonly userHomeDir?: string;
    readonly explicitFiles?: readonly string[];
    readonly extraDirs?: readonly string[];
    readonly profileName?: string;
    /** Agent directories contributed by enabled plugins (lowest file priority). */
    readonly pluginRoots?: readonly AgentFileRoot[];
    /** Refresh only the plugin contribution when restoring the persisted catalog. */
    readonly refreshPluginAgents?: boolean;
    /** Already-loaded catalog prepared before a persistent session is created. */
    readonly catalog?: SessionAgentProfileCatalog;
}
export interface AgentMeta {
    readonly homedir?: string;
    readonly type: AgentType;
    readonly parentAgentId?: string | null;
    readonly swarmItem?: string;
}
interface ResumedAgent {
    readonly agent: Agent;
    readonly warning?: string;
}
type AgentEntry = Agent | Promise<ResumedAgent>;
export interface CreateAgentOptions {
    readonly profile?: ResolvedAgentProfile;
    readonly parentAgentId?: string;
    readonly swarmItem?: string;
    readonly persistMetadata?: boolean;
}
export interface SessionMeta {
    createdAt: string;
    updatedAt: string;
    title: string;
    isCustomTitle: boolean;
    lastPrompt?: string;
    forkedFrom?: string;
    /** Absolute working directory the session was created in. Persisted so the
     *  session directory is self-describing and the global session index does not
     *  have to be trusted for the (one-way-hashed) workDir. */
    workDir?: string;
    /** Directories added for this session only. Unlike workspace local config,
     *  these follow the session across close/resume without affecting any other
     *  session opened in the same workspace. */
    additionalDirs?: string[];
    agents: Record<string, AgentMeta>;
    custom: Record<string, any>;
}
export declare class Session {
    readonly options: SessionOptions;
    readonly rpc: SDKSessionRPC;
    readonly telemetry: TelemetryClient;
    readonly skills: SessionSkillRegistry;
    readonly agents: Map<string, AgentEntry>;
    readonly mcp: McpConnectionManager;
    readonly log: Logger;
    private readonly logHandle;
    readonly hookEngine: HookEngine;
    readonly experimentalFlags: ExperimentalFlagResolver;
    readonly imageLimits: ImageLimits;
    readonly agentCatalog: SessionAgentProfileCatalog;
    private toolKaos;
    private persistenceKaos;
    private additionalDirs;
    private sessionAdditionalDirs;
    private readonly pluginCommands;
    private pluginSystemPrompts;
    private agentIdCounter;
    private readonly skillsReady;
    metadata: SessionMeta;
    private writeMetadataPromise;
    private agentProfileSnapshot;
    private agentsMdWarning;
    private printSteerDeadline;
    private printSteerTurns;
    /**
     * The session's live config snapshot. Initialized from `options.config`;
     * updated in place by {@link setSecondaryModelConfig} so mid-session secondary-model
     * switches reach the spawn-binding and tool-description readers without
     * recreating the session.
     */
    private runtimeConfig;
    /** The session's current config snapshot (see {@link Session.runtimeConfig}). */
    get kimiConfig(): KimiConfig | undefined;
    constructor(options: SessionOptions);
    setToolKaos(kaos: Kaos): void;
    getAdditionalDirs(): readonly string[];
    setAdditionalDirs(additionalDirs: readonly string[]): Promise<void>;
    setBaseAdditionalDirs(additionalDirs: readonly string[]): Promise<void>;
    addAdditionalDir(path: string, persist?: boolean): Promise<WorkspaceAdditionalDirsLoadResult & {
        readonly persisted: boolean;
    }>;
    private notifyAdditionalDirAdded;
    /**
     * Kaos used by session-internal bootstrap (AGENTS.md context, cwd listing)
     * and metadata persistence. Always backed by the persistence sink (typically
     * the local filesystem) so a transient ACP-side failure on system files like
     * `AGENTS.md` never blocks `bootstrapAgentProfile` — tool calls still route
     * through `agent.kaos` and continue to honor the ACP bridge.
     */
    systemContextKaos(cwd: string): Kaos;
    createMain(): Promise<Agent>;
    resume(): Promise<{
        warning?: string;
    }>;
    assertMainProfileSelection(requestedProfileName: string | undefined): Promise<void>;
    close(): Promise<void>;
    closeForReload(): Promise<void>;
    private cancelActiveTurnsOnClose;
    private activeBackgroundAgentIds;
    private cancelAgentTurnOnClose;
    private stopBackgroundTasksOnExit;
    /**
     * Wait for all still-running background tasks (across every agent) to reach a
     * terminal state before a `kimi -p` (print) run exits.
     *
     * Only runs when the resolved print background mode is `'drain'` (see
     * `resolvePrintBackgroundMode`): `print_background_mode = "drain"`, or the
     * legacy `keep_alive_on_exit = true` fallback. In every other mode it returns
     * immediately. The wait is bounded by `background.print_wait_ceiling_s`
     * (default `PRINT_WAIT_CEILING_S_DEFAULT`, effectively unbounded) so a wedged
     * task can still be given up on eventually.
     *
     * Terminal notifications are suppressed for each task while we wait, so a task
     * completing cannot `turn.steer` the (already finished) main agent into launching
     * a new turn. (This is exactly what `'steer'` mode avoids by never calling here.)
     */
    waitForBackgroundTasksOnPrint(): Promise<void>;
    /**
     * Resolve the effective print-mode (`kimi -p`) background-task policy.
     *
     * `background.print_background_mode` is authoritative when set. Otherwise we
     * fall back to the legacy `background.keep_alive_on_exit` mapping so existing
     * configs keep their behavior: `keep_alive_on_exit = true` ⇒ `'drain'`
     * (suppress + drain background tasks before exit). When neither is set the
     * mode defaults to `'steer'`: a headless run stays alive while background
     * tasks are pending so their completions can steer new main turns.
     */
    private resolvePrintBackgroundMode;
    private countActiveBackgroundTasks;
    /**
     * Decide what the `kimi -p` driver should do after the main agent's turn ends
     * with `reason === 'completed'`. Returns `'finish'` when the run may exit, or
     * `'continue'` when the driver must stay alive so a background-task completion
     * can `turn.steer` the main agent into a new turn.
     *
     *  - 'exit'  : finish immediately.
     *  - 'drain' : suppress + drain background tasks, then finish (legacy
     *              `keep_alive_on_exit = true` behavior).
     *  - 'steer' : while background tasks are still pending, return 'continue' so
     *              completions steer new main turns; finish once quiescent, or when
     *              the wall-clock ceiling (`print_wait_ceiling_s`) or the turn cap
     *              (`print_max_turns`) is reached. This is the default mode.
     */
    handlePrintMainTurnCompleted(): Promise<'finish' | 'continue'>;
    createAgent(config: Partial<AgentOptions>, options?: CreateAgentOptions): Promise<{
        readonly id: string;
        readonly agent: Agent;
    }>;
    ensureAgentResumed(id: string): Promise<Agent>;
    /**
     * Applies a profile's derived config — cwd, system prompt, active tools — to
     * an agent. Fresh creation and resume-of-an-incomplete-wire both route
     * through here so the two paths cannot drift apart.
     */
    private bootstrapAgentProfile;
    getSessionWarnings(): Promise<readonly SessionWarning[]>;
    /**
     * Live-apply the core's fully resolved secondary-model config after a
     * `[secondary_model]` change: the spawn
     * binding (`subagent-host`), the startup-warning computation, and every live
     * agent's `kimiConfig` (tool descriptions, loop control) all read the
     * session snapshot, so a mid-session `/secondary_model` switch takes effect
     * for the next subagent spawn without recreating the session. The core owns
     * config reload, environment overlays, and derived-model synthesis. Copying
     * that complete recipe and its model entries keeps spawn binding and provider
     * resolution aligned without live-applying unrelated session settings.
     */
    setSecondaryModelConfig(config: KimiConfig): void;
    private secondaryModelWarnings;
    /**
     * Upfront validation of the `[secondary_model]` recipe, mirroring the v2
     * warning service: the pointer is otherwise only validated lazily at spawn
     * time, where a typo becomes a mid-conversation tool failure dumped on the
     * parent model. Advisory only — spawn-time resolution (with the wrapped
     * error) remains the backstop. Computed once per session.
     */
    private computeSecondaryModelWarnings;
    private computeAgentsMdWarning;
    generateAgentsMd(): Promise<void>;
    /**
     * Appends a fresh `<plugin_session_start>` system reminder to the main agent
     * using the currently enabled plugins, then flushes records so the reminder is
     * persisted and visible on the wire. Used by the explicit `/reload` flow after
     * the session has been re-resumed with reloaded plugin state.
     *
     * When no plugin session start is currently resolvable but an earlier
     * When no plugin session start is currently resolvable but the context may still
     * carry stale plugin guidance — either an earlier `<plugin_session_start>`
     * reminder, or a compaction summary that may have folded one in — appends a
     * neutralizing reminder instead, so the model does not keep following stale
     * plugin instructions and the turn-loop injector does not dedup against them.
     */
    appendPluginSessionStartReminder(): Promise<void>;
    private shouldNeutralizePluginSessionStart;
    get hasActiveTurn(): boolean;
    protected get metadataPath(): string;
    writeMetadata(): Promise<void>;
    readMetadata(): Promise<SessionMeta>;
    flushMetadata(): Promise<void>;
    listSkills(): Promise<readonly SkillSummary[]>;
    listPluginCommands(): readonly PluginCommandDef[];
    private loadSkills;
    private loadMcpServers;
    private emitInitialMcpLoadError;
    private onMcpServerStatusChange;
    private refreshAgentBuiltinTools;
    /**
     * Replace the enabled plugins' system-prompt contributions on every ready
     * agent and re-render prompts. The owning core calls this after an explicit
     * plugin reload — installing, enabling, disabling, or removing a plugin
     * without a reload deliberately leaves live prompts unchanged.
     */
    setPluginSystemPrompts(sections: readonly EnabledPluginSystemPrompt[]): Promise<void>;
    private instantiateAgent;
    private permissionOptions;
    getReadyAgent(id: string): Agent | undefined;
    readyAgents(): Iterable<Agent>;
    private resolveAgentEntry;
    private resumeAgent;
    private resumePersistedAgent;
    private restoreAgentProfileHandle;
    private resolvePersistedProfile;
    private nextGeneratedAgentId;
    private requireMainAgent;
    private triggerSessionStart;
    private triggerSessionEnd;
}
export * from './subagent-host';
export * from './subagent-binding';
export * from './store';
