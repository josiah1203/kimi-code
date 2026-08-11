/**
 * GetGoalTool — returns the current goal snapshot (objective, status, budgets,
 * and usage counters) so the model can decide whether to continue, report
 * completion via UpdateGoal, report a blocker, or respect a pause.
 */
import type { Agent } from '#/agent';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const GetGoalToolInputSchema: z.ZodObject<{}, z.core.$strict>;
export type GetGoalToolInput = z.infer<typeof GetGoalToolInputSchema>;
export declare class GetGoalTool implements BuiltinTool<GetGoalToolInput> {
    private readonly agent;
    readonly name: "GetGoal";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(_args: GetGoalToolInput): ToolExecution;
}
