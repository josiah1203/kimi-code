/**
 * Persisted `thinking.effort = "max"` dates from when the UI recorded any pick
 * unconditionally. `max` is session-only now, so rewrite it to `"high"` once.
 * Skipped when the marker exists; a config that cannot be parsed is left
 * untouched AND unmarked so the next start retries. All other values — and a
 * `max` the user writes by hand after the migration — are honored as-is.
 */
export declare function migrateThinkingEffortMaxToHigh(configPath: string, homeDir: string): void;
