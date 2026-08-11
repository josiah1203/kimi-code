/**
 * TaskStopTool — stop a running background task.
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../agent/tool';
import { type BackgroundManager } from '../../agent/background';
import type { ToolExecution } from '../../loop/types';
export declare const TaskStopInputSchema: z.ZodObject<{
    task_id: z.ZodString;
    reason: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, z.core.$strip>;
export type TaskStopInput = z.Infer<typeof TaskStopInputSchema>;
export declare class TaskStopTool implements BuiltinTool<TaskStopInput> {
    private readonly manager;
    readonly name: "TaskStop";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(manager: BackgroundManager);
    resolveExecution(args: TaskStopInput): ToolExecution;
}
