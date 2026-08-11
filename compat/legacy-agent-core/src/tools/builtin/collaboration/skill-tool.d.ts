/**
 * SkillTool — invoke a registered skill.
 *
 * Collaboration tool that lets the LLM proactively invoke an inline
 * registered skill. Inline skills record their activation through the
 * owning agent; non-inline skill types are intentionally not model-invocable
 * in the v1 default runtime.
 *
 * Anti-loop: `MAX_SKILL_QUERY_DEPTH` caps Skill→Skill recursion so a
 * skill that re-invokes itself (or chains into another) cannot recurse
 * without bound.
 */
import { z } from 'zod';
import type { Agent } from '../../../agent';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const MAX_SKILL_QUERY_DEPTH = 3;
export declare class NestedSkillTooDeepError extends Error {
    readonly skillName?: string;
    readonly depth: number;
    constructor(depth: number, skillName?: string);
}
export interface SkillToolInput {
    skill: string;
    args?: string;
}
export declare const SkillToolInputSchema: z.ZodType<SkillToolInput>;
export interface SkillToolOptions {
    /**
     * Current inline skill recursion depth.
     */
    readonly queryDepth?: number;
    /**
     * Alias for `queryDepth`. Kept so older call sites can seed the
     * inline recursion depth without knowing the internal field name.
     */
    readonly initialQueryDepth?: number;
}
export declare class SkillTool implements BuiltinTool<SkillToolInput> {
    private readonly agent;
    private readonly options;
    readonly name = "Skill";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(agent: Agent, options?: SkillToolOptions);
    resolveExecution(args: SkillToolInput): ToolExecution;
    withInitialQueryDepth(initialQueryDepth: number): SkillTool;
    private execution;
}
