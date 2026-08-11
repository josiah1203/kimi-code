/**
 * BackgroundManager — manages background tasks for an agent.
 *
 * Tracks background bash tasks and background subagent tasks.
 *
 * Each task gets a unique ID, captures stdout+stderr to a ring buffer,
 * and supports status query / output retrieval / stop operations.
 *
 * Concrete task classes own execution details; the manager owns task
 * registration, lifecycle state, persistence, output, and notifications.
 */
import type { Agent } from '../..';
import type { BackgroundTaskOrigin } from '../context';
import { type BackgroundTaskPersistence } from './persist';
import { type BackgroundTask, type BackgroundTaskInfo, type BackgroundTaskStatus } from './task';
/**
 * `'lost'` is a reconcile-only terminal state. Tasks loaded from disk
 * that were marked `running` at startup but have no live KaosProcess
 * (the previous CLI process died) are reclassified as lost.
 */
export declare function isBackgroundTaskTerminal(status: BackgroundTaskStatus): boolean;
/**
 * Resolve the effective background-task concurrency cap. Precedence:
 * `KIMI_CODE_BACKGROUND_MAX_RUNNING_TASKS` (positive integer) → config
 * (`background.max_running_tasks`) → `undefined` (no cap). An invalid env
 * value is ignored.
 */
