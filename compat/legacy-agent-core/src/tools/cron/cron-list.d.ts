/**
 * CronListTool — enumerate the cron tasks currently scheduled in this
 * session.
 *
 * Read-only and side-effect-free. The output mirrors the
 * `key: value\n---\n` shape used by `tools/background/task-list.ts` so
 * the LLM sees a consistent record layout across the "list scheduled
 * work" tools.
 *
 * What each record carries:
 *
 *   - `id`            — the 8-hex task id (also accepted by CronDelete).
 *   - `cron`          — verbatim 5-field expression as scheduled.
 *   - `humanSchedule` — best-effort plain-English rendering via
 *                       `cronToHuman`; falls back to the raw `cron`
 *                       string if the expression can't be parsed.
 *   - `nextFireAt`    — post-jitter local ISO timestamp with offset,
 *                       or the literal
 *                       string `null` when there is no fire in the
 *                       5-year window (or the expression is malformed).
 *                       This is the same jittered value `CronCreate`
 *                       reports, so the LLM can reason about herd-
 *                       avoidance offsets without surprise.
 *   - `recurring`     — `true` unless the task was explicitly created
 *                       with `recurring: false`.
 *   - `ageDays`       — `(wallNow - createdAt) / day`, formatted to two
 *                       decimal places. Useful context for the `stale`
 *                       flag and for the LLM's "should I still be
 *                       running?" judgement.
 *   - `stale`         — mirrors `CronManager.isStale(task)`; see that
 *                       method for the precise rules
 *                       (`recurring && age >= 7 days`, gated by
 *                       `KIMI_CRON_NO_STALE`).
 *
 * The tool never throws on malformed cron strings. A defensive
 * try/catch around the parse path lets the record render with the raw
 * `cron`, a `humanSchedule` fallback equal to `cron`, and
 * `nextFireAt: null` — that should never happen for tasks that went
 * through `CronCreate` (which validates), but guards against future
 * direct `store.add(...)` inserts.
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../agent/tool';
import type { CronManager } from '../../agent/cron';
import type { ToolExecution } from '../../loop/types';
/**
 * No arguments. Strict so the loop's AJV validator rejects accidental
 * extras (e.g. an `active_only` borrowed from `TaskList`) instead of
 * silently ignoring them.
 */
export declare const CronListInputSchema: z.ZodObject<{}, z.core.$strict>;
export type CronListInput = z.infer<typeof CronListInputSchema>;
export declare class CronListTool implements BuiltinTool<CronListInput> {
    private readonly manager;
    readonly name: "CronList";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(manager: CronManager);
    resolveExecution(_args: CronListInput): ToolExecution;
    private renderRecord;
}
