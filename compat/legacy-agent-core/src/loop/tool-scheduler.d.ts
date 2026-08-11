/**
 * Stateful execution scheduler for tool calls in one model step.
 *
 * The scheduler owns only execution ordering:
 *   - tasks with non-conflicting resource accesses may overlap
 *   - tasks with conflicting resource accesses wait for the conflicting active tasks
 *   - drained results are handed back in provider order
 *
 * Validation, hooks, event construction, and result finalization stay in
 * `tool-call.ts`.
 */
import { ToolAccesses } from './tool-access';
export interface ToolCallTask<Result> {
    readonly accesses: ToolAccesses;
    readonly start: () => Promise<{
        readonly result: Promise<Result>;
    }>;
}
export declare class ToolScheduler<Result> {
    private readonly activeTasks;
    private queuedTasks;
    add(task: ToolCallTask<Result>): Promise<Result>;
    private isBlocked;
    private conflictsWithAny;
    private start;
    private finish;
    private startQueuedTasks;
}
