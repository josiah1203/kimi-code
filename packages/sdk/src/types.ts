import type { ExportSessionManifest, SessionSummary as CoreSessionSummary, ShellEnvironment } from '@spiderbyte/agent-core/agent/rpc/core-api';
import type { ResumeSessionResult } from '@spiderbyte/agent-core/agent/replayBuilder/types';
import type {
  AgentReplayRecord,
  ResumedAgentState as CoreResumedAgentState,
} from '@spiderbyte/agent-core/agent/replayBuilder/types';
import type { ConfigDiagnostic } from '@spiderbyte/agent-core/app/config/config';
import type { PluginCommandDef, PluginInfo, PluginMcpServerInfo, PluginSummary, ReloadSummary } from '@spiderbyte/agent-core/app/plugin/types';
import type { SkillSummary as CoreSkillSummary } from '@spiderbyte/agent-core/agent/rpc/core-api';
import type { ToolInfo } from '@spiderbyte/agent-core/tool/toolContract';
import type { ContentPart, Role, ThinkingEffort, ToolCall } from '@spiderbyte/kosong';
import type { SpiderByteHostIdentity } from '@spiderbyte/oauth';
import type { SpiderBytePlatformClient } from '#/platform';
import type { ImageLimits } from '#/image-limits';
import type {
  McpRemoteServerConfig as CoreMcpRemoteServerConfig,
  McpServerConfig as CoreMcpServerConfig,
} from '@spiderbyte/agent-core/mcpCore/config-schema';
import type {
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
  PromptOrigin,
  TaskInfo as BackgroundTaskInfo,
} from '@spiderbyte/protocol';
import type { OAuthRef, ProviderConfig, ProviderType } from '@spiderbyte/agent-core/kosong/provider/provider';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type Unsubscribe = () => void;

export type { AgentReplayRecord, ExportSessionManifest, ShellEnvironment };
export type { ConfigDiagnostic, PluginCommandDef, PluginInfo, PluginMcpServerInfo, PluginSummary, ReloadSummary, ToolInfo };
export type { GoalBudgetLimits, GoalBudgetReport, GoalChange, GoalChangeStats, GoalSnapshot, GoalStatus, GoalToolResult, PromptOrigin, TaskInfo as BackgroundTaskInfo, TaskLifecycleStatus as BackgroundTaskStatus } from '@spiderbyte/protocol';
export type { CoreSkillSummary as SkillSummary };
export type { ProviderConfig, ProviderType, OAuthRef };

export type TelemetryPrimitive = string | number | boolean | null | undefined;
export type TelemetryProperties = Readonly<Record<string, TelemetryPrimitive>>;
export type TelemetryContextPatch = TelemetryProperties;
export interface TelemetryClient {
  track(event: string, properties?: TelemetryProperties): void;
  setContext?(patch: TelemetryContextPatch): void;
  withContext?(patch: TelemetryContextPatch): TelemetryClient;
  flush?(): Promise<void> | void;
  flushSync?(): void;
  shutdown?(): Promise<void> | void;
  setAppender?(appender: { track(event: string, properties?: TelemetryProperties): void }): void;
  setEnabled?(enabled: boolean): void;
}

export type { ImageLimits } from '#/image-limits';

export type ContextMessage = import('@spiderbyte/agent-core/agent/contextMemory/types').ContextMessage;
export type ExperimentalFeatureState = import('@spiderbyte/agent-core/app/flag/flag').ExperimentalFeatureState;
export type ExperimentalFlagMap = import('@spiderbyte/agent-core/app/flag/flag').ExperimentalFlagMap;
export type ExperimentalFlagSource = import('@spiderbyte/agent-core/app/flag/flag').ExperimentalFlagSource;
export interface ModelAlias {
  readonly provider: string;
  readonly model: string;
  readonly maxContextSize: number;
  readonly maxInputSize?: number;
  readonly maxOutputSize?: number;
  readonly capabilities?: readonly string[];
  readonly displayName?: string;
  readonly reasoningKey?: string;
  readonly protocol?: 'anthropic';
  readonly adaptiveThinking?: boolean;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
  readonly offEffort?: string;
  readonly betaApi?: boolean;
  readonly baseUrl?: string;
  readonly overrides?: Partial<Omit<ModelAlias, 'provider' | 'model'>>;
}

