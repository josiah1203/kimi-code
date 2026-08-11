/**
 * Background task persistence helpers.
 *
 * Each task lives at `<sessionDir>/tasks/<taskId>.json` so a CLI
 * restart can list previously-running tasks (now lost) and emit terminal
 * notifications.
 *
 * The per-id JSON layer (write / read / list) is delegated to
 * `createPerIdJsonStore`, which centralises atomic-write +
 * path-traversal-guarded readdir for cron / background / anything else
 * that needs session-scoped per-id JSON. This class keeps the
 * background-specific shape and the output.log helpers together.
 */
import type { BackgroundTaskInfo } from './task';
type PersistedTask = BackgroundTaskInfo;
export declare class BackgroundTaskPersistence {
    private readonly sessionDir;
    private readonly store;
    constructor(sessionDir: string);
    taskOutputFile(taskId: string): string;
    /** Atomically write a task's persisted state. Creates dirs as needed. */
    writeTask(task: PersistedTask): Promise<void>;
    /** Read a single task file. Returns undefined when missing/corrupt/unrecognized. */
    readTask(taskId: string): Promise<PersistedTask | undefined>;
    appendTaskOutput(taskId: string, chunk: string): Promise<void>;
    /**
     * Total byte size of a task's `output.log`. Returns 0 when the log does
     * not exist yet (the task has produced no output, or is unknown).
     *
     * This is the authoritative full-output size — unlike the in-memory ring
     * buffer it is never truncated, so callers can report how much output a
     * task has actually produced.
     */
    taskOutputSizeBytes(taskId: string): Promise<number>;
    taskOutputExists(taskId: string): Promise<boolean>;
    /**
     * Read a byte window of a task's `output.log`.
     *
     * Reads at most `maxBytes` bytes starting at byte `offset`. A window that
     * runs past EOF is clamped to whatever remains; an `offset` at/after EOF
     * yields an empty string. Returns an empty string when the log is absent.
     *
     * Byte-level (not line-level) paging mirrors how the full log is stored
     * on disk, so callers can page arbitrarily large logs without loading the
     * whole file into memory.
     */
    readTaskOutputBytes(taskId: string, offset: number, maxBytes: number): Promise<string>;
    /**
     * Enumerate all persisted tasks for a session.
     *
     * Skips, silently:
     *   - basenames that don't match `VALID_TASK_ID` (stray files, legacy
     *     `bg_*` leftovers, partially-written temp files);
     *   - files that fail to read / parse;
     *   - records that are neither identifiable as the current camelCase
     *     shape nor the previous snake_case task shape.
     *
     * Legacy snake_case records are normalized to current `BackgroundTaskInfo`
     * in memory. The next lifecycle/reconcile write stores them back in the
     * current format, so compatibility is read-only and opportunistically
     * migrates without a separate migration step.
     *
     * `writeTask` uses atomic temp+rename so a genuinely truncated file in
     * production is rare; if it happens we accept the loss rather than
     * emit a ghost with no recoverable metadata beyond the filename.
     */
    listTasks(): Promise<readonly PersistedTask[]>;
}
export {};
