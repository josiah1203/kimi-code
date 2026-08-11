/**
 * CronScheduler — the scheduling engine.
 *
 * This is the bottom of the cron stack: it knows about tasks, clocks,
 * jitter, and "is the REPL idle?", but nothing about agents, tools,
 * persistence, locks, or the file system. Persistence is layered on
 * top by `CronManager` writing through to per-id JSON files; the
 * scheduler stays oblivious so its tick-loop tests can run with a
 * pure in-memory `source()`.
 *
 * Design notes worth keeping near the code:
 *
 *   - **No direct wall-clock reads.** Every wall-clock read goes
 *     through `clocks.wallNow()`. The companion `no-date-now.test.ts`
 *     enforces this at the file level; bypassing the abstraction
 *     here would break bench / test clock injection.
 *
 *   - **`source()` is called every tick.** It returns the *current*
 *     task list. Callers (the manager) typically wire it to
 *     `() => store.list()`, so creating / deleting tasks between ticks
 *     is picked up automatically. Keep `source()` cheap.
 *
 *   - **`isIdle()` gates fires, not state updates.** When the REPL is
 *     mid-turn we skip firing — but we do NOT advance `lastSeenAt`. The
 *     next idle tick will see the tasks as still due and fire them,
 *     with `coalescedCount` reflecting the gap (so the LLM knows it
 *     missed N ideal fires while the user was talking).
 *
 *   - **`coalescedCount` semantics.** When a sleep / busy turn / system
 *     pause causes the scheduler to miss multiple ideal fires, we
 *     deliver exactly ONE `onFire` call and tell the caller how many
 *     ideal fires we collapsed into it. Floor at 1 — every fire that
 *     happens counts as at least one occurrence.
 *
 *   - **`inFlight` is cleared at end of tick.** `onFire` is synchronous
 *     (the manager's steer is fire-and-forget). The set exists only to
 *     defend against re-entrant ticks within the same call stack — a
 *     theoretical concern, but cheap insurance.
 *
 *   - **Bad tasks do not poison the loop.** Each task's processing is
 *     wrapped in try/catch; failures are swallowed (with an optional
 *     stderr trace gated on `KIMI_CRON_DEBUG=1`) so one busted cron
 *     expression cannot starve the other tasks.
 */
import type { ClockSources } from './clock';
import type { CronTask } from './types';
export interface CronSchedulerOptions {
    /** Required. Wall + monotonic clock source. */
    readonly clocks: ClockSources;
    /**
     * Required. Returns the live task list (e.g. `() => store.list()`).
     * Called every tick — keep cheap.
     */
    readonly source: () => readonly CronTask[];
    /**
     * Required. Called when a task fires. `coalescedCount >= 1`; > 1
     * when the scheduler slept past multiple ideal fires.
     */
    readonly onFire: (task: CronTask, ctx: {
        readonly coalescedCount: number;
    }) => void;
    /**
     * Required. Returns true when the REPL is idle and the scheduler
     * may deliver a fire NOW. False during an active turn so we don't
     * dump a cron fire mid-stream. When false, the tick returns without
     * firing but does not lose tasks — the next idle tick fires them
     * with coalescedCount reflecting the gap.
     */
    readonly isIdle: () => boolean;
    /**
     * Optional. Returns true when the global killswitch is on; tick()
     * short-circuits to no-op.
     */
    readonly isKilled?: () => boolean;
    /**
     * Optional. Called when a one-shot task fires and must be removed
     * from the store. Defaults to a no-op (manager is responsible).
     */
    readonly removeOneShot?: (id: string) => void;
    /**
     * Optional. Called after a recurring task fires successfully, with
     * the wall-clock timestamp of the last ideal occurrence whose
     * jittered delivery has just been delivered. The manager wires this
     * to `store.markFired(id, ts)` + a per-id JSON write so resuming the
     * session does not replay the fire.
     *
     * Fire-and-forget: the scheduler does not wait for persistence to
     * settle. One-shot tasks do not invoke this callback (the
     * `removeOneShot` path handles them).
     */
    readonly onAdvanceCursor?: (taskId: string, lastFiredAt: number) => void;
    /**
     * Optional. Poll interval for the auto-tick setInterval, in ms.
     *   - undefined (default) → 1000ms.
     *   - 0 or null → no automatic polling. Caller drives tick()
     *     manually.
     *
     * Used by P1.8 to wire `KIMI_CRON_MANUAL_TICK=1` to disable the
     * timer.
     */
    readonly pollIntervalMs?: number | null;
}
export interface CronScheduler {
    /** Begin the auto-tick loop. Idempotent — calling twice is a no-op. */
    start(): void;
    /**
     * Stop the auto-tick loop and clear any in-flight bookkeeping.
     * Idempotent.
     */
    stop(): Promise<void>;
    /**
     * Run one check cycle synchronously. Safe to call before start() or
     * after stop().
     */
    tick(): void;
    /**
     * Earliest theoretical (post-jitter) next fire across all current
     * tasks, or null if there are no tasks or none have a future fire.
     * Used by /cron and by external monitoring.
     */
    getNextFireTime(): number | null;
    /**
     * Post-jitter next-fire for a single task using the scheduler's
     * internal `lastSeenAt` baseline. Returns null if the task isn't in
     * the current `source()` snapshot or its expression yields no future
     * fire. Used by CronList so its rendered `nextFireAt` matches what
     * the scheduler will actually deliver, including the in-flight
     * jittered slot of the current period.
     */
    getNextFireForTask(taskId: string): number | null;
}
export declare function createCronScheduler(opts: CronSchedulerOptions): CronScheduler;
