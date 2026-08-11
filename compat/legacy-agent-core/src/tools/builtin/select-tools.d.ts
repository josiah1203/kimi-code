/**
 * select_tools — the load-by-exact-name primitive of progressive tool
 * disclosure. Dynamic tool schemas stay out of the immutable top-level
 * `tools[]`; the model reads the `<tools_added>/<tools_removed>`
 * announcements, calls this tool with exact names, and the full definitions
 * are appended to the conversation as a `role: 'system'` message carrying
 * `tools` (the `messages[].tools` wire contract). Loaded tools become
 * executable the very next step: the loop re-reads the executable tool table
 * per step.
 *
 * Registered only when `agent.toolSelectEnabled` (capability × flag gate) and
 * deliberately NOT main-agent-only — subagents get the same disclosure.
 *
 * Concurrency: no `accesses` is declared, so the execution defaults to
 * `ToolAccesses.all()` and is serialized against every other tool in the same
 * batch. That is a design constraint, not an accident — two select_tools
 * calls settling concurrently could double-inject the same schema message.
 */
import { z } from 'zod';
import type { Agent } from '#/agent';
import type { BuiltinTool } from '../../agent/tool/types';
import type { ToolExecution } from '../../loop/types';
export declare const SELECT_TOOLS_TOOL_NAME = "select_tools";
export declare const SelectToolsInputSchema: z.ZodObject<{
    names: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type SelectToolsInput = z.infer<typeof SelectToolsInputSchema>;
export declare class SelectToolsTool implements BuiltinTool<SelectToolsInput> {
    private readonly agent;
    readonly name = "select_tools";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(args: SelectToolsInput): ToolExecution;
}
