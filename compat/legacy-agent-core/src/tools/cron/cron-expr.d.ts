/**
 * 5-field cron expression parsing and "next fire time" computation, in
 * local time. Self-contained — no external cron library is used because
 * upstream `claude-code` mirrors the same semantics and we need exact
 * lock-step behaviour with their implementation.
 *
 * Two flavours of correctness we care about:
 *
 *   1. **Semantics.** Standard 5 fields (minute hour day-of-month month
 *      day-of-week). Day-of-month and day-of-week combine with cron's
 *      OR rule when both are restricted (POSIX/Vixie tradition). dow
 *      accepts 0..7 with 7 folded to 0 (Sunday).
 *
 *   2. **Termination.** Computing `next` for a legal-but-never-fires
 *      expression like `0 0 31 2 *` must not spin. We bound the search
 *      at a fixed window (5 years by default) and return `null` past
 *      that — the validator at `CronCreate` reuses this signal.
 */
/** A parsed cron expression. Opaque to callers — pass it back into {@link computeNextCronRun}. */
export interface ParsedCronExpression {
    readonly raw: string;
    readonly minutes: ReadonlySet<number>;
    readonly hours: ReadonlySet<number>;
    readonly daysOfMonth: ReadonlySet<number>;
    readonly months: ReadonlySet<number>;
    readonly daysOfWeek: ReadonlySet<number>;
    /** True if the source field was `*` — needed so cron's dom/dow OR rule fires only when both are restricted. */
    readonly daysOfMonthWildcard: boolean;
    readonly daysOfWeekWildcard: boolean;
}
/**
 * Parse a 5-field cron expression. Throws with a message naming the
 * offending field on any syntax error. Whitespace-separated; exactly 5
 * fields. Tokens supported per field: `*`, integers, ranges (`a-b`),
 * lists (`a,b,c`), and step (e.g. star-slash-n or `a-b/n`).
 */
export declare function parseCronExpression(expr: string): ParsedCronExpression;
/**
 * Find the next wall-clock epoch ms strictly greater than `fromMs` that
 * satisfies `expr`, using local-time semantics. Returns `null` if no
 * match exists inside the default 5-year search window — defensive
 * against legal-but-never-fires expressions like `0 0 31 2 *`.
 *
 * Uses an O(transitions) field-by-field skip algorithm rather than a
 * minute-by-minute scan — month mismatch advances by months, day
 * mismatch by days, etc., so the worst case for `0 12 1 1 *` is a
 * handful of iterations, not 43 200.
 *
 * Termination is bounded by a wall-time deadline on the candidate
 * date — not an iteration count — so a pathological expression that
 * spends every iteration on `advanceMonth` still bails inside the
 * documented window. A secondary `HARD_ITERATION_CAP` guards against
 * a future refactor that fails to advance the date.
 */
export declare function computeNextCronRun(expr: ParsedCronExpression, fromMs: number): number | null;
/**
 * True iff at least one fire exists within `years` years of `fromMs`.
 * Used by CronCreate validation to reject `0 0 31 2 *` and friends up
 * front, with the same wall-time deadline {@link computeNextCronRun}
 * uses (so the validator never says yes to something the scheduler
 * will later refuse to compute).
 */
export declare function hasFireWithinYears(expr: ParsedCronExpression, years: number, fromMs: number): boolean;
/**
 * Cheap human-readable summary of an expression. Falls back to the raw
 * string when the shape isn't one of the patterns we recognise — the
 * caller (CronList) uses this purely for display, so a wordy fallback
 * is fine and we don't try to be exhaustive.
 */
export declare function cronToHuman(expr: ParsedCronExpression): string;
