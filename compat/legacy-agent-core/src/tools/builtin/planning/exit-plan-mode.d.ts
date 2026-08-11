/**
 * ExitPlanModeTool — plan-mode exit tool.
 *
 * The LLM calls this tool to surface a finalised plan to the user and
 * exit plan mode. The plan must already be written to the current plan
 * file; this tool reads that file and flips plan mode off.
 */
import type { Agent } from '#/agent';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
/**
 * User-selectable option surfaced at plan approval time. The LLM supplies
 * up to 3 of these when the plan contains multiple approaches; the host's
 * ApprovalRuntime presents them to the user and returns the chosen `label`
 * (or `{kind:'revise', feedback}` when the user asks for revisions).
 */
export interface ExitPlanModeOption {
    label: string;
    description: string;
}
export interface ExitPlanModeInput {
    options?: readonly ExitPlanModeOption[] | undefined;
}
export declare const ExitPlanModeInputSchema: z.ZodType<ExitPlanModeInput>;
export interface ExitPlanModePlanSource {
    plan: string;
    path?: string | undefined;
}
export declare class ExitPlanModeTool implements BuiltinTool<ExitPlanModeInput> {
    private readonly agent;
    readonly name: "ExitPlanMode";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(args: ExitPlanModeInput): Promise<ToolExecution>;
    private resolvePlanReviewDisplay;
    private execution;
    private exitPlanMode;
    private resolvePlan;
}
