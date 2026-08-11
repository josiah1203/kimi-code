/**
 * AgentTool — collaboration tool for spawning task subagents.
 *
 * Unlike the built-in tools (Read/Write/Edit/Bash/Grep/Glob), this is a
 * "collaboration tool". It uses `SessionSubagentHost` (injected via the
 * constructor rather than through the Runtime) to create in-process subagent
 * loop instances.
 *
 * Foreground and background subagents both run through BackgroundManager.
 * Foreground calls wait for the task to finish unless it is detached through
 * the background-task RPC.
 *
 * `ToolResult.content` is textual; the structured output exposed by
 * `AgentToolOutputSchema` is only used for drift-guard and is not consumed at
 * runtime.
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { Logger } from '../../../logging';
import type { ToolExecution } from '../../../loop/types';
import type { ResolvedAgentProfile } from '../../../profile';
import { type SessionSubagentHost } from '../../../session/subagent-host';
import { type BackgroundManager } from '../../../agent/background';
export declare const AgentToolInputSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    prompt: z.ZodString;
    description: z.ZodString;
    subagent_type: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>>;
    resume: z.ZodOptional<z.ZodString>;
    run_in_background: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
export type AgentToolInput = z.infer<typeof AgentToolInputSchema>;
export declare const AgentToolOutputSchema: z.ZodObject<{
    result: z.ZodString;
    usage: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cache_read: z.ZodOptional<z.ZodNumber>;
        cache_write: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AgentToolOutput = z.infer<typeof AgentToolOutputSchema>;
export declare class AgentTool implements BuiltinTool<AgentToolInput> {
    private readonly subagentHost;
    private readonly backgroundManager;
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(subagentHost: SessionSubagentHost, backgroundManager: BackgroundManager, subagents?: ResolvedAgentProfile['subagents'] | undefined, options?: {
        log?: Logger;
        allowBackground?: boolean | undefined;
        subagentTimeoutMs?: number | undefined;
        subagentModelDescription?: string;
        showModelPreferences?: boolean;
        modelChoiceEnabled?: boolean;
    });
    private readonly log?;
    private readonly allowBackground;
    private readonly subagentTimeoutMs?;
    resolveExecution(args: AgentToolInput): Promise<ToolExecution>;
    private execution;
    private formatForegroundResult;
}