export interface BackgroundConfig {
  readonly maxRunningTasks?: number;
  readonly keepAliveOnExit?: boolean;
  readonly bashAutoBackgroundOnTimeout?: boolean;
  readonly bashTaskTimeoutS?: number;
  readonly killGracePeriodMs?: number;
  readonly printWaitCeilingS?: number;
  readonly printBackgroundMode?: 'exit' | 'drain' | 'steer';
  readonly printMaxTurns?: number;
}

export interface LoopControl {
  readonly maxStepsPerTurn?: number;
  readonly maxRetriesPerStep?: number;
  readonly maxRalphIterations?: number;
  readonly reservedContextSize?: number;
  readonly compactionTriggerRatio?: number;
}

export interface ThinkingConfig {
  readonly enabled?: boolean;
  readonly effort?: string;
  readonly keep?: string;
}

export type McpServerConfig = CoreMcpServerConfig;
export type McpRemoteServerConfig = CoreMcpRemoteServerConfig;
export type GlobalMcpServerConfig = McpServerConfig & { readonly name: string };

export interface SpiderByteConfig {
  readonly providers: Record<string, ProviderConfig>;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly models?: Record<string, ModelAlias>;
  readonly thinking?: ThinkingConfig;
  readonly planMode?: boolean;
  readonly yolo?: boolean;
  readonly defaultPermissionMode?: PermissionMode;
  readonly defaultPlanMode?: boolean;
  readonly permission?: Record<string, unknown>;
  readonly hooks?: readonly Record<string, unknown>[];
  readonly services?: Record<string, unknown>;
  readonly mergeAllAvailableSkills?: boolean;
  readonly extraSkillDirs?: readonly string[];
  readonly extraAgentDirs?: readonly string[];
  readonly loopControl?: LoopControl;
  readonly background?: BackgroundConfig;
  readonly subagent?: Record<string, unknown>;
  readonly secondaryModel?: Partial<ModelAlias> & { readonly model?: string };
  readonly mcp?: Record<string, unknown>;
  readonly image?: Record<string, unknown>;
  readonly modelCatalog?: Record<string, unknown>;
  readonly experimental?: Record<string, boolean>;
  readonly telemetry?: boolean;
  readonly raw?: Record<string, unknown>;
}

export type SpiderByteConfigPatch = Partial<Omit<SpiderByteConfig, 'providers' | 'models'>> & {
  readonly providers?: Record<string, Partial<ProviderConfig>>;
  readonly models?: Record<string, Partial<ModelAlias>>;
};

export interface ConfigDiagnostics { readonly warnings: readonly string[]; }
export interface GetCronTasksResult { readonly tasks: readonly CronTaskSnapshot[]; }
export interface CronTaskSnapshot {
  readonly id: string;
  readonly cron: string;
  readonly recurring: boolean;
  readonly createdAt: number;
  readonly lastFiredAt: number | null;
  readonly nextFireAt: number | null;
}
export interface McpServerInfo { readonly name: string; readonly transport: 'stdio' | 'http' | 'sse'; readonly status: string; readonly toolCount: number; readonly error?: string; }
export interface McpStartupMetrics { readonly durationMs: number; }
export type GlobalMcpServerAuthState = 'not-applicable' | 'bearer-token' | 'oauth-required' | 'oauth-authorized';
export interface GlobalMcpServerAuthStatus { readonly name: string; readonly authStatus: GlobalMcpServerAuthState; }
export interface McpTestResult { readonly success: boolean; readonly output: string; }
export interface GlobalMcpServerTestResult extends McpTestResult {}
export interface PluginGithubMetadata { readonly [key: string]: unknown; }
export interface PluginGithubRef { readonly [key: string]: unknown; }
export interface PluginSource { readonly [key: string]: unknown; }
export type AgentBackgroundTaskInfo = Extract<BackgroundTaskInfo, { readonly kind: 'agent' }>;
export type ProcessBackgroundTaskInfo = Extract<BackgroundTaskInfo, { readonly kind: 'process' }>;
export type QuestionBackgroundTaskInfo = Extract<BackgroundTaskInfo, { readonly kind: 'question' }>;

