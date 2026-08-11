/**
 * TaskOutputTool — read output from a background task.
 *
 * Returns structured task metadata plus a fixed-size tail preview of the
 * task's output. The full, never-truncated output lives on disk at
 * `output_path`; the caller is always pointed at the `Read` tool to page
 * through the complete log, and the preview also carries a banner when it
 * has been truncated to a tail.
 *
 * For terminal tasks the output also surfaces why the task ended:
 * `stop_reason` records the concrete reason; `terminal_reason` classifies
 * timeout vs. explicit stop vs. failure for callers that need stable labels.
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../agent/tool';
import { type BackgroundManager } from '../../agent/background';
import type { ToolExecution } from '../../loop/types';
export declare const TaskOutputInputSchema: z.ZodObject<{
    task_id: z.ZodString;
}, z.core.$strip>;
export type TaskOutputInput = z.Infer<typeof TaskOutputInputSchema>;
export declare class TaskOutputTool implements BuiltinTool<TaskOutputInput> {
    private readonly manager;
    readonly name: "TaskOutput";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(manager: BackgroundManager);
    resolveExecution(args: TaskOutputInput): ToolExecution;
    private execute;
}
