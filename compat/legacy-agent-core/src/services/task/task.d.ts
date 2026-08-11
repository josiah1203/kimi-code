/**
 * `ITaskService` — daemon-facing background task surface.
 *
 * Wraps `ICoreProcessService.rpc.{getBackground, stopBackground}` and adapts
 * `BackgroundTaskInfo` (camelCase + ms timestamps + agent-core literal sets)
 * into SCHEMAS §7 `BackgroundTask` (snake_case + ISO + spec literal sets).
 *
 * Adapter helpers (`toProtocolTask`, `isTerminalStatus`) are co-located here.
 *
 * **CoreAPI surface used**:
 *   - `core.rpc.getBackground({sessionId, agentId, activeOnly?, limit?})
 *      => readonly BackgroundTaskInfo[]`
 *     (packages/agent-core/src/rpc/core-api.ts:334 + WithSessionId+WithAgentId
 *      injection).
 *   - `core.rpc.stopBackground({sessionId, agentId, taskId, reason?})`
 *     (line 323).
 *
 * **Error model**:
 *   - `TaskNotFoundError` (→ 40406) when the task id does not exist within
 *     the session.
 *   - `TaskAlreadyFinishedError` (→ 40904) when the task has reached a
 *     terminal status (completed/failed/cancelled/timed_out/killed/lost).
 *
 * **Anti-corruption**: imports `@spiderbyte/legacy-agent-core` only for the
 * `createDecorator` value and the `BackgroundTaskInfo` type.
 *
 * Reference table (task kind + status):
 *
 *   kind:    process   → bash
 *            agent     → subagent
 *            question  → tool
 *
 *   status:  running   → running
 *            completed → completed
 *            failed    → failed
 *            timed_out → failed       (lossy — stopReason carries hint)
 *            killed    → cancelled
 *            lost      → failed       (lossy)
 */
import type { BackgroundTaskInfo } from '../../agent/background';
import type { BackgroundTask, BackgroundTaskStatus } from '@spiderbyte/protocol';
export declare function isTerminalStatus(status: BackgroundTaskStatus): boolean;
export interface TaskOutputSnapshot {
    readonly preview: string;
    readonly bytes: number;
}
export interface GetTaskOptions {
    readonly withOutput?: boolean;
    readonly outputBytes?: number;
}
export declare function toProtocolTask(sessionId: string, info: BackgroundTaskInfo, output?: TaskOutputSnapshot): BackgroundTask;
export interface TaskListQuery {
    readonly status?: BackgroundTaskStatus;
}
export interface ITaskService {
    readonly _serviceBrand: undefined;
    /** Return the (full) list of background tasks for the session. */
    list(sessionId: string, query: TaskListQuery): Promise<readonly BackgroundTask[]>;
    /**
     * Return a single background task. Throws `TaskNotFoundError` (→ 40406)
     * when the task id is not found.
     *
     * Pass `withOutput: true` to include the task's captured output in the
     * response (`output_preview` / `output_bytes`). `outputBytes` caps the
     * returned preview to the last N bytes; when omitted, a server-default
     * cap is used.
     */
    get(sessionId: string, taskId: string, options?: GetTaskOptions): Promise<BackgroundTask>;
    /**
     * Cancel a running task. Throws:
     *   - `TaskNotFoundError`        → 40406
     *   - `TaskAlreadyFinishedError` → 40904 (daemon emits custom envelope
     *      with `data:{cancelled:false}`)
     */
    cancel(sessionId: string, taskId: string): Promise<{
        cancelled: true;
    }>;
}
export declare const ITaskService: import("../..").ServiceIdentifier<ITaskService>;
/**
 * Sentinel — daemon route maps to `code: 40406 task.not_found`.
 */
export declare class TaskNotFoundError extends Error {
    readonly sessionId: string;
    readonly taskId: string;
    constructor(sessionId: string, taskId: string);
}
/**
 * Sentinel — daemon route maps to `code: 40904 task.already_finished`. The
 * envelope's `data` shape is `{ cancelled: false }` (REST.md §3.7 idempotent
 * shape mirroring 40903 + 40902 precedent).
 */
export declare class TaskAlreadyFinishedError extends Error {
    readonly sessionId: string;
    readonly taskId: string;
    readonly currentStatus: BackgroundTaskStatus;
    constructor(sessionId: string, taskId: string, currentStatus: BackgroundTaskStatus);
}
