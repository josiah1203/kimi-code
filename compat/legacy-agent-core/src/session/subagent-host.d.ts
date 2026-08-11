import { type TokenUsage } from '@spiderbyte/kosong';
import type { Agent } from '../agent';
import { type ResolvedAgentProfile } from '../profile';
import type { Session } from './index';
import { type SubagentModelChoice } from './subagent-binding';
import { type SubagentResult, type SubagentSuspendedEvent, type QueuedSubagentTask } from './subagent-batch';
export declare const DEFAULT_SUBAGENT_TIMEOUT_MS: number;
export declare const DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION = "2 hours";
/**
 * Resolve the effective subagent per-task timeout. Precedence:
 * `KIMI_SUBAGENT_TIMEOUT_MS` (integer ms) → `configMs` →
 * `DEFAULT_SUBAGENT_TIMEOUT_MS` (2 hours). `0` means no timeout: the value
 * feeds the background-task manager's per-task timeout (where `0` arms no
 * timer), so it governs foreground and background subagents (and AgentSwarm).
 */
export declare function resolveSubagentTimeoutMs(configMs?: number): number;
/** Human-readable duration for the subagent timeout message. */
export declare function formatSubagentTimeoutDescription(ms: number): string;
export type { SubagentResult as QueuedSubagentRunResult, QueuedSubagentTask, ResumeQueuedSubagentTask, SpawnQueuedSubagentTask, } from './subagent-batch';
export interface RunSubagentOptions {
    readonly parentToolCallId: string;
    readonly parentToolCallUuid?: string;
    readonly prompt: string;
    readonly description: string;
    readonly swarmIndex?: number;
    readonly runInBackground: boolean;
    readonly signal: AbortSignal;
    readonly onReady?: () => void;
    readonly suppressRateLimitFailureEvent?: boolean;
}
export interface SpawnSubagentOptions extends RunSubagentOptions {
    readonly profileName: string;
    readonly swarmItem?: string;
    /**
     * Explicit per-spawn model choice from the tool call. The profile's own
     * `modelPreference` applies when this is omitted; both only take effect
     * with the `secondary-model` experiment enabled.
     */
    readonly modelChoice?: SubagentModelChoice;
}
type SubagentCompletion = {
    readonly result: string;
    readonly usage?: TokenUsage;
};
type OwnerAgentResolver = () => Agent;
export type SubagentHandle = {
    readonly agentId: string;
    readonly profileName: string;
    readonly resumed: boolean;
    readonly completion: Promise<SubagentCompletion>;
};
export declare class SessionSubagentHost {
    private readonly session;
    private readonly ownerAgentId;
    private readonly getOwnerAgent?;
    private readonly activeChildren;
    constructor(session: Session, ownerAgentId: string, getOwnerAgent?: OwnerAgentResolver | undefined);
    spawn(options: SpawnSubagentOptions): Promise<SubagentHandle>;
    resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
    retry(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
    private ensureIdleSubagent;
    runQueued<T>(tasks: readonly QueuedSubagentTask<T>[]): Promise<Array<SubagentResult<T>>>;
    suspended(event: SubagentSuspendedEvent): void;
    startBtw(): Promise<string>;
    cancelAll(reason?: unknown): void;
    markActiveChildDetached(agentId: string): void;
    getProfileName(agentId: string): Promise<string | undefined>;
    getSwarmItem(agentId: string): string | undefined;
    private resolveProfile;
    /**
     * The subagent types the given profile may delegate to (its own linked set,
     * or the default profile's when it declares none). Backs the `Agent` tool's
     * "Available agent types" description.
     */
    delegatableSubagents(callerProfileName?: string): Record<string, ResolvedAgentProfile>;
    private resolveDelegatableSubagents;
    private runWithActiveChild;
    private runPromptTurn;
    private waitForChildCompletion;
    private configureChild;
    /**
     * The model a newly spawned subagent binds to: the configured secondary
     * model by default (when the experiment is on), otherwise the parent's
     * model and effort, inherited as before. The bound alias is validated up
     * front so a dangling `[secondary_model]` pointer fails the spawn with a
     * wrapped, actionable error instead of a mid-turn provider failure.
     */
    private resolveSpawnBinding;
    /**
     * Resume/retry historically re-synced the child to the parent's current
     * model so subagents follow mid-session `/model` switches. With the
     * `secondary-model` experiment on, a resumed subagent instead keeps the
     * model it was bound to at spawn (v2 semantics: no child-follows-parent
     * invariant).
     */
    private reInheritParentModel;
    /**
     * Hold the run open until the child agent's background tasks (background
     * Bash, nested background agents) settle — the print-mode (`kimi -p`)
     * drain semantics applied to subagent completion. Drained tasks get their
     * terminal notifications suppressed: without that, a task outliving the
     * child's final turn steers a fresh turn on the finished subagent
     * (`steer` degrades to `launch`), which runs unobserved and whose output
     * never reaches the parent. Bounded by the run's signal — the Agent
     * tool's per-run timeout / user-cancel envelope covers the drain too.
     */
    private drainChildBackgroundTasks;
    /**
     * Suppress terminal notifications for every child background task —
     * including already-settled ones whose notification may still be in
     * flight. `list(false)` is required: the active-only list drops a task
     * the moment it terminates, which is exactly when an unsuppressed
     * notification can still steer an orphan turn onto the finished child.
     */
    private suppressChildTaskNotifications;
    private triggerSubagentStart;
    private triggerSubagentStop;
    private observeFirstRequest;
    private emitSubagentSpawned;
    private emitSubagentStarted;
    private emitSubagentFailed;
}
