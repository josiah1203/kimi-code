/**
 * SetGoalBudgetTool — lets the model record a user-stated hard runtime limit
 * for the current goal. The tool accepts one limit at a time, converts supported
 * time units to milliseconds, and rejects obviously unreasonable time limits.
 */
import type { Agent } from '#/agent';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const SetGoalBudgetToolInputSchema: z.ZodObject<{
    value: z.ZodNumber;
    unit: z.ZodEnum<{
        seconds: "seconds";
        tokens: "tokens";
        turns: "turns";
        milliseconds: "milliseconds";
        minutes: "minutes";
        hours: "hours";
    }>;
}, z.core.$strict>;
export type SetGoalBudgetToolInput = z.infer<typeof SetGoalBudgetToolInputSchema>;
export declare class SetGoalBudgetTool implements BuiltinTool<SetGoalBudgetToolInput> {
    private readonly agent;
    readonly name: "SetGoalBudget";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(args: SetGoalBudgetToolInput): ToolExecution;
    /**
     * Predicts whether merging {@link newLimits} into the current goal's budget
     * would already be at or over budget, mirroring the reached-budget math in
     * `computeBudgetReport`. Used to stop the tool batch synchronously when a
     * just-set budget is exhausted. Returns false when there is no current goal
     * (the set itself will reject with GOAL_NOT_FOUND).
     */
    private wouldExceedBudget;
}