export interface ResumedAgentState extends CoreResumedAgentState {
  readonly toolStore?: Readonly<Record<string, unknown>>;
  readonly background?: readonly BackgroundTaskInfo[];
}

export type { SpiderByteHostIdentity };
export type { ContentPart, Role, ThinkingEffort, ToolCall } from '@spiderbyte/kosong';
// Contributed commands are a SpiderByte Agent Core seam.
export type { AgentCommandInfo } from '@spiderbyte/agent-core/agent/command/agentCommand';

export type PermissionMode = 'yolo' | 'manual' | 'auto';

/**
 * Trust state of a workspace directory.
 */
export interface WorkspaceTrustInfo {
  readonly trusted: boolean;
  /** Names of project-level MCP servers that trusting the workspace would enable. */
  readonly gatedMcpServers: readonly string[];
}

export interface CreateGoalInput {
  readonly objective: string;
  readonly replace?: boolean;
}

export type TextPromptPart = Extract<ContentPart, { type: 'text' }>;
export type PromptPart = Extract<ContentPart, { type: 'text' | 'image_url' | 'video_url' }>;

export type PromptInput = readonly PromptPart[];

export interface SpiderByteHarnessOptions {
  readonly identity?: SpiderByteHostIdentity | undefined;
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly autoLoadConfig?: boolean | undefined;
  readonly uiMode?: string;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly sessionStartedProperties?: TelemetryProperties;
  /** Optional canonical platform facade for compatibility hosts using v1 RPC. */
  readonly platform?: SpiderBytePlatformClient;
}

export interface CreateSessionOptions {
  readonly id?: string | undefined;
  readonly workDir: string;
  readonly model?: string | undefined;
  readonly thinking?: string | undefined;
  readonly permission?: PermissionMode | undefined;
  readonly planMode?: boolean;
  readonly metadata?: JsonObject | undefined;
  readonly additionalDirs?: readonly string[];
  /**
   * Main-agent profile name (`--agent`): a builtin profile or one defined by
   * an agentfile discovered from the user/project agent directories.
   */
  readonly agentProfile?: string;
  /**
   * Explicit agentfiles (`--agent-file`) loaded for this session with the
   * highest precedence; an invalid file fails session creation.
   */
  readonly agentFiles?: readonly string[];
  readonly sessionStartedProperties?: TelemetryProperties;
  /**
   * Print-mode (`spyderbyte -p`) only: when the main agent ends a turn while
   * background subagents (`kind === 'agent'`) are still running, hold the turn
   * open and idle-wait until they all finish, flushing their completions into
   * the turn so the model can react before the run exits. Ignored by
   * interactive / SDK sessions.
   */
  readonly drainAgentTasksOnStop?: boolean;
}

export interface RenameSessionInput {
  readonly id: string;
  readonly title: string;
}

export interface ResumeSessionInput {
  readonly id: string;
  readonly additionalDirs?: readonly string[];
  /** Re-select the session's already-bound main profile; a different name fails. */
  readonly agentProfile?: string;
  /** Include persisted subagent states in the returned replay snapshot. */
  readonly includeSubagents?: boolean;
  /**
   * Limit each returned agent replay to the most recent N user turns. Omit to
   * return the full replay. Lets UI callers that only render the tail avoid
   * transferring the entire history over the RPC boundary.
   */
  readonly replayTurnLimit?: number;
  readonly sessionStartedProperties?: TelemetryProperties;
}

