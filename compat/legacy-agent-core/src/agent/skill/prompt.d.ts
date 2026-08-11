import type { SkillSource } from '../../skill';
export type SkillPromptTrigger = 'user-slash' | 'model-tool' | 'nested-skill';
export interface RenderSkillPromptInput {
    readonly skillName: string;
    readonly skillArgs: string;
    readonly skillContent: string;
    readonly skillSource?: SkillSource | undefined;
    /**
     * Absolute directory containing the skill's SKILL.md and any bundled
     * resources (scripts, templates, data files). Surfaced on the loaded
     * block so the agent can locate those resources with relative paths —
     * without it, a skill that ships helper scripts is unusable unless the
     * author manually embeds `${KIMI_SKILL_DIR}` in the body.
     */
    readonly skillDir?: string | undefined;
}
interface RenderSkillLoadedBlockInput extends RenderSkillPromptInput {
    readonly trigger: SkillPromptTrigger;
}
export declare function renderUserSlashSkillPrompt(input: RenderSkillPromptInput): string;
export interface RenderModelToolSkillPromptInput extends RenderSkillPromptInput {
    readonly trigger: Extract<SkillPromptTrigger, 'model-tool' | 'nested-skill'>;
}
export declare function renderModelToolSkillPrompt(input: RenderModelToolSkillPromptInput): string;
export declare function renderSkillLoadedBlock(input: RenderSkillLoadedBlockInput): string;
export {};
