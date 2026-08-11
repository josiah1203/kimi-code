import type { SessionRunsFacade } from '@spiderbyte/client';
import { ErrorCodes, SpiderByteError } from '#/errors';
import { withTelemetryContext } from '#/telemetry';
import type { ImageLimits, ExperimentalFeatureState } from '#/types';

import { Session } from '#/session';
import type { SpiderByteAuthFacade } from '#/auth';
import type { SDKRpcClientBase } from '#/rpc';
import type { SpiderBytePlatformClient } from '#/platform';
import type {
  AuthenticateMcpServerOptions,
  ConfigDiagnostics,
  CreateSessionOptions,
  ExportSessionInput,
  ExportSessionResult,
  ForkSessionInput,
  GetConfigOptions,
  GlobalMcpServerAuthStatus,
  GlobalMcpServerConfig,
  SpiderByteConfig,
  SpiderByteConfigPatch,
  SpiderByteHostIdentity,
  ListSessionsOptions,
  McpServerInfo,
  McpTestResult,
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  ReloadSummary,
  RenameSessionInput,
  ResumeSessionInput,
  ReloadSessionInput,
  SessionSummary,
  SkillSummary,
  TelemetryClient,
  TelemetryContextPatch,
  TelemetryProperties,
  TestMcpServerOptions,
  WorkspaceTrustInfo,
} from '#/types';

export interface SpiderByteHarnessRuntimeOptions {
  readonly identity?: SpiderByteHostIdentity;
  readonly uiMode?: string;
  readonly homeDir: string;
  readonly configPath: string;
  readonly auth: SpiderByteAuthFacade;
  readonly telemetry: TelemetryClient;
  readonly ensureConfigFile: () => Promise<void>;
  readonly onClose: () => void | Promise<void>;
  readonly sessionStartedProperties?: TelemetryProperties;
  /**
   * Owner-scoped [image] limits for prompt-ingestion compression in the
   * client process (paste-time, ACP prompt conversion). In-process cores
   * (SDKRpcClient) hand over their core's instance; daemon-client hosts
   * leave it undefined and ingestion falls back to env/built-in defaults.
   */
  readonly imageLimits?: ImageLimits | undefined;
  /** Canonical workspace platform facade; present for v2 in-process hosts. */
  readonly platform?: SpiderBytePlatformClient;
  /** Optional v2 session-scoped Run facade; undefined for v1/daemon hosts. */
  readonly platformSessionRuns?: (sessionId: string) => SessionRunsFacade;
}

export class SpiderByteHarness {
  readonly homeDir: string;
  readonly configPath: string;
  readonly auth: SpiderByteAuthFacade;

  private readonly identity: SpiderByteHostIdentity | undefined;
  private readonly uiMode: string;
  private readonly telemetry: TelemetryClient;
  private readonly activeSessions = new Map<string, Session>();
  private readonly ensureConfigFileImpl: () => Promise<void>;
  private readonly closeImpl: () => void | Promise<void>;
  private readonly sessionStartedProperties: TelemetryProperties;

  /**
   * Ingestion-side [image] limits owned by this harness's core; undefined for
   * daemon-client hosts, where the env var / built-in defaults apply.
   */
  readonly imageLimits: ImageLimits | undefined;
  readonly platform: SpiderBytePlatformClient | undefined;
  readonly platformSessionRuns: ((sessionId: string) => SessionRunsFacade) | undefined;

  constructor(
    private readonly rpc: SDKRpcClientBase,
    options: SpiderByteHarnessRuntimeOptions,
  ) {
    this.identity = options.identity;
    this.uiMode = options.uiMode ?? DEFAULT_SESSION_STARTED_UI_MODE;
    this.homeDir = options.homeDir;
    this.configPath = options.configPath;
    this.telemetry = options.telemetry;
    this.auth = options.auth;
    this.ensureConfigFileImpl = options.ensureConfigFile;
    this.closeImpl = options.onClose;
    this.sessionStartedProperties = options.sessionStartedProperties ?? {};
    this.imageLimits = options.imageLimits;
    this.platform = options.platform;
    this.platformSessionRuns = options.platformSessionRuns;
  }

