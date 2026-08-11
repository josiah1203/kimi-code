import type { Logger } from '#/logging/types';
import type { AgentAPI, AgentEvent, KimiConfig, SDKAgentRPC } from '#/rpc';
import { generate } from '@spiderbyte/kosong';
import type { EnabledPluginSessionStart, EnabledPluginSystemPrompt, PluginCommandDef } from '#/plugin';
import type { McpConnectionManager } from '../mcp';
import { type ExperimentalFlagResolver } from '../flags';
import { ImageLimits } from '../tools/support/image-limits';
import { type PreparedSystemPromptContext, type ResolvedAgentProfile } from '../profile';
import type { ModelProvider } from '../session/provider-manager';
import type { SessionSubagentHost } from '../session/subagent-host';
import { type TelemetryClient } from '../telemetry';
import type { PromisableMethods } from '../utils/types';
import { BackgroundManager } from './background';
import { FullCompaction, MicroCompaction, type CompactionStrategy, type MicroCompactionConfig } from './compaction';
import { CronManager } from './cron';
import { ConfigState } from './config';
import { ContextMemory } from './context';
import { GoalMode } from './goal';
import { HookEngine } from '../session/hooks';
import { InjectionManager } from './injection/manager';
import { PermissionManager, type PermissionManagerOptions } from './permission';
import { PlanMode } from './plan';
import { AgentRecords, BlobStore, type AgentRecordPersistence, type AgentRecordsReplayOptions } from './records';
import { ReplayBuilder, type ReplayBuilderOptions } from './replay';
import { SkillManager } from './skill';
import type { SkillRegistry } from './skill/types';
import { SwarmMode } from './swarm';
import { ToolManager } from './tool/index';
import { TurnFlow } from './turn';
import { KosongLLM } from './turn/kosong-llm';
import { UsageRecorder } from './usage';
import { LlmRequestLogger } from './llm-request-logger';
import { LlmRequestRecorder } from './llm-request-recorder';
import type { Kaos } from '@spiderbyte/kaos';
import type { ToolServices } from '../tools/support/services';
export type { AgentRecord, AgentRecordPersistence } from './records';
export type { SwarmModeTrigger } from './swarm';
export type { BuiltinTool, ToolDisclosure, ToolInfo, ToolSource, UserToolRegistration, } from './tool';
export * from './goal';
export type AgentType = 'main' | 'sub' | 'independent';
export interface AgentOptions {
    readonly kaos: Kaos;
    readonly config?: KimiConfig;
    readonly homedir?: string;
    /**
     * Session-owned directory for pre-compression image originals
     * (`sessionMediaOriginalsDir(sessionDir)`), threaded to media-producing
     * paths (MCP tool results) so readback originals live with the session
     * rather than in the shared temp-dir fallback.
     */
    readonly mediaOriginalsDir?: string;
    readonly rpc?: Partial<SDKAgentRPC>;
    readonly persistence?: AgentRecordPersistence;
    readonly type?: AgentType;
    readonly generate?: typeof generate;
    readonly toolServices?: ToolServices;
    readonly compactionStrategy?: CompactionStrategy;
    readonly microCompaction?: Partial<MicroCompactionConfig>;
    readonly modelProvider?: ModelProvider | undefined;
    readonly subagentHost?: SessionSubagentHost | undefined;
    readonly skills?: SkillRegistry;
    readonly mcp?: McpConnectionManager;
    readonly hookEngine?: HookEngine;
    readonly permission?: PermissionManagerOptions | undefined;
    readonly log?: Logger;
    readonly telemetry?: TelemetryClient | undefined;
    readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
    readonly pluginCommands?: readonly PluginCommandDef[];
    readonly pluginSystemPrompts?: readonly EnabledPluginSystemPrompt[];
    readonly experimentalFlags?: ExperimentalFlagResolver;
    /** Owner-scoped [image] limits; a standalone Agent gets env/built-in defaults. */
    readonly imageLimits?: ImageLimits;
    readonly replay?: ReplayBuilderOptions;
    readonly additionalDirs?: readonly string[];
    readonly systemPromptContextProvider?: (() => Promise<PreparedSystemPromptContext>) | undefined;
}
export declare class Agent {
    readonly type: AgentType;
    private _kaos;
    get kaos(): Kaos;
    /**
     * The session config snapshot this agent reads (loop control, subagent
     * binding descriptions, ...). Mutable via {@link updateKimiConfig} so the
     * session can push live config updates (e.g. a `/secondary_model` switch)
     * to already-instantiated agents.
     */
    kimiConfig?: KimiConfig;
    readonly homedir?: string;
    readonly mediaOriginalsDir?: string;
    readonly rpc?: Partial<SDKAgentRPC>;
    readonly toolServices?: ToolServices;
    readonly pluginSessionStarts: readonly EnabledPluginSessionStart[];
    readonly pluginCommands: readonly PluginCommandDef[];
    readonly rawGenerate: typeof generate;
    readonly modelProvider?: ModelProvider;
    readonly subagentHost?: SessionSubagentHost;
    readonly mcp?: McpConnectionManager;
    readonly hooks?: HookEngine;
    readonly log: Logger;
    readonly telemetry: TelemetryClient;
    readonly experimentalFlags: ExperimentalFlagResolver;
    readonly imageLimits: ImageLimits;
    readonly llmRequestLogger: LlmRequestLogger;
    readonly llmRequestRecorder: LlmRequestRecorder;
    readonly blobStore: BlobStore | undefined;
    readonly records: AgentRecords;
    readonly fullCompaction: FullCompaction;
    readonly microCompaction: MicroCompaction;
    readonly context: ContextMemory;
    readonly config: ConfigState;
    readonly turn: TurnFlow;
    readonly injection: InjectionManager;
    readonly permission: PermissionManager;
    readonly planMode: PlanMode;
    readonly swarmMode: SwarmMode;
    readonly usage: UsageRecorder;
    readonly skills: SkillManager | null;
    readonly tools: ToolManager;
    readonly background: BackgroundManager;
    readonly cron: CronManager | null;
    readonly goal: GoalMode;
    readonly replayBuilder: ReplayBuilder;
    /**
     * Print-mode (`kimi -p`) only: when true and the agent ends a turn while
     * background subagents (`kind === 'agent'`) are still running, the turn loop
     * holds the turn open and idle-waits until they finish, flushing their
     * completions into the turn so the model can react before the run exits. Set
     * by the session for print runs; defaults to false everywhere else.
     */
    printDrainAgentTasksOnStop: boolean;
    private additionalDirs;
    private activeProfile?;
    private brandHome?;
    private readonly emittedThinkingEffortWarnings;
    private pluginSystemPrompts;
    private readonly emittedPluginBudgetWarnings;
    private readonly pendingThinkingEffortWarnings;
    private readonly systemPromptContextProvider?;
    constructor(options: AgentOptions);
    setKaos(kaos: Kaos): void;
    getAdditionalDirs(): readonly string[];
    setAdditionalDirs(additionalDirs: readonly string[]): void;
    /**
     * Single decision point for select_tools progressive disclosure. All three
     * gates must be open: the model has the `dynamically_loaded_tools`
     * capability (message-level tool declarations), the model declares
     * `tool_use` (a model without tool use loading tools dynamically is a
     * contradiction), and the `tool-select` experimental flag is on. Every
     * consumer — top-level tools[] convergence, select_tools registration,
     * manifest announcements, projection shaping — reads this instead of
     * re-deriving the conditions, so degradation is lossless: any closed gate
     * reproduces the inline behavior byte-for-byte.
     */
    get toolSelectEnabled(): boolean;
    get generate(): typeof generate;
    private warnAboutAnthropicThinkingEffort;
    private publishAnthropicThinkingEffortWarning;
    private flushPendingAnthropicThinkingEffortWarnings;
    warnAboutCurrentAnthropicThinkingEffort(): void;
    get llm(): KosongLLM;
    useProfile(profile: ResolvedAgentProfile, context?: PreparedSystemPromptContext, brandHome?: string, subagentNames?: readonly string[]): void;
    /** Push a refreshed session config snapshot and rebuild config-dependent builtin tools. */
    updateKimiConfig(config: KimiConfig | undefined): void;
    setActiveProfile(profile: ResolvedAgentProfile, brandHome?: string): void;
    /**
     * Re-render the system prompt with freshly gathered runtime context (cwd
     * listing, AGENTS.md, additional-dirs info, skill list). Called after
     * compaction so the post-compaction turns do not keep a snapshot captured
     * at session bootstrap. Invalidates the prompt-cache prefix by design.
     */
    refreshSystemPrompt(): Promise<void>;
    private updateSystemPromptFromProfile;
    /**
     * Replace the enabled plugins' system-prompt contributions. Does not
     * re-render on its own — pair with `refreshSystemPrompt()` so callers decide
     * when the prompt-cache prefix is invalidated.
     */
    setPluginSystemPrompts(sections: readonly EnabledPluginSystemPrompt[]): void;
    /**
     * Warn once per plugin when its system-prompt contribution is skipped
     * because the aggregate budget is exhausted; a skipped contribution keeps
     * being skipped on every re-render, so the warning is deduped by plugin id.
     */
    private warnAboutSkippedPluginSections;
    resume(options?: AgentRecordsReplayOptions): Promise<{
        warning?: string;
    }>;
    get rpcMethods(): PromisableMethods<AgentAPI>;
    emitEvent(event: AgentEvent): void;
    emitStatusUpdated(includeThinkingEffort?: boolean): void;
    private emitRecordsWriteError;
}
