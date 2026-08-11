import {
  type AgentContextData,
  type SwarmModeTrigger,
} from '@spiderbyte/agent-core';
import { ErrorCodes, SpiderByteError, type SpiderByteErrorCode } from '#/errors';
import type {
  PlatformEventSubscriptionOptions,
  SessionRunsFacade,
} from '@spiderbyte/client';
import type { PlatformLifecycleEvent, PlatformModelSelection } from '@spiderbyte/protocol';

import { type ApprovalHandler, type Event, type QuestionHandler } from '#/events';
import type { SpiderBytePlatformClient } from '#/platform';
import type { SDKRpcClientBase } from '#/rpc';
import type {
  AddAdditionalDirOptions,
  AddAdditionalDirResult,
  AgentCommandInfo,
  BackgroundTaskInfo,
  CompactOptions,
  CreateGoalInput,
  GetCronTasksResult,
  GoalSnapshot,
  GoalToolResult,
  JsonObject,
  McpServerInfo,
  McpStartupMetrics,
  PermissionMode,
  PluginInfo,
  PluginSummary,
  PromptInput,
  ReloadSessionOptions,
  ReloadSummary,
  ResumedSessionState,
  ResumedSessionSummary,
  SessionPlan,
  SessionStatus,
  SessionSummary,
  SessionUsage,
  SkillSummary,
  PluginCommandDef,
  ThinkingEffort,
  Unsubscribe,
} from '#/types';

const MAIN_AGENT_ID = 'main';

export interface SessionOptions {
  readonly id: string;
  readonly workDir: string;
  readonly summary?: SessionSummary | undefined;
  readonly resumeState?: ResumedSessionState | undefined;
  readonly rpc: SDKRpcClientBase;
  readonly onClose?: (() => void | Promise<void>) | undefined;
  /** Canonical v2 durable Run facade; absent on v1/daemon-backed sessions. */
  readonly platformRuns?: SessionRunsFacade;
  /** Workspace platform facade used for reconnectable lifecycle events. */
  readonly platform?: SpiderBytePlatformClient;
}

export interface SessionPlatformEventOptions extends PlatformEventSubscriptionOptions {
  /** Start replay after this workspace event sequence (defaults to zero). */
  readonly afterSequence?: number;
  /** Disable replay when the caller only needs future live events. */
  readonly replay?: boolean;
}

export class Session {
  readonly id: string;
  readonly workDir: string;
  summary?: SessionSummary | undefined;
  readonly platformRuns: SessionRunsFacade | undefined;
  private resumeState: ResumedSessionState | undefined;