export declare function resolveMaxRunningTasks(configValue?: number): number | undefined;
export { AgentBackgroundTask } from './agent-task';
export type { AgentBackgroundTaskInfo } from './agent-task';
export { ProcessBackgroundTask } from './process-task';
export type { ProcessBackgroundTaskInfo } from './process-task';
export { QuestionBackgroundTask } from './question-task';
export type { QuestionBackgroundTaskInfo } from './question-task';
export { BackgroundTaskPersistence } from './persist';
export type { BackgroundTaskInfo, BackgroundTaskStatus, } from './task';
export interface BackgroundTaskOutputSnapshot {
    readonly outputPath?: string;
    readonly outputSizeBytes: number;
    readonly previewBytes: number;
    readonly truncated: boolean;
    readonly fullOutputAvailable: boolean;
    readonly preview: string;
}
export interface RegisterBackgroundTaskOptions {
    /**
     * When false, the task is tracked by the manager but a foreground tool call
     * is still waiting for it. It can later be detached through RPC.
     */
    readonly detached?: boolean;
    /** Deadline owned by BackgroundManager. `0` and `undefined` do not arm a timer. */
    readonly timeoutMs?: number;
    /**
     * When set, detaching a foreground task resets its deadline to this value
     * (counted from the detach moment). Lets a command started with a short
     * foreground timeout run longer once it is moved to the background.
     */
    readonly detachTimeoutMs?: number;
    /**
     * When true, a foreground task whose deadline fires is detached to the
     * background (re-armed to `detachTimeoutMs`) instead of being killed.
     * Only meaningful for non-detached registrations.
     */
    readonly autoBackgroundOnTimeout?: boolean;
    /** Foreground caller signal. Ignored for tasks created already detached. */
    readonly signal?: AbortSignal;
}
export type ForegroundTaskReleaseReason = 'detached' | 'timeout_detached' | 'terminal';
export declare class BackgroundManager {
    private readonly agent;
    private readonly persistence?;
    private readonly tasks;
    /**
     * Ghosts: tasks loaded from disk during reconcile that have no live
     * KaosProcess. They appear in `list()` / `getTask()` with status
     * `lost` so users see what was running before the crash/restart.
     */
    private readonly ghosts;
    private readonly scheduledNotificationKeys;
    private readonly deliveredNotificationKeys;
    constructor(agent: Agent, persistence?: BackgroundTaskPersistence | undefined);
    private fireTerminalEffects;
    private emitTaskStarted;
    private emitTaskTerminated;
    private assertCanRegister;
    private activeBackgroundAdmissionCount;
    private startedInBackground;
    private isDetached;
    /**
     * Foreground tasks opted into auto-background survive their first deadline
     * by detaching to the background instead of being killed.
     */
    private canAutoBackgroundOnTimeout;
    registerTask(task: BackgroundTask, options?: RegisterBackgroundTaskOptions): string;
    /** Get info about a specific task. Falls back to reconcile ghosts. */
    getTask(taskId: string): BackgroundTaskInfo | undefined;
    /**
     * List tasks, optionally filtering to active-only.
     *
     * When `activeOnly=false`, includes reconcile ghosts (lost tasks
     * from a prior CLI process) so the user sees what survived the
     * restart. Active-only mode never shows ghosts (they're terminal).
     */
    list(activeOnly?: boolean, limit?: number): BackgroundTaskInfo[];
    private shouldListTask;
    /**
     * Return the output snapshot used by TaskOutput.
     *
     * Persisted logs are preferred when the task was registered with an
     * output session directory and `output.log` has actually been created,
     * because they are the complete, never-truncated source. Detached managers,
     * tasks registered before a session dir was attached, and silent tasks with
     * no persisted log fall back to the live ring buffer.
     */
    getOutputSnapshot(taskId: string, maxPreviewBytes: number): Promise<BackgroundTaskOutputSnapshot>;
    readOutput(taskId: string, tail?: number): Promise<string>;
    suppressTerminalNotification(taskId: string): Promise<void>;
    /**
     * Move a foreground task to the background, releasing its tool-call waiter.
     * `viaTimeout` marks an automatic detach triggered by the task deadline (vs.
     * an explicit user/RPC detach) so the waiter can word its result.
     */
    detach(taskId: string, viaTimeout?: boolean): BackgroundTaskInfo | undefined;
    persistOutput(taskId: string): void;
    /** Stop a running task. SIGTERM → 5s grace → SIGKILL. */
    stop(taskId: string, reason?: string): Promise<BackgroundTaskInfo | undefined>;
    stopAll(reason?: string): Promise<readonly BackgroundTaskInfo[]>;
    /**
     * Wait for a task to reach a terminal state.
     * Returns immediately if already terminal. Times out after `timeoutMs`.
     */
    wait(taskId: string, timeoutMs?: number): Promise<BackgroundTaskInfo | undefined>;
    /**
     * Wait until no active (non-terminal) task matching `predicate` remains.
     *
     * Used by print-mode (`kimi -p`) turn draining to hold a turn open while
     * background subagents are still running. Re-enumerates after each batch
     * settles so tasks registered during the wait (fan-out) are picked up.
     * Resolves immediately when nothing matches. Bounded by `timeoutMs`; once
     * the deadline passes the method returns without waiting for stragglers.
     * Rejects with the abort reason when `signal` is aborted.
     */
    waitForActiveTasks(predicate: (info: BackgroundTaskInfo) => boolean, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    /**
     * Wait until a foreground task either detaches from the current tool call or
     * reaches a terminal state. Detached tasks return immediately.
     */
    waitForForegroundRelease(taskId: string): Promise<ForegroundTaskReleaseReason | undefined>;
    /**
     * Load persisted task records into the ghost map. Does NOT reconcile
     * (call `reconcile()` after `loadFromDisk()`). Idempotent; subsequent
     * calls overwrite the ghost map.
     */
    loadFromDisk(): Promise<void>;
    /**
     * Reconcile loaded ghost tasks. Any ghost with status `running` is
     * reclassified as `lost` (its previous CLI process died without
     * writing a terminal state). Updates the on-disk record and returns
     * the lost task snapshots so the caller can emit user-facing notifications.
     */
    private markLoadedTasksLost;
    reconcile(): Promise<void>;
    /**
     * Persist the current state of a live ManagedTask. Called from
     * `registerTask()` and the lifecycle finally block. No-op unless attached.
     */
    private persistLive;
    private appendOutput;
    /** Enqueue an `output.log` append, serialized per task. No-op when detached managers omit persistence. */
    private appendTaskOutput;
    /**
     * Begin persisting `output.log` for a task that buffered while foreground.
     * Flushes the buffered pre-detach output first (in order, ahead of the live
     * stream) so the on-disk log stays complete, then releases the buffer.
     * Idempotent.
     */
    private startOutputPersist;
    private restoreBackgroundTaskNotifications;
    private notifyBackgroundTask;
    private restoreBackgroundTaskNotification;
    private buildBackgroundTaskNotificationContext;
    private fireNotificationHook;
    markDeliveredNotification(origin: BackgroundTaskOrigin): void;
    private isTerminalNotificationSuppressed;
    private runTaskLifecycle;
    private signalOutcome;
    private settlementForOutcome;
    private finalizeTask;
    private toInfo;
}
