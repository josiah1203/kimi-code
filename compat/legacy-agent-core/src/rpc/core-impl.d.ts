import { PluginManager } from '#/plugin';
import { ImageLimits } from '#/tools/support/image-limits';
import type { PromisableMethods } from '#/utils/types';
import { type KimiConfig } from '../config';
import { type ExperimentalFeatureState } from '../flags';
import { Session, type SessionMeta } from '../session';
import { type OAuthTokenProviderResolver } from '../session/provider-manager';
import { type TelemetryClient } from '../telemetry';
import type { CoreRPCClient } from './client';
import type { ActivateSkillPayload, ActivatePluginCommandPayload, AddAdditionalDirPayload, AddAdditionalDirResult, ArchiveSessionPayload, BeginGlobalMcpServerAuthResult, BeginCompactionPayload, CancelGlobalMcpServerAuthPayload, CancelPayload, CancelPlanPayload, CancelShellCommandPayload, CloseSessionPayload, CompleteGlobalMcpServerAuthPayload, ConfigDiagnostics, CoreAPI, CoreInfo, CreateGoalPayload, CreateSessionPayload, DeleteSessionPayload, DetachBackgroundPayload, EmptyPayload, EnterSwarmPayload, GoalSnapshot, GoalToolResult, GlobalMcpServerAuthStatus, GlobalMcpServerConfig, GlobalMcpServerNamePayload, GlobalMcpServerTestResult, ExportSessionPayload, ExportSessionResult, ForkSessionPayload, GetBackgroundOutputPayload, GetBackgroundPayload, GetCronTasksResult, GetKimiConfigPayload, GetPluginInfoPayload, InstallPluginPayload, ImportContextPayload, ListSessionsPayload, ListWorkspaceSkillsPayload, McpServerInfo, McpStartupMetrics, PluginInfo, PluginSummary, PromptPayload, PutGlobalMcpServerPayload, RunShellCommandPayload, ReconnectMcpServerPayload, RegisterToolPayload, ReloadSessionPayload, ReloadPluginsResult, RemoveKimiProviderPayload, RemovePluginPayload, RenameSessionPayload, ResumeSessionPayload, SessionSummary, SetActiveToolsPayload, SetKimiConfigPayload, SetModelPayload, SetModelResult, SetPermissionPayload, SetPluginEnabledPayload, SetPluginMcpServerEnabledPayload, SetThinkingPayload, SkillSummary, PluginCommandDef, SteerPayload, StopBackgroundPayload, TestGlobalMcpServerPayload, UndoHistoryPayload, UnregisterToolPayload, UpdateSessionMetadataPayload } from './core-api';
import type { ResumeSessionResult } from './resumed';
import type { SDKRPC } from './sdk-api';
import type { SessionWarning } from '@spiderbyte/protocol';
import { type Kaos } from '@spiderbyte/kaos';
import type { ToolServices } from '../tools/support/services';
type AgentScopedPayload<T> = T & {
    readonly agentId: string;
};
type SessionScopedPayload<T> = T & {
    readonly sessionId: string;
};
type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;
type RenameSessionRequest = SessionScopedPayload<RenameSessionPayload>;
type UpdateSessionMetadataRequest = SessionScopedPayload<UpdateSessionMetadataPayload>;
export interface KimiCoreOptions {
    readonly homeDir?: string | undefined;
    readonly configPath?: string | undefined;
    readonly runtime?: ToolServices | undefined;
    readonly kimiRequestHeaders?: Record<string, string> | undefined;
    readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver | undefined;
    /**
     * Workspace-id resolver handed to the session store: the registered
     * workspace id for the same physical root as a session's workDir (identity
     * comparison folds case/slashes for Windows-shaped paths), so bucket
     * derivation reuses the registered id instead of minting a split bucket.
     * Wired by the services layer from the workspace registry; when omitted the
     * store always mints (legacy behavior).
     */
    readonly resolveWorkspaceId?: (workDir: string) => Promise<string | undefined>;
    readonly skillDirs?: readonly string[];
    readonly telemetry?: TelemetryClient | undefined;
    readonly appVersion?: string;
    /**
     * Host UI mode (`'print'` for `kimi -p`, `'cli'` for the TUI, ...). When
     * `'print'`, sessions are created with the print-mode config defaults from
     * `applyPrintModeConfigDefaults` (user-set values still win).
     */
    readonly uiMode?: string | undefined;
}
export declare class KimiCore implements PromisableMethods<CoreAPI> {
    protected readonly rpcClient: CoreRPCClient;
    readonly sdk: Promise<SDKRPC>;
    readonly homeDir: string;
    readonly configPath: string;
    readonly sessions: Map<string, Session>;
    readonly telemetry: TelemetryClient;
    private kaos;
    private runtime;
    private config;
    private configWarnings;
    private readonly runtimeOverride;
    private readonly userHomeDir;
    private readonly kimiRequestHeaders;
    private readonly resolveOAuthTokenProvider;
    private readonly skillDirs;
    private readonly sessionStore;
    private readonly globalMcpConfig;
    private readonly globalMcpOAuth;
    private readonly globalMcpOAuthFlows;
    readonly plugins: PluginManager;
    private pluginsReady;
    private pluginsLoadError;
    private readonly appVersion;
    private readonly experimentalFlags;
    /** `true` when the host runs `kimi -p` (v1 print mode); see `withPrintModeDefaults`. */
    private readonly printMode;
    /** Owner-scoped [image] limits; reload pushes the new config via setConfig. */
    readonly imageLimits: ImageLimits;
    constructor(rpcClient: CoreRPCClient, options?: KimiCoreOptions);
    createSession(input: CreateSessionPayload): Promise<SessionSummary>;
    createSessionWithOverrides(input: CreateSessionPayload, overrides: {
        kaos?: Kaos;
        persistenceKaos?: Kaos;
    }): Promise<SessionSummary>;
    getCoreInfo(): CoreInfo;
    getExperimentalFeatures(): readonly ExperimentalFeatureState[];
    closeSession({ sessionId }: CloseSessionPayload): Promise<void>;
    archiveSession({ sessionId }: ArchiveSessionPayload): Promise<void>;
    deleteSession({ sessionId }: DeleteSessionPayload): Promise<void>;
    resumeSession(input: ResumeSessionPayload): Promise<ResumeSessionResult>;
    resumeSessionWithOverrides(input: ResumeSessionPayload, overrides: {
        kaos?: Kaos;
        persistenceKaos?: Kaos;
        forcePluginSessionStartReminder?: boolean;
        refreshPluginAgents?: boolean;
    }): Promise<ResumeSessionResult>;
    reloadSession(input: ReloadSessionPayload): Promise<ResumeSessionResult>;
    forkSession(input: ForkSessionPayload): Promise<ResumeSessionResult>;
    listSessions(input?: ListSessionsPayload): Promise<readonly SessionSummary[]>;
    renameSession({ sessionId, ...payload }: RenameSessionRequest): Promise<void>;
    exportSession(input: ExportSessionPayload): Promise<ExportSessionResult>;
    getKimiConfig(input?: GetKimiConfigPayload): Promise<KimiConfig>;
    getConfigDiagnostics(_input?: EmptyPayload): Promise<ConfigDiagnostics>;
    setKimiConfig(input: SetKimiConfigPayload): Promise<KimiConfig>;
    removeKimiProvider(input: RemoveKimiProviderPayload): Promise<KimiConfig>;
    listGlobalMcpServers(_input?: EmptyPayload): Promise<readonly GlobalMcpServerConfig[]>;
    listGlobalMcpServerAuthStatuses(_input?: EmptyPayload): Promise<readonly GlobalMcpServerAuthStatus[]>;
    addGlobalMcpServer({ server }: PutGlobalMcpServerPayload): Promise<readonly GlobalMcpServerConfig[]>;
    updateGlobalMcpServer({ server }: PutGlobalMcpServerPayload): Promise<readonly GlobalMcpServerConfig[]>;
    removeGlobalMcpServer({ name }: GlobalMcpServerNamePayload): Promise<readonly GlobalMcpServerConfig[]>;
    beginGlobalMcpServerAuth({ name }: GlobalMcpServerNamePayload): Promise<BeginGlobalMcpServerAuthResult>;
    completeGlobalMcpServerAuth({ flowId, timeoutMs }: CompleteGlobalMcpServerAuthPayload, options?: {
        readonly signal?: AbortSignal;
    }): Promise<void>;
    cancelGlobalMcpServerAuth({ flowId }: CancelGlobalMcpServerAuthPayload): Promise<void>;
    resetGlobalMcpServerAuth({ name }: GlobalMcpServerNamePayload): Promise<void>;
    testGlobalMcpServer({ name, cwd }: TestGlobalMcpServerPayload): Promise<GlobalMcpServerTestResult>;
    private withGlobalMcpServerProbe;
    private globalMcpServerAuthState;
    prompt({ sessionId, ...payload }: SessionAgentPayload<PromptPayload>): Promise<void>;
    runShellCommand({ sessionId, ...payload }: SessionAgentPayload<RunShellCommandPayload>): Promise<import("./core-api").ShellCommandResult>;
    cancelShellCommand({ sessionId, ...payload }: SessionAgentPayload<CancelShellCommandPayload>): Promise<void>;
    steer({ sessionId, ...payload }: SessionAgentPayload<SteerPayload>): Promise<void>;
    cancel({ sessionId, ...payload }: SessionAgentPayload<CancelPayload>): Promise<void>;
    undoHistory({ sessionId, ...payload }: SessionAgentPayload<UndoHistoryPayload>): Promise<void>;
    setModel({ sessionId, ...payload }: SessionAgentPayload<SetModelPayload>): Promise<SetModelResult>;
    setThinking({ sessionId, ...payload }: SessionAgentPayload<SetThinkingPayload>): Promise<void>;
    setPermission({ sessionId, ...payload }: SessionAgentPayload<SetPermissionPayload>): Promise<void>;
    getModel({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<string>;
    enterPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<void>;
    cancelPlan({ sessionId, ...payload }: SessionAgentPayload<CancelPlanPayload>): Promise<void>;
    clearPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<void>;
    enterSwarm({ sessionId, ...payload }: SessionAgentPayload<EnterSwarmPayload>): Promise<void>;
    exitSwarm({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<void>;
    getSwarmMode({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<boolean>;
    beginCompaction({ sessionId, ...payload }: SessionAgentPayload<BeginCompactionPayload>): Promise<void>;
    cancelCompaction({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<void>;
    registerTool({ sessionId, ...payload }: SessionAgentPayload<RegisterToolPayload>): Promise<void>;
    unregisterTool({ sessionId, ...payload }: SessionAgentPayload<UnregisterToolPayload>): Promise<void>;
    setActiveTools({ sessionId, ...payload }: SessionAgentPayload<SetActiveToolsPayload>): Promise<void>;
    stopBackground({ sessionId, ...payload }: SessionAgentPayload<StopBackgroundPayload>): Promise<void>;
    detachBackground({ sessionId, ...payload }: SessionAgentPayload<DetachBackgroundPayload>): Promise<import("..").BackgroundTaskInfo | undefined>;
    clearContext({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<void>;
    importContext({ sessionId, ...payload }: SessionAgentPayload<ImportContextPayload>): Promise<void>;
    activateSkill({ sessionId, ...payload }: SessionAgentPayload<ActivateSkillPayload>): Promise<void>;
    activatePluginCommand({ sessionId, ...payload }: SessionAgentPayload<ActivatePluginCommandPayload>): Promise<void>;
    getBackgroundOutput({ sessionId, ...payload }: SessionAgentPayload<GetBackgroundOutputPayload>): Promise<string>;
    getContext({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<import("..").AgentContextData>;
    getConfig({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<import("../agent/config").AgentConfigData>;
    getPermission({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<import("../agent/permission").PermissionData>;
    getPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<import("../agent/plan").PlanData>;
    getUsage({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<any>;
    getTools({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<readonly import("..").ToolInfo[]>;
    getBackground({ sessionId, ...payload }: SessionAgentPayload<GetBackgroundPayload>): Promise<readonly import("..").BackgroundTaskInfo[]>;
    updateSessionMetadata({ sessionId, ...payload }: UpdateSessionMetadataRequest): Promise<void>;
    getSessionMetadata({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): SessionMeta;
    listSkills({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<readonly SkillSummary[]>;
    /**
     * List the skills available for a workspace working directory without
     * requiring a session. Mirrors `Session.loadSkills` exactly (same roots,
     * same discovery order, same built-ins) so the result matches what a new
     * session created in `workDir` would see. Used to populate the composer
     * skill menu before a session exists.
     */
    listWorkspaceSkills({ workDir, }: ListWorkspaceSkillsPayload): Promise<readonly SkillSummary[]>;
    listPluginCommands({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): readonly PluginCommandDef[];
    listMcpServers({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): readonly McpServerInfo[];
    getMcpStartupMetrics({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<McpStartupMetrics>;
    reconnectMcpServer({ sessionId, ...payload }: SessionScopedPayload<ReconnectMcpServerPayload>): Promise<void>;
    generateAgentsMd({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<void>;
    getSessionWarnings({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<readonly SessionWarning[]>;
    applyPersistedSecondaryModel({ sessionId }: SessionScopedPayload<EmptyPayload>): void;
    waitForBackgroundTasksOnPrint({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<void>;
    handlePrintMainTurnCompleted({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<'finish' | 'continue'>;
    addAdditionalDir({ sessionId, ...payload }: SessionScopedPayload<AddAdditionalDirPayload>): Promise<AddAdditionalDirResult>;
    startBtw({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<string>;
    createGoal({ sessionId, ...payload }: SessionAgentPayload<CreateGoalPayload>): Promise<GoalSnapshot>;
    getGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalToolResult>;
    pauseGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot>;
    resumeGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot>;
    cancelGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot>;
    getCronTasks({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GetCronTasksResult>;
    installPlugin(payload: InstallPluginPayload): Promise<PluginSummary>;
    listPlugins(_: EmptyPayload): Promise<readonly PluginSummary[]>;
    setPluginEnabled({ id, enabled }: SetPluginEnabledPayload): Promise<void>;
    setPluginMcpServerEnabled({ id, server, enabled, }: SetPluginMcpServerEnabledPayload): Promise<void>;
    removePlugin({ id }: RemovePluginPayload): Promise<void>;
    reloadPlugins(_: EmptyPayload): Promise<ReloadPluginsResult>;
    getPluginInfo({ id }: GetPluginInfoPayload): Promise<PluginInfo>;
    private assertPluginsLoaded;
    private resolveRuntime;
    private getKaos;
    private resolveSessionSkillConfig;
    private resolveProviderManager;
    private mergePluginMcpConfig;
    private withManagedKimiPluginEnv;
    private managedKimiCodeEnvForPlugins;
    private requireSession;
    private sessionApi;
    private reloadProviderManager;
    private readConfigForWrite;
    private reloadRuntimeConfig;
    private setRuntimeConfig;
    /**
     * Config bound to a newly created/resumed session. In print mode (`kimi -p`,
     * v1) the print-mode defaults are merged in; explicit user config wins. The
     * raw `this.config` is left untouched so `getKimiConfig` and config writes
     * still round-trip the user's file values.
     */
    private withPrintModeDefaults;
    private clearRuntimeCache;
    private refreshSessionRuntimeConfig;
}
export {};