export interface ReloadSessionInput extends ResumeSessionInput {
  readonly forcePluginSessionStartReminder?: boolean;
}

export interface AddAdditionalDirInput {
  readonly id: string;
  readonly path: string;
  readonly persist: boolean;
}

export interface AddAdditionalDirOptions {
  /** When true, share the directory through workspace local config. When false,
   * keep it scoped to this session while still restoring it on session resume. */
  readonly persist: boolean;
}

export interface ForkSessionInput {
  readonly id: string;
  readonly forkId?: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
  /**
   * Zero-based index of the user-visible turn to retain through. Omit it to
   * preserve the existing full-session fork behavior.
   */
  readonly turnIndex?: number;
}

export interface ExportSessionInput {
  readonly id: string;
  readonly outputPath?: string | undefined;
  readonly includeGlobalLog?: boolean | undefined;
  /** Host version to record in the export manifest. */
  readonly version: string;
  /** How the CLI was installed (e.g. 'npm-global', 'native'). */
  readonly installSource?: string | undefined;
  readonly shellEnv?: ShellEnvironment | undefined;
}

export interface ExportSessionResult {
  readonly zipPath: string;
  readonly entries: readonly string[];
  readonly sessionDir: string;
  readonly manifest: ExportSessionManifest;
}

export interface ListSessionsOptions {
  readonly workDir?: string;
  readonly sessionId?: string;
}

export interface GetConfigOptions {
  readonly reload?: boolean | undefined;
}

export interface AuthenticateMcpServerOptions {
  readonly onAuthorizationUrl: (
    url: string,
  ) => void | boolean | PromiseLike<void | boolean>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface TestMcpServerOptions {
  readonly cwd?: string;
}

export interface CompactOptions {
  readonly instruction?: string | undefined;
}

export interface ReloadSessionOptions {
  readonly forcePluginSessionStartReminder?: boolean;
}

export interface PlanInfo {
  readonly id: string;
  readonly content: string;
  readonly path: string;
}

export type SessionPlan = PlanInfo | null;

export interface TokenUsage {
  readonly inputOther: number;
  readonly output: number;
  readonly inputCacheRead: number;
  readonly inputCacheCreation: number;
}

export interface SessionUsage {
  readonly byModel?: Record<string, TokenUsage> | undefined;
  readonly currentTurn?: TokenUsage | undefined;
  readonly total?: TokenUsage | undefined;
}

export interface SessionStatus {
  readonly model?: string;
  readonly thinkingEffort: string;
  readonly permission: PermissionMode;
  readonly planMode: boolean;
  readonly swarmMode?: boolean | undefined;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly contextUsage: number;
  readonly usage?: SessionUsage;
}

export interface SessionSummary extends Omit<CoreSessionSummary, 'workDir' | 'sessionDir' | 'metadata' | 'additionalDirs'> {
  readonly id: string;
  readonly title?: string | undefined;
  readonly lastPrompt?: string;
  readonly workDir: string;
  readonly sessionDir: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived?: boolean | undefined;
  readonly metadata?: JsonObject | undefined;
  readonly additionalDirs?: readonly string[];
  /** Terminal outcome of the session's latest main turn, when one ended. */
  readonly lastTurnReason?: 'completed' | 'cancelled' | 'failed';
}

export interface AddAdditionalDirResult {
  readonly additionalDirs: readonly string[];
  readonly projectRoot: string;
  readonly configPath: string;
  readonly persisted: boolean;
}

export type ResumedSessionState = Pick<ResumeSessionResult, 'sessionMetadata' | 'agents' | 'warning'>;

export interface ResumedSessionSummary extends SessionSummary, ResumedSessionState { }
