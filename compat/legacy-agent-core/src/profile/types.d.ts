import type { Environment } from '@spiderbyte/kaos';
import { z } from 'zod';
import type { SkillRegistry } from '../agent/skill/types';
export declare const RawSubagentProfileSchema: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RawSubagentProfile = z.infer<typeof RawSubagentProfileSchema>;
/**
 * Symbolic model preference a profile declares for subagent spawning: the
 * `Agent` / `AgentSwarm` tools use it as the default for their `model`
 * parameter when the call does not pass one explicitly.
 */
export declare const AgentModelPreferenceSchema: z.ZodEnum<{
    primary: "primary";
    secondary: "secondary";
}>;
export type AgentModelPreference = z.infer<typeof AgentModelPreferenceSchema>;
export declare const RawAgentProfileSchema: z.ZodObject<{
    extends: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    systemPromptPath: z.ZodOptional<z.ZodString>;
    systemPromptTemplate: z.ZodOptional<z.ZodString>;
    promptVars: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    tools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    whenToUse: z.ZodOptional<z.ZodString>;
    subagents: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    modelPreference: z.ZodOptional<z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>>;
}, z.core.$strip>;
export type RawAgentProfile = z.infer<typeof RawAgentProfileSchema>;
/**
 * Runtime context supplied to a system prompt renderer.
 *
 * Captures everything determined at render time rather than at profile-load
 * time: the OS/shell, working directory, AGENTS.md instructions, available
 * skills, and so on. Loaders return renderers; callers invoke them with
 * the live context whenever a concrete prompt is needed.
 */
export interface SystemPromptContext {
    readonly osEnv: Environment;
    readonly cwd: string;
    readonly now?: string | Date;
    readonly cwdListing?: string;
    readonly agentsMd?: string;
    readonly skills?: SkillRegistry | string;
    readonly pluginSections?: string;
    readonly additionalDirsInfo?: string;
    readonly roleAdditional?: string;
}
export type SystemPromptRenderer = (context: SystemPromptContext) => string;
export interface ResolvedAgentProfile {
    name: string;
    description?: string;
    systemPrompt: SystemPromptRenderer;
    tools: string[];
    /**
     * Denylist with the same matching rules as `tools` (exact builtin/user
     * names plus `mcp__…` glob patterns), applied on top of the `tools`
     * allowlist when the profile takes effect.
     */
    disallowedTools?: string[];
    whenToUse?: string;
    subagents?: Record<string, ResolvedAgentProfile>;
    modelPreference?: AgentModelPreference;
}
