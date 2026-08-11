/**
 * TaskListTool — list background tasks.
 */
import { z } from 'zod';
import type { BackgroundManager, BackgroundTaskInfo } from '../../agent/background';
import type { BuiltinTool } from '../../agent/tool';
import type { ToolExecution } from '../../loop/types';
export declare const TaskListInputSchema: z.ZodObject<{
    active_only: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    limit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, z.core.$strip>;
export type TaskListInput = z.Infer<typeof TaskListInputSchema>;
export declare function formatTaskList(tasks: BackgroundTaskInfo[], activeOnly: boolean): string;
export declare class TaskListTool implements BuiltinTool<TaskListInput> {
    private readonly manager;
    readonly name: "TaskList";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(manager: BackgroundManager);
    resolveExecution(args: TaskListInput): ToolExecution;
}
