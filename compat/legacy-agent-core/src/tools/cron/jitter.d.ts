/**
 * Per-task deterministic jitter for cron fire times.
 *
 * Why this exists: if every user writes `0 9 * * *` ("every day at 9
 * am") then every CLI fires at the same instant and the upstream API
 * sees a thundering herd at :00. We soften that by shifting each
 * task's ideal fire time by a small, **deterministic** per-task
 * offset so a given task always lands at the same jittered point —
 * reschedules and restarts don't drift, and bench reproducibility
 * stays intact when {@link KIMI_CRON_NO_JITTER} is set.
 *
 * Two flavours:
 *
 *   - **Recurring**: shift *forward* by a fraction of the period
 *     (cap 10% of period, hard cap 15 min). Long-period jobs (`0 9 *
 *     * *`, period 1 day) hit the 15-minute cap; short-period jobs
 *     (`*` /5 * * * *`, period 5 min) are bounded by the 10% rule.
 *
 *   - **One-shot**: shift *earlier* (negative), but only when the
 *     ideal lands on `:00` or `:30` — that's the signal the model
 *     picked a round number with no specific intent. Cap 90 s
 *     earlier. Any other minute (`:07`, `:23`, …) passes through
 *     unchanged because the model presumably meant that exact time.
 *
 * The function is pure given its inputs — no module-level cache; the
 * hash is recomputed from `task.id` each call. That trades a handful
 * of cheap arithmetic ops for a guarantee that there is no hidden
 * state to invalidate when a task is rescheduled.
 */
import type { ParsedCronExpression } from './cron-expr';
/** Tunables for {@link jitteredNextCronRunMs} / {@link oneShotJitteredNextCronRunMs}. */
export interface JitterConfig {
    /** Recurring offset cap as a fraction of the cron period (0..1). */
    readonly recurringMaxFractionOfPeriod: number;
    /** Absolute cap on the recurring offset, in ms. */
    readonly recurringMaxMs: number;
    /** Absolute cap on the one-shot pull-forward, in ms. */
    readonly oneShotMaxMs: number;
}
export declare const DEFAULT_CRON_JITTER_CONFIG: JitterConfig;
/**
 * Apply recurring-job jitter to an already-computed ideal fire time.
 *
 * The shift is **forward only** (≥ 0), bounded by both the relative
 * fraction-of-period cap and the absolute ms cap. We discover the
 * period by asking {@link computeNextCronRun} for the run *after*
 * `idealMs`; if that returns `null` (legal-but-never-fires
 * expression — should have been rejected upstream) we fall back to a
 * 24-hour assumption so we still produce some sensible offset rather
 * than spiking on the original `idealMs`.
 */
export declare function jitteredNextCronRunMs(task: {
    id: string;
    cron: string;
    recurring?: boolean;
}, parsed: ParsedCronExpression, idealMs: number, config?: JitterConfig): number;
/**
 * Apply one-shot pull-forward jitter to an ideal fire time.
 *
 * Only fires on `:00` and `:30` of the hour — the minute marks the
 * model is most likely to pick out of habit. Other minutes pass
 * through verbatim so a user who said "remind me at 2:07" gets
 * 2:07 exactly. The shift is in `[-oneShotMaxMs, 0)`; never exactly
 * 0 unless the deterministic hash happens to land on 0 (which is
 * fine — it just means this task is the unlucky one that pays the
 * full delay).
 *
 * When the deterministic offset would land before `task.createdAt`,
 * the jitter budget is too small to safely pull forward: a previous
 * version clamped to `createdAt` itself, but the scheduler condition
 * `now >= nextFireAt` then fires on the very next tick — for the
 * canonical 08:59:30-created `0 9 * * *` case, that means firing
 * ~29 s before the ideal 09:00 mark. We skip jitter instead and
 * return `idealMs` unchanged; the task fires at the ideal time, no
 * earlier. Callers without `createdAt` (legacy test fixtures) get
 * the unclamped pulled-forward value, preserving the previous
 * behaviour for them.
 */
export declare function oneShotJitteredNextCronRunMs(task: {
    id: string;
    createdAt?: number | undefined;
}, idealMs: number, config?: JitterConfig): number;