  get sessions(): ReadonlyMap<string, Session> {
    return this.activeSessions;
  }

  get interactiveAgentId(): string {
    return this.rpc.interactiveAgentId;
  }

  withInteractiveAgent<T>(agentId: string, fn: () => T): T {
    return this.rpc.withInteractiveAgent(agentId, fn);
  }

  track(event: string, properties?: TelemetryProperties): void {
    this.telemetry.track(event, properties);
  }

  setTelemetryContext(patch: TelemetryContextPatch): void {
    this.telemetry.setContext?.(patch);
  }

  async createSession(options: CreateSessionOptions): Promise<Session> {
    const { planMode, sessionStartedProperties, ...coreOptions } = options;
    const summary = await this.rpc.createSession(coreOptions);
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      platform: this.platform,
      platformRuns: this.platformSessionRuns?.(summary.id),
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    if (planMode === true) {
      await session.setPlanMode(true);
    }
    this.trackSessionStarted(summary.id, false, sessionStartedProperties);
    this.trackSessionEvent(session.id, 'session_new');
    return session;
  }

  async resumeSession(input: ResumeSessionInput): Promise<Session> {
    const id = normalizeSessionId(input.id);
    const active = this.activeSessions.get(id);
    const { sessionStartedProperties, ...resumeInput } = input;
    if (active !== undefined) {
      if (input.agentProfile !== undefined) {
        await this.rpc.resumeSession({ ...resumeInput, id });
      }
      return active;
    }

    const summary = await this.rpc.resumeSession({ ...resumeInput, id });
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      platform: this.platform,
      platformRuns: this.platformSessionRuns?.(summary.id),
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, true, sessionStartedProperties);
    this.trackSessionEvent(session.id, 'session_resume');
    return session;
  }

  async reloadSession(input: ReloadSessionInput): Promise<Session> {
    const id = normalizeSessionId(input.id);
    const active = this.activeSessions.get(id);
    if (active !== undefined) {
      await active.reloadSession({
        forcePluginSessionStartReminder: input.forcePluginSessionStartReminder,
      });
      this.trackSessionEvent(active.id, 'session_reload');
      return active;
    }

    const summary = await this.rpc.reloadSession({
      sessionId: id,
      forcePluginSessionStartReminder: input.forcePluginSessionStartReminder,
    });
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      platform: this.platform,
      platformRuns: this.platformSessionRuns?.(summary.id),
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, true);
    this.trackSessionEvent(session.id, 'session_reload');
    return session;
  }

  async forkSession(input: ForkSessionInput): Promise<Session> {
    const summary = await this.rpc.forkSession({
      id: normalizeSessionId(input.id),
      forkId: input.forkId,
      title: input.title,
      metadata: input.metadata,
      turnIndex: input.turnIndex,
    });
    const session = new Session({
      id: summary.id,
      workDir: summary.workDir,
      summary,
      rpc: this.rpc,
      platform: this.platform,
      platformRuns: this.platformSessionRuns?.(summary.id),
      onClose: () => {
        this.activeSessions.delete(summary.id);
      },
    });
    this.activeSessions.set(session.id, session);
    this.trackSessionStarted(summary.id, true);
    this.trackSessionEvent(session.id, 'session_fork');
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.activeSessions.get(id);
  }

  /**
   * Return the canonical v2 session Run facade when this harness is backed by
   * an in-process v2 engine. Older daemon/v1 hosts return `undefined` and keep
   * their existing Session API unchanged.
   */
  getPlatformSessionRuns(sessionId: string): SessionRunsFacade | undefined {
    return this.platformSessionRuns?.(sessionId);
  }

  async closeSession(id: string): Promise<void> {
    await this.activeSessions.get(id)?.close();
  }

  async deleteSession(id: string): Promise<void> {
    const sessionId = normalizeSessionId(id);
    await this.activeSessions.get(sessionId)?.close();
    await this.rpc.deleteSession({ sessionId });
  }

  async renameSession(input: RenameSessionInput): Promise<void> {
    await this.rpc.renameSession(input);
    this.activeSessions.get(input.id)?.emitMetaUpdated({ title: input.title });
  }

  async exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    const result = await this.rpc.exportSession({
      ...input,
      version: input.version ?? this.identity?.version,
    });
    this.trackSessionEvent(input.id, 'export');
    return result;
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<readonly SessionSummary[]> {
    return this.rpc.listSessions(options);
  }

  /** Skills visible to a new session in `workDir`, without creating that session. */
  async listWorkspaceSkills(workDir: string): Promise<readonly SkillSummary[]> {
    return this.rpc.listWorkspaceSkills(workDir);
  }

  /**
   * App-global plugin command list, no session required. Empty on the v1
   * engine, which only exposes plugin commands through a live session.
   */
  async listPluginCommands(): Promise<readonly PluginCommandDef[]> {
    return this.rpc.listPluginCommandsGlobal();
  }

  /**
   * App-global plugin management, no session required. The v2 engine keeps
   * plugin state app-global (these calls are routed through the klient
   * `global.plugins` facade), so `/plugins` works before the first session
   * exists; the v1 engine only exposes plugins through a live session.
   */
  async listPlugins(): Promise<readonly PluginSummary[]> {
    return this.rpc.listPlugins();
  }

  /**
   * Workspace-level MCP server list, no session required. The v2 engine owns
   * one shared connection set per workspace handler, so `/mcp` is inspectable
   * before the first session exists; empty on the v1 engine.
   */
  async listWorkspaceMcpServers(workDir: string): Promise<readonly McpServerInfo[]> {
    return this.rpc.listWorkspaceMcpServers(workDir);
  }

  async installPlugin(source: string): Promise<PluginSummary> {
    return this.rpc.installPlugin(source);
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    return this.rpc.setPluginEnabled(id, enabled);
  }

  async setPluginMcpServerEnabled(id: string, server: string, enabled: boolean): Promise<void> {
    return this.rpc.setPluginMcpServerEnabled(id, server, enabled);
  }

  async removePlugin(id: string): Promise<void> {
    return this.rpc.removePlugin(id);
  }

  async reloadPlugins(): Promise<ReloadSummary> {
    return this.rpc.reloadPlugins();
  }

  async getPluginInfo(id: string): Promise<PluginInfo> {
    return this.rpc.getPluginInfo(id);
  }

  /**
   * Trust state of `workDir` (SpiderByte Agent Core only; the v1 engine reports an
   * always-trusted workspace). Querying may register the workDir as a
   * workspace, which session creation would do anyway.
   */
  async getWorkspaceTrustInfo(workDir: string): Promise<WorkspaceTrustInfo> {
    return this.rpc.getWorkspaceTrustInfo(workDir);
  }

  /** Mark `workDir` as trusted; project-level MCP servers connect live afterwards. */
  async trustWorkspace(workDir: string): Promise<void> {
    return this.rpc.trustWorkspace(workDir);
  }

  async getConfig(options: GetConfigOptions = {}): Promise<SpiderByteConfig> {
    return this.rpc.getConfig(options);
  }

  /** Warnings from the most recent config.toml load; empty when the config is fully valid. */
  async getConfigDiagnostics(): Promise<ConfigDiagnostics> {
    return this.rpc.getConfigDiagnostics();
  }

  async getExperimentalFeatures(): Promise<readonly ExperimentalFeatureState[]> {
    return this.rpc.getExperimentalFeatures();
  }

  async ensureConfigFile(): Promise<void> {
    await this.ensureConfigFileImpl();
  }

  async setConfig(patch: SpiderByteConfigPatch): Promise<SpiderByteConfig> {
    return this.rpc.setConfig(patch);
  }

  async removeProvider(providerId: string): Promise<SpiderByteConfig> {
    return this.rpc.removeProvider(providerId);
  }

  /**
   * Whether several config sections can be persisted as ONE atomic write
   * (see {@link replaceConfigSections}). False on the v1 harness.
   */
  supportsAtomicSectionReplace(): boolean {
    return this.rpc.supportsAtomicSectionReplace();
  }

  /**
   * Replace several top-level config sections in ONE atomic write: a section
   * mapped to `undefined` is cleared, absent sections are left untouched.
   * Replace semantics (unlike {@link setConfig}'s deep-merge), so staged
   * removals are expressed by the written record itself.
   */
  async replaceConfigSections(sections: Record<string, unknown>): Promise<void> {
    return this.rpc.replaceConfigSections(sections);
  }

  /** User-global MCP entries from `<SPIDERBYTE_HOME>/mcp.json` only. */
  async listMcpServers(): Promise<readonly GlobalMcpServerConfig[]> {
    return this.rpc.listGlobalMcpServers();
  }

  async listMcpServerAuthStatuses(): Promise<readonly GlobalMcpServerAuthStatus[]> {
    return this.rpc.listGlobalMcpServerAuthStatuses();
  }

  async addMcpServer(server: GlobalMcpServerConfig): Promise<readonly GlobalMcpServerConfig[]> {
    return this.rpc.addGlobalMcpServer(server);
  }

  async updateMcpServer(server: GlobalMcpServerConfig): Promise<readonly GlobalMcpServerConfig[]> {
    return this.rpc.updateGlobalMcpServer(server);
  }

  async removeMcpServer(name: string): Promise<readonly GlobalMcpServerConfig[]> {
    return this.rpc.removeGlobalMcpServer(name);
  }

  async authenticateMcpServer(
    name: string,
    options: AuthenticateMcpServerOptions,
  ): Promise<void> {
    const started = await this.rpc.beginGlobalMcpServerAuth(name);
    if (started.status === 'already-authorized') return;
    try {
      const opened = await options.onAuthorizationUrl(started.authorizationUrl ?? '');
      if (opened === false) {
        throw new SpiderByteError(ErrorCodes.REQUEST_INVALID, 'MCP OAuth authorization was cancelled');
      }
      await this.rpc.completeGlobalMcpServerAuth(
        { flowId: started.flowId ?? '', timeoutMs: options.timeoutMs },
        options.signal,
      );
    } catch (error) {
      await this.rpc.cancelGlobalMcpServerAuth(started.flowId ?? '').catch(() => undefined);
      throw error;
    }
  }

  async resetMcpServerAuth(name: string): Promise<void> {
    return this.rpc.resetGlobalMcpServerAuth(name);
  }

  async testMcpServer(
    name: string,
    options: TestMcpServerOptions = {},
  ): Promise<McpTestResult> {
    return this.rpc.testGlobalMcpServer(name, options);
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.activeSessions.values(), (session) => session.close()));
    await this.closeImpl();
  }

  private trackSessionEvent(eventSessionId: string, event: string): void {
    withTelemetryContext(this.telemetry, { sessionId: eventSessionId }).track(event);
  }

  private trackSessionStarted(
    eventSessionId: string,
    resumed: boolean,
    sessionScoped?: TelemetryProperties,
  ): void {
    withTelemetryContext(this.telemetry, { sessionId: eventSessionId }).track('session_started', {
      ...this.sessionStartedProperties,
      ...sessionScoped,
      // Canonical fields are owned by the harness and must win over any
      // caller-supplied sessionStartedProperties that happen to share a key.
      // `client_id` is always null here: a single-process host has no
      // per-connection client id (that concept only exists for daemon clients,
      // see core-impl.ts). Kept as an explicit key so both producers share the
      // same session_started schema.
      client_id: null,
      client_name: this.identity?.productName ?? null,
      client_version: this.identity?.version ?? null,
      ui_mode: this.uiMode,
      resumed,
    });
  }
}

const DEFAULT_SESSION_STARTED_UI_MODE = 'shell';

function normalizeSessionId(value: string): string {
  if (typeof value !== 'string') {
    throw new SpiderByteError(ErrorCodes.SESSION_ID_REQUIRED, 'Session id is required.');
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new SpiderByteError(ErrorCodes.SESSION_ID_EMPTY, 'Session id cannot be empty.');
  }
  return normalized;
}
