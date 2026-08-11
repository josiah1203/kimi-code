import { type TokenUsage } from '@spiderbyte/kosong';
import type { RunSubagentOptions, SpawnSubagentOptions, SubagentHandle } from './subagent-host';
import type { SubagentModelChoice } from './subagent-binding';
type BaseQueuedSubagentTask<T> = {
    readonly data: T;
    readonly profileName: string;
    readonly parentToolCallId: string;
    readonly parentToolCallUuid?: string;
    readonly prompt: string;
    readonly description: string;
    readonly swarmIndex?: number;
    readonly swarmItem?: string;
    readonly runInBackground: boolean;
    readonly timeout?: number;
    readonly signal?: AbortSignal;
    readonly modelChoice?: SubagentModelChoice;
};
export type SpawnQueuedSubagentTask<T = unknown> = BaseQueuedSubagentTask<T> & {
    readonly kind: 'spawn';
    readonly resumeAgentId?: undefined;
};
export type ResumeQueuedSubagentTask<T = unknown> = BaseQueuedSubagentTask<T> & {
    readonly kind: 'resume';
    readonly resumeAgentId: string;
};
export type QueuedSubagentTask<T = unknown> = SpawnQueuedSubagentTask<T> | ResumeQueuedSubagentTask<T>;
export type SubagentResult<T = unknown> = {
    readonly task: QueuedSubagentTask<T>;
    readonly agentId?: string;
    readonly status: 'completed' | 'failed' | 'aborted';
    readonly state?: 'started' | 'not_started';
    readonly result?: string;
    readonly usage?: TokenUsage;
    readonly error?: string;
};
export type SubagentSuspendedEvent = {
    readonly task: QueuedSubagentTask;
    readonly agentId: string;
    readonly reason: string;
};
export type SubagentBatchLauncher = {
    spawn(options: SpawnSubagentOptions): Promise<SubagentHandle>;
    resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
    retry(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
    suspended?(event: SubagentSuspendedEvent): void;
};
export type SubagentBatchOptions = {
    /**
     * Optional cap on how many subagents may run concurrently during the normal
     * phase. `undefined` means no cap (legacy ramp behavior). The rate-limit
     * phase is governed by its own capacity logic and is not affected.
     */
    readonly maxConcurrency?: number;
};
export declare class SubagentBatch<T> {
    private readonly launcher;
    private readonly states;
    private readonly pending;
    private readonly results;
    private readonly active;
    private readonly controller;
    private readonly batchSignal;
    private readonly batchAbortListener;
    private readonly maxConcurrency;
    private normalLaunchCount;
    private normalLaunchTimer;
    private rateLimitLaunchTimer;
    private resolve;
    private reject;
    private finished;
    private started;
    private rateLimitMode;
    private startedSuccessCount;
    private rateLimitCapacity;
    private lastRateLimitAt;
    private lastCapacityShrinkAt;
    private lastCapacityRecoveryAt;
    private globalRetryIntervalMs;
    private nextRateLimitLaunchAt;
    constructor(launcher: SubagentBatchLauncher, tasks: readonly QueuedSubagentTask<T>[], options?: SubagentBatchOptions);
    run(): Promise<Array<SubagentResult<T>>>;
    private schedule;
    private scheduleNormalLaunch;
    private isAtConcurrencyLimit;
    private scheduleRateLimitLaunch;
    private startAttempt;
    private runAttempt;
    private failedAttemptOutcome;
    private markAttemptReady;
    private handleAttemptOutcome;
    private handleAttemptError;
    private releaseAttempt;
    private requeueRateLimited;
    private enterRateLimitMode;
    private shrinkRateLimitCapacity;
    private recoverRateLimitCapacity;
    private nextRateLimitCapacityRecoveryAt;
    private scheduleRateLimitWakeup;
    private scheduleNextRateLimitWakeup;
    private nextPendingReadyAt;
    private finishIfComplete;
    private isOnlyUnfinishedTask;
    private finishWithUserCancellation;
    private finish;
    private fail;
    private cleanup;
    private clearNormalTimer;
    private clearRateLimitTimer;
    private linkAttemptSignals;
    private attemptErrorMessage;
}
/**
 * Resolve the optional AgentSwarm normal-phase concurrency cap from the environment.
 *
 * Returns `undefined` when the variable is unset/empty. A present value must be a
 * positive integer; invalid input fails fast so a misconfigured cap never silently
 * reverts to the uncapped ramp.
 */
export declare function resolveSwarmMaxConcurrency(env?: Readonly<Record<string, string | undefined>>): number | undefined;
export {};
