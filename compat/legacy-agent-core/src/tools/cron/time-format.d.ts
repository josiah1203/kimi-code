/**
 * Render cron-facing timestamps in local wall time with an explicit
 * numeric offset. Cron expressions are evaluated in local time, so the
 * tool output should preserve that mental model while remaining
 * unambiguous and parseable as ISO 8601.
 */
export declare function formatLocalIsoWithOffset(ms: number): string;
