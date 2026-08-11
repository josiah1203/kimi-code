/**
 * CreateGoalTool — lets the main agent start an explicit goal on the user's
 * behalf. The goal becomes durable, structured state owned by the agent's
 * GoalMode, not text parsed from a slash command.
 */
import type { Agent } from '#/agent';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const CreateGoalToolInputSchema: z.ZodObject<{
    objective: z.ZodString;
    completionCriterion: z.ZodOptional<z.ZodString>;
    replace: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type CreateGoalToolInput = z.infer<typeof CreateGoalToolInputSchema>;
export declare class CreateGoalTool implements BuiltinTool<CreateGoalToolInput> {
    private readonly agent;
    readonly name: "CreateGoal";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(args: CreateGoalToolInput): ToolExecution;
    /**
     * Starting a goal switches the agent into autonomous, multi-turn work, so its
     * approval reuses the same choice the `/goal` command offers: pick the
     * permission mode to run under, or decline. `auto` mode auto-approves the goal
     * upstream and never reaches this prompt, so the menu only covers manual/yolo.
     */
    private resolveGoalStartDisplay;
}
