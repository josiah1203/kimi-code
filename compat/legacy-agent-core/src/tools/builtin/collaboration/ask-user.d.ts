/**
 * AskUserQuestionTool — structured user question tool.
 *
 * The LLM calls this tool when it needs structured input from the user
 * (multiple-choice, preference selection, disambiguation). The tool
 * delegates to the SDK reverse-RPC question handler, which owns the
 * actual UI interaction.
 *
 * Permission policy decides whether this tool is available for the
 * current mode. Once executed, it dispatches through `requestQuestion`
 * and awaits the user's answer.
 */
import { z } from 'zod';
import type { Agent } from '../../../agent';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export interface AskUserQuestionInput {
    background?: boolean;
    questions: Array<{
        question: string;
        header: string;
        options: Array<{
            label: string;
            description: string;
        }>;
        multi_select: boolean;
    }>;
}
export declare const AskUserQuestionInputSchema: z.ZodType<AskUserQuestionInput>;
export declare class AskUserQuestionTool implements BuiltinTool<AskUserQuestionInput> {
    private readonly agent;
    readonly name: "AskUserQuestion";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent);
    resolveExecution(args: AskUserQuestionInput): ToolExecution;
    private execution;
    private inputSchema;
    private executeQuestion;
    private executeInBackground;
}
