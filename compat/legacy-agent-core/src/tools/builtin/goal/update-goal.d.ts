/**
 * UpdateGoalTool — the model's single lever over the goal lifecycle. It updates
 * the goal's status directly; the turn driver reads the status at each turn
 * boundary and stops (`complete` / `blocked`) or keeps going (`active`).
 *
 * The argument is intentionally just a status enum — no reason or evidence. The
 * model explains itself in its own reply; the status is the machine-readable
 * signal. The tool stays visible to the main agent even when no goal is active;
 * goal-store operations decide whether a requested transition is valid.
 */
import type { Agent } from '#/agent';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const UpdateGoalToolInputSchema: z.ZodObject<{
    status: z.ZodEnum<{
        blocked: "blocked";
        active: "active";
        complete: "complete";
    }>;
}, z.core.$strict>;
export type UpdateGoalToolInput = z.infer<typeof UpdateGoalToolInputSchema>;
export declare class UpdateGoalTool implements BuiltinTool<UpdateGoalToolInput> {
    private readonly agent;
    readonly name: "UpdateGoal";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(args: UpdateGoalToolInput): ToolExecution;
}
