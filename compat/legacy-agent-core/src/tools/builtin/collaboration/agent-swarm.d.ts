import { z } from 'zod';
import type { SwarmMode } from '../../../agent/swarm';
import type { BuiltinTool } from '../../../agent/tool';
import { type SessionSubagentHost } from '../../../session/subagent-host';
import type { ToolExecution } from '../../../loop/types';
export declare const AgentSwarmToolInputSchema: z.ZodObject<{
    description: z.ZodString;
    subagent_type: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>>;
    prompt_template: z.ZodOptional<z.ZodString>;
    items: z.ZodOptional<z.ZodArray<z.ZodString>>;
    resume_agent_ids: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export type AgentSwarmToolInput = z.infer<typeof AgentSwarmToolInputSchema>;
export declare class AgentSwarmTool implements BuiltinTool<AgentSwarmToolInput> {
    private readonly subagentHost;
    private readonly swarmMode;
    private readonly subagentTimeoutMs?;
    readonly name: "AgentSwarm";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(subagentHost: SessionSubagentHost, swarmMode: SwarmMode, subagentTimeoutMs?: number | undefined, subagentModelDescription?: string, modelChoiceEnabled?: boolean);
    resolveExecution(args: AgentSwarmToolInput): ToolExecution;
    private execution;
    private runSwarm;
}
