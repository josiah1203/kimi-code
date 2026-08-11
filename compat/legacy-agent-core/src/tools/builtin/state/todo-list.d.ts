/**
 * TodoListTool — structured TODO list management tool.
 *
 * The LLM uses this tool to maintain a visible plan of sub-tasks during
 * plan-mode workflows and multi-step operations. A single tool serves
 * both reads and writes:
 *
 *   - `resolveExecution({ todos: [...] })` — replace the full list
 *   - `resolveExecution({ todos: [] })`    — clear the list
 *   - `resolveExecution({})`               — query current list (no mutation)
 *
 * Storage: todos live in the agent-level tool store. Writes go through
 * `tools.update_store`, so the store update is visible on wire replay.
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type { ToolStore } from '../../store';
export declare const TODO_LIST_TOOL_NAME: "TodoList";
export declare const TODO_STORE_KEY = "todo";
export type TodoStatus = 'pending' | 'in_progress' | 'done';
export interface TodoItem {
    readonly title: string;
    readonly status: TodoStatus;
}
declare module '../../store' {
    interface ToolStoreData {
        todo: readonly TodoItem[];
    }
}
export interface TodoListInput {
    todos?: Array<{
        title: string;
        status: TodoStatus;
    }>;
}
export declare const TodoListInputSchema: z.ZodType<TodoListInput>;
export declare function renderTodoList(todos: readonly TodoItem[], title?: string): string;
export declare class TodoListTool implements BuiltinTool<TodoListInput> {
    private readonly store;
    readonly name: "TodoList";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(store: ToolStore);
    resolveExecution(args: TodoListInput): ToolExecution;
    private getTodos;
    private setTodos;
}