  private readonly rpc: SDKRpcClientBase;
  private readonly onClose?: (() => void | Promise<void>) | undefined;
  private readonly platform: SpiderBytePlatformClient | undefined;
  private closed = false;

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.workDir = options.workDir;
    this.summary = options.summary;
    this.resumeState = options.resumeState ?? resumeStateFromSummary(options.summary);
    this.platformRuns = options.platformRuns;
    this.platform = options.platform;
    this.rpc = options.rpc;
    this.onClose = options.onClose;
  }

  getResumeState(): ResumedSessionState | undefined {
    this.ensureOpen();
    return this.resumeState;
  }

  async reloadSession(options?: ReloadSessionOptions): Promise<ResumedSessionSummary> {
    this.ensureOpen();
    const summary = await this.rpc.reloadSession({
      sessionId: this.id,
      forcePluginSessionStartReminder: options?.forcePluginSessionStartReminder,
    });
    this.summary = summary;
    this.resumeState = resumeStateFromSummary(summary);
    return summary;
  }

  onEvent(listener: (event: Event) => void): Unsubscribe {
    this.ensureOpen();
    return this.rpc.onEvent((event) => {
      if (event.sessionId === this.id) {
        listener(event);
      }
    });
  }

  /**
   * Subscribe to platform lifecycle events for this SpiderByte conversation.
   *
   * The subscription is replay-first and then live: registering the live
   * listener before catch-up closes the reconnect race, while event ids are
   * de-duplicated across the two streams. Events from other sessions in the
   * same workspace are filtered using the durable Run event payload.
   * Returns `undefined` on v1/daemon hosts, where no platform facade exists.
   */
  async subscribePlatformEvents(
    listener: (event: PlatformLifecycleEvent) => void,
    options: SessionPlatformEventOptions = {},
  ): Promise<Unsubscribe | undefined> {
    this.ensureOpen();
    const platform = this.platform;
    if (platform?.workspaceIdForRoot === undefined) return undefined;
    const workspaceId = await platform.workspaceIdForRoot(this.workDir);
    if (workspaceId === undefined) return undefined;

    const delivered = new Set<string>();
    const pending: PlatformLifecycleEvent[] = [];
    let replaying = options.replay !== false;

    const matches = (event: PlatformLifecycleEvent): boolean =>
      event.workspace_id === workspaceId && event.payload?.['agent_session_id'] === this.id;
    const deliver = (event: PlatformLifecycleEvent): void => {
      if (delivered.has(event.event_id)) return;
      delivered.add(event.event_id);
      // Keep reconnect bookkeeping bounded even for a long-lived TUI.
      if (delivered.size > 2_048) delivered.delete(delivered.values().next().value as string);
      listener(event);
    };
    const subscription = platform.platformEvents.subscribe(
      workspaceId,
      (event) => {
        if (!matches(event)) return;
        if (replaying) pending.push(event);
        else deliver(event);
      },
      {
        eventTypes: options.eventTypes,
        entityTypes: options.entityTypes,
        onError: options.onError,
      },
    );

    try {
      if (replaying) {
        let cursor = normalizeSequence(options.afterSequence);
        for (;;) {
          const page = await platform.platformEvents.replay(workspaceId, cursor, 500);
          for (const event of page.events) {
            if (matches(event)) deliver(event);
          }
          if (!page.has_more || page.next_sequence <= cursor) break;
          cursor = page.next_sequence;
        }
        replaying = false;
        pending.sort((left, right) => left.sequence - right.sequence);
        for (const event of pending) deliver(event);
        pending.length = 0;
      }
    } catch (error) {
      subscription.dispose();
      throw error;
    }

    return () => subscription.dispose();
  }

  setApprovalHandler(handler: ApprovalHandler | undefined): void {
    this.ensureOpen();
    this.rpc.setApprovalHandler(this.id, handler);
  }

  setQuestionHandler(handler: QuestionHandler | undefined): void {
    this.ensureOpen();
    this.rpc.setQuestionHandler(this.id, handler);
  }

  async prompt(input: string | PromptInput): Promise<void> {
    this.ensureOpen();
    await this.rpc.prompt({
      sessionId: this.id,
      input: normalizePromptInput(input),
    });
  }

  /** Execute a user-initiated `!` shell command (silent — does not prompt the
   *  model). Resolves with the command's stdout/stderr for immediate display.
   *  Pass `commandId` to receive live `shell.output` events for this command. */
  async runShellCommand(
    command: string,
    options?: { commandId?: string },
  ): Promise<{ stdout: string; stderr: string; isError?: boolean; backgrounded?: boolean }> {
    this.ensureOpen();
    return this.rpc.runShellCommand({
      sessionId: this.id,
      command,
      commandId: options?.commandId,
    });
  }

  /** Cancel a running `!` shell command by its commandId (e.g. on Esc / Ctrl+C). */
  async cancelShellCommand(commandId: string): Promise<void> {
    this.ensureOpen();
    return this.rpc.cancelShellCommand({ sessionId: this.id, commandId });
  }

  async steer(input: string | PromptInput): Promise<void> {
    this.ensureOpen();
    await this.rpc.steer({
      sessionId: this.id,
      input: normalizePromptInput(input),
    });
  }

  async swarm(input: string | PromptInput): Promise<void> {
    this.ensureOpen();
    await this.rpc.swarm({
      sessionId: this.id,
      input: normalizePromptInput(input),
    });
  }

  async init(): Promise<void> {
    this.ensureOpen();
    await this.rpc.generateAgentsMd({ sessionId: this.id });
  }

  async getSessionWarnings() {
    this.ensureOpen();
    return this.rpc.getSessionWarnings({ sessionId: this.id });
  }

  async addAdditionalDir(
    path: string,
    options?: AddAdditionalDirOptions,
  ): Promise<AddAdditionalDirResult> {
    this.ensureOpen();
    const normalized = normalizeRequiredString(
      path,
      'Additional directory cannot be empty',
      ErrorCodes.REQUEST_INVALID,
    );
    const result = await this.rpc.addAdditionalDir({
      id: this.id,
      path: normalized,
      persist: options?.persist ?? true,
    });
    this.summary = { ...this.requireSummary(), additionalDirs: result.additionalDirs };
    return result;
  }

  async startBtw(): Promise<string> {
    this.ensureOpen();
    return this.rpc.startBtw({ sessionId: this.id });
  }

  async cancel(): Promise<void> {
    this.ensureOpen();
    await this.rpc.cancel({ sessionId: this.id });
  }

  async setModel(model: string): Promise<void> {
    this.ensureOpen();
    const normalized = normalizeRequiredString(
      model,
      'Session model cannot be empty',
      ErrorCodes.SESSION_MODEL_EMPTY,
    );
    await this.rpc.setModel({ sessionId: this.id, model: normalized });
  }

  /** Select the canonical platform provider/model for this agent session. */
  async selectPlatformModel(selection: PlatformModelSelection): Promise<PlatformModelSelection> {
    this.ensureOpen();
    return this.rpc.selectPlatformModel({ sessionId: this.id, selection });
  }

  async getPlatformModelSelection(): Promise<PlatformModelSelection | undefined> {
    this.ensureOpen();
    return this.rpc.getPlatformModelSelection({ sessionId: this.id });
  }

  async clearPlatformModelSelection(): Promise<void> {
    this.ensureOpen();
    await this.rpc.clearPlatformModelSelection({ sessionId: this.id });
  }

  async setThinking(effort: ThinkingEffort): Promise<void> {
    this.ensureOpen();
    const normalized = normalizeRequiredString(
      effort,
      'Session thinking effort cannot be empty',
      ErrorCodes.SESSION_THINKING_EMPTY,
    );
    await this.rpc.setThinking({ sessionId: this.id, effort: normalized });
  }

  /**
   * Live-apply the persisted `[secondary_model]` recipe to this session
   * (subagent model binding). Persist the recipe via `SpiderByteHarness.setConfig`
   * first; this reloads the complete recipe and its synthesized derived entry
   * before updating the session snapshot — mirroring the `/secondary_model`
   * flow.
   */
  async applyPersistedSecondaryModel(): Promise<void> {
    this.ensureOpen();
    await this.rpc.applyPersistedSecondaryModel({ sessionId: this.id });
  }

  async setPermission(mode: PermissionMode): Promise<void> {
    this.ensureOpen();
    if (!isPermissionMode(mode)) {
      throw new SpiderByteError(
        ErrorCodes.SESSION_PERMISSION_MODE_INVALID,
        'Session permission mode must be yolo, manual, or auto',
      );
    }
    await this.rpc.setPermission({ sessionId: this.id, mode });
  }

  /** Shallow-merge host-owned fields into this session's persisted custom metadata. */
  async updateMetadata(patch: JsonObject): Promise<void> {
    this.ensureOpen();
    if (Object.hasOwn(patch, 'goal')) {
      throw new SpiderByteError(
        ErrorCodes.GOAL_METADATA_RESERVED,
        'Session metadata key "goal" is reserved for the goal lifecycle',
      );
    }
    const summary = this.requireSummary();
    await this.rpc.updateSessionMetadata({ sessionId: this.id, metadata: patch });
    const metadata = { ...summary.metadata, ...patch };
    this.summary = { ...summary, metadata };
    if (this.resumeState !== undefined) {
      this.resumeState = {
        ...this.resumeState,
        sessionMetadata: {
          ...this.resumeState.sessionMetadata,
          custom: { ...this.resumeState.sessionMetadata.custom, ...patch },
        },
      };
    }
  }

  async setPlanMode(enabled: boolean): Promise<void> {
    this.ensureOpen();
    if (typeof enabled !== 'boolean') {
      throw new SpiderByteError(
        ErrorCodes.SESSION_PLAN_MODE_INVALID,
        'Session plan mode must be a boolean',
      );
    }
    await this.rpc.setPlanMode({ sessionId: this.id, enabled });
  }

  async setSwarmMode(enabled: boolean, trigger: SwarmModeTrigger): Promise<void> {
    this.ensureOpen();
    if (typeof enabled !== 'boolean') {
      throw new SpiderByteError(
        ErrorCodes.REQUEST_INVALID,
        'Session swarm mode must be a boolean',
      );
    }
    if (enabled) {
      await this.rpc.setSwarmMode({ sessionId: this.id, enabled: true, trigger });
    } else {
      await this.rpc.setSwarmMode({ sessionId: this.id, enabled: false });
    }
  }

  async getPlan(): Promise<SessionPlan> {
    this.ensureOpen();
    return this.rpc.getPlan({ sessionId: this.id });
  }

  async clearPlan(): Promise<void> {
    this.ensureOpen();
    await this.rpc.clearPlan({ sessionId: this.id });
  }

  async compact(options: CompactOptions = {}): Promise<void> {
    this.ensureOpen();
    const instruction = normalizeOptionalString(options.instruction);
    await this.rpc.compact({
      sessionId: this.id,
      ...(instruction !== undefined ? { instruction } : {}),
    });
  }

  async cancelCompaction(): Promise<void> {
    this.ensureOpen();
    await this.rpc.cancelCompaction({ sessionId: this.id });
  }

  async undoHistory(count: number = 1): Promise<void> {
    this.ensureOpen();
    await this.rpc.undoHistory({ sessionId: this.id, count });
  }

  /** Clear this session's model context without creating a new session. */
  async clearContext(): Promise<void> {
    this.ensureOpen();
    await this.rpc.clearContext({ sessionId: this.id });
  }

  /** Append imported text to this session's context without prompting the model. */
  async importContext(content: string, source: string): Promise<void> {
    this.ensureOpen();
    await this.rpc.importContext({ sessionId: this.id, content, source });
  }

  async getContext(): Promise<AgentContextData> {
    this.ensureOpen();
    return this.rpc.getContext({ sessionId: this.id });
  }

  async getUsage(): Promise<SessionUsage> {
    this.ensureOpen();
    return this.rpc.getUsage({ sessionId: this.id });
  }

  async getStatus(): Promise<SessionStatus> {
    this.ensureOpen();
    return this.rpc.getStatus({ sessionId: this.id });
  }

  async listSkills(): Promise<readonly SkillSummary[]> {
    this.ensureOpen();
    return this.rpc.listSkills({ sessionId: this.id });
  }

  async listPluginCommands(): Promise<readonly PluginCommandDef[]> {
    this.ensureOpen();
    return this.rpc.listPluginCommands({ sessionId: this.id });
  }

  /**
   * Contributed commands registered with this session's interactive agent
   * (SpiderByte Agent Core only — a v1-backed session reports the empty set).
   */
  async listCommands(): Promise<readonly AgentCommandInfo[]> {
    this.ensureOpen();
    return this.rpc.listCommands({ sessionId: this.id });
  }

  /**
   * List background tasks for this session's interactive agent.
   *
   * Defaults to all tasks (including terminal/lost). Pass
   * `{ activeOnly: true }` to filter to non-terminal entries.
   */
  async listBackgroundTasks(
    options: { activeOnly?: boolean; limit?: number } = {},
  ): Promise<readonly BackgroundTaskInfo[]> {
    this.ensureOpen();
    return this.rpc.listBackgroundTasks({
      sessionId: this.id,
      activeOnly: options.activeOnly,
      limit: options.limit,
    });
  }

  /**
   * Read a background task's captured output. Returns the in-memory
   * ring buffer if available, otherwise falls back to the persisted
   * `<sessionDir>/tasks/<taskId>/output.log`. `tail` caps the returned
   * string to that many trailing characters.
   */
  async getBackgroundTaskOutput(
    taskId: string,
    options: { tail?: number } = {},
  ): Promise<string> {
    this.ensureOpen();
    const trimmedTaskId = normalizeRequiredString(
      taskId,
      'Task id cannot be empty',
      ErrorCodes.BACKGROUND_TASK_ID_EMPTY,
    );
    return this.rpc.getBackgroundTaskOutput({
      sessionId: this.id,
      taskId: trimmedTaskId,
      tail: options.tail,
    });
  }

  /**
   * Request a running background task to stop. Sends SIGTERM with a
   * grace period (handled by the core BPM); subscribers receive a
   * `background.task.terminated` event when the kill settles. Calls
   * for unknown or already-terminal task ids are no-ops at the core
   * level — this method does not throw in those cases.
   */
  async stopBackgroundTask(
    taskId: string,
    options: { reason?: string } = {},
  ): Promise<void> {
    this.ensureOpen();
    const trimmedTaskId = normalizeRequiredString(
      taskId,
      'Task id cannot be empty',
      ErrorCodes.BACKGROUND_TASK_ID_EMPTY,
    );
    await this.rpc.stopBackgroundTask({
      sessionId: this.id,
      taskId: trimmedTaskId,
      reason: options.reason,
    });
  }

  /**
   * Detach a running foreground task so the current tool call can return while
   * the task continues under background-task management.
   */
  async detachBackgroundTask(taskId: string): Promise<BackgroundTaskInfo | undefined> {
    this.ensureOpen();
    const trimmedTaskId = normalizeRequiredString(
      taskId,
      'Task id cannot be empty',
      ErrorCodes.BACKGROUND_TASK_ID_EMPTY,
    );
    return this.rpc.detachBackgroundTask({
      sessionId: this.id,
      taskId: trimmedTaskId,
    });
  }

  /**
   * Block until every still-running background task (across all agents in this
   * session) reaches a terminal state. Used by `spyderbyte -p` after the main agent's
   * turn finishes when the resolved print background mode is `'drain'`
   * (`print_background_mode = "drain"`, or the legacy
   * `keep_alive_on_exit = true` fallback), so background subagents get a chance to
   * complete before the process
   * exits. No-op in other modes. Bounded by `background.print_wait_ceiling_s`.
   */
  async waitForBackgroundTasksOnPrint(): Promise<void> {
    this.ensureOpen();
    await this.rpc.waitForBackgroundTasksOnPrint({ sessionId: this.id });
  }

  /**
   * Used by `spyderbyte -p` after the main agent's turn ends with
   * `reason === 'completed'`. Returns `'finish'` when the run may exit, or
   * `'continue'` when
   * the caller must keep the session alive so a background-task completion can
   * steer the main agent into a new turn. Policy is selected by
   * `background.print_background_mode` (`'exit' | 'drain' | 'steer'`); when unset
   * it falls back to the legacy `keep_alive_on_exit` mapping (`true ⇒ 'drain'`).
   */
  async handlePrintMainTurnCompleted(): Promise<'finish' | 'continue'> {
    this.ensureOpen();
    return this.rpc.handlePrintMainTurnCompleted({ sessionId: this.id });
  }

  // --- Goal lifecycle ---------------------------------------------------
  // Deterministic user/host control surface. There is intentionally no
  // `updateGoal`: the goal's terminal status is decided by the model via the
  // in-conversation UpdateGoal tool (or the goal driver on budget/error), not
  // by the host.

  async createGoal(input: CreateGoalInput): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.createGoal({ sessionId: this.id, ...input });
  }

  async getGoal(): Promise<GoalToolResult> {
    this.ensureOpen();
    return this.rpc.getGoal({ sessionId: this.id });
  }

  async pauseGoal(): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.pauseGoal({ sessionId: this.id });
  }

  async resumeGoal(): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.resumeGoal({ sessionId: this.id });
  }

  async cancelGoal(): Promise<GoalSnapshot> {
    this.ensureOpen();
    return this.rpc.cancelGoal({ sessionId: this.id });
  }

  /**
   * Enumerate the cron tasks scheduled in this session. Hosts running a
   * bounded session lifetime (e.g. `spyderbyte -p`) poll this to decide whether
   * pending scheduled work still needs the process alive.
   */
  async getCronTasks(): Promise<GetCronTasksResult> {
    this.ensureOpen();
    return this.rpc.getCronTasks({ sessionId: this.id });
  }

  async listMcpServers(): Promise<readonly McpServerInfo[]> {
    this.ensureOpen();
    return this.rpc.listMcpServers({ sessionId: this.id });
  }

  async getMcpStartupMetrics(): Promise<McpStartupMetrics> {
    this.ensureOpen();
    return this.rpc.getMcpStartupMetrics({ sessionId: this.id });
  }

  async reconnectMcpServer(name: string): Promise<void> {
    this.ensureOpen();
    await this.rpc.reconnectMcpServer({ sessionId: this.id, name });
  }

  async listPlugins(): Promise<readonly PluginSummary[]> {
    this.ensureOpen();
    return this.rpc.listPlugins();
  }

  async installPlugin(source: string): Promise<PluginSummary> {
    this.ensureOpen();
    return this.rpc.installPlugin(source);
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    this.ensureOpen();
    await this.rpc.setPluginEnabled(id, enabled);
  }

  async setPluginMcpServerEnabled(
    id: string,
    server: string,
    enabled: boolean,
  ): Promise<void> {
    this.ensureOpen();
    await this.rpc.setPluginMcpServerEnabled(id, server, enabled);
  }

  async removePlugin(id: string): Promise<void> {
    this.ensureOpen();
    await this.rpc.removePlugin(id);
  }

  async reloadPlugins(): Promise<ReloadSummary> {
    this.ensureOpen();
    return this.rpc.reloadPlugins();
  }

  async getPluginInfo(id: string): Promise<PluginInfo> {
    this.ensureOpen();
    return this.rpc.getPluginInfo(id);
  }

  async activateSkill(name: string, args?: string | undefined): Promise<void> {
    this.ensureOpen();
    const skillName = normalizeRequiredString(
      name,
      'Skill name cannot be empty',
      ErrorCodes.SKILL_NAME_EMPTY,
    );
    const skillArgs = normalizeOptionalString(args);
    await this.rpc.activateSkill({
      sessionId: this.id,
      name: skillName,
      ...(skillArgs !== undefined ? { args: skillArgs } : {}),
    });
  }

  async activatePluginCommand(
    pluginId: string,
    commandName: string,
    args?: string | undefined,
  ): Promise<void> {
    this.ensureOpen();
    const normalizedPluginId = pluginId.trim();
    const normalizedCommandName = commandName.trim();
    if (normalizedPluginId.length === 0 || normalizedCommandName.length === 0) {
      throw new SpiderByteError(
        ErrorCodes.REQUEST_INVALID,
        'Plugin id and command name cannot be empty',
      );
    }
    const commandArgs = normalizeOptionalString(args);
    await this.rpc.activatePluginCommand({
      sessionId: this.id,
      pluginId: normalizedPluginId,
      commandName: normalizedCommandName,
      ...(commandArgs !== undefined ? { args: commandArgs } : {}),
    });
  }

  /**
   * Run a contributed command engine-side (SpiderByte Agent Core only — a v1-backed
   * client rejects with `not_implemented`). Unknown names reject with the
   * engine's `request.invalid` error.
   */
  async runCommand(name: string, args?: string): Promise<void> {
    this.ensureOpen();
    const commandName = name.trim();
    if (commandName.length === 0) {
      throw new SpiderByteError(ErrorCodes.REQUEST_INVALID, 'Command name cannot be empty');
    }
    await this.rpc.runCommand({
      sessionId: this.id,
      name: commandName,
      args: normalizeOptionalString(args),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.rpc.closeSession({ sessionId: this.id });
    } finally {
      this.rpc.clearSessionHandlers(this.id);
      await this.onClose?.();
    }
  }

  /** @internal */
  emitMetaUpdated(patch: { readonly title?: string | undefined }): void {
    this.emit({
      type: 'session.meta.updated',
      sessionId: this.id,
      agentId: MAIN_AGENT_ID,
      title: patch.title,
      patch,
    });
  }

  private emit(event: Event): void {
    this.rpc.receiveEvent(event);
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new SpiderByteError(ErrorCodes.SESSION_CLOSED, 'Session is closed');
    }
  }

  private requireSummary(): SessionSummary {
    if (this.summary === undefined) {
      throw new SpiderByteError(ErrorCodes.SESSION_STATE_INVALID, 'Session summary is unavailable');
    }
    return this.summary;
  }
}

