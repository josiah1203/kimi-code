export interface ClockSources {
    /**
     * Wall-clock epoch milliseconds. May be overridden in tests / bench
     * via `KIMI_CRON_CLOCK`. Used for cron matching, `createdAt`, stale
     * judgment.
     */
    wallNow(): number;
    /**
     * Strictly monotonic millisecond counter. Never overridden. Used for
     * the 1-second poll cadence and the lock-heartbeat liveness window.
     */
    monoNowMs(): number;
}
/**
 * Production default — `Date.now()` + `process.hrtime.bigint()`. Used
 * whenever `KIMI_CRON_CLOCK` is unset, set to `"system"`, or set to a
 * spec that fails to parse.
 */
export declare const SYSTEM_CLOCKS: ClockSources;
/**
 * Resolve a `ClockSources` implementation from a spec string (typically
 * `process.env.KIMI_CRON_CLOCK`).
 *
 *   unset / `"system"`   → {@link SYSTEM_CLOCKS}
 *   `"file:<path>"`      → `wallNow` reads the first line of `<path>`
 *                          on every call (sync — the tick path is not
 *                          async) and parses it as `Number(...)`. A
 *                          missing file or bad parse falls back to
 *                          `Date.now()` for that call. Used so a
 *                          multi-process bench can share a single
 *                          file-backed simulated clock.
 *
 * `monoNowMs` ALWAYS uses `process.hrtime.bigint()`. No spec overrides
 * it — see file header.
 *
 * Each `wallNow()` call re-reads its source. We deliberately do NOT
 * cache, because a multi-process bench tick mutating the file must be
 * picked up by every reader immediately; a cache would silently lock
 * each process to its first observation.
 *
 * Unrecognised specs fall back to {@link SYSTEM_CLOCKS} (with a
 * debug-log on stderr). This is deliberate — bricking the agent on a
 * typoed bench env var would be worse than running with system time.
 */
export declare function resolveClockSources(spec?: string): ClockSources;
