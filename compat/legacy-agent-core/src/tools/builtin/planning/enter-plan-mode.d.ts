/**
 * EnterPlanModeTool — plan-mode entry tool.
 *
 * The LLM calls this tool to enter plan mode directly. Entering plan mode
 * does not require approval in any permission mode.
 */
import type { Agent } from '#/agent';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const EnterPlanModeInputSchema: z.ZodObject<{}, z.core.$strict>;
export type EnterPlanModeInput = z.infer<typeof EnterPlanModeInputSchema>;
export declare class EnterPlanModeTool implements BuiltinTool<EnterPlanModeInput> {
    private readonly agent;
    readonly name: "EnterPlanMode";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(_args: EnterPlanModeInput): ToolExecution;
}