function normalizePromptInput(input: string | PromptInput): PromptInput {
  if (typeof input === 'string') {
    if (input.trim().length === 0) {
      throw new SpiderByteError(ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY, 'Prompt input cannot be empty');
    }
    return [{ type: 'text', text: input }];
  }

  if (input.length === 0) {
    throw new SpiderByteError(ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY, 'Prompt input cannot be empty');
  }

  for (const part of input) {
    switch (part.type) {
      case 'text':
        if (part.text.trim().length === 0) {
          throw new SpiderByteError(
            ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY,
            'Prompt input cannot contain empty text parts',
          );
        }
        break;
      case 'image_url':
        if (part.imageUrl.url.trim().length === 0) {
          throw new SpiderByteError(
            ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY,
            'Prompt input cannot contain empty image URLs',
          );
        }
        break;
      case 'video_url':
        if (part.videoUrl.url.trim().length === 0) {
          throw new SpiderByteError(
            ErrorCodes.REQUEST_PROMPT_INPUT_EMPTY,
            'Prompt input cannot contain empty video URLs',
          );
        }
        break;
    }
  }
  return input;
}

function normalizeSequence(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalizeRequiredString(
  value: string,
  message: string,
  code: SpiderByteErrorCode,
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new SpiderByteError(code, message);
  }
  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'yolo' || value === 'manual' || value === 'auto';
}

function resumeStateFromSummary(
  summary: SessionSummary | undefined,
): ResumedSessionState | undefined {
  if (!hasResumeState(summary)) return undefined;
  return {
    sessionMetadata: summary.sessionMetadata,
    agents: summary.agents,
    warning: summary.warning,
  };
}

function hasResumeState(
  summary: SessionSummary | undefined,
): summary is SessionSummary & ResumedSessionState {
  return (
    summary !== undefined &&
    typeof (summary as { readonly sessionMetadata?: unknown }).sessionMetadata === 'object' &&
    (summary as { readonly sessionMetadata?: unknown }).sessionMetadata !== null &&
    typeof (summary as { readonly agents?: unknown }).agents === 'object' &&
    (summary as { readonly agents?: unknown }).agents !== null
  );
}
