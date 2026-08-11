import { discoverSkills } from './scanner';
import type { SkillDefinition, SkillRoot, SkippedSkill } from './types';
import type { SkillRegistry as AgentSkillRegistry } from '../agent/skill/types';
export declare class SkillNotFoundError extends Error {
    readonly skillName: string;
    constructor(skillName: string);
}
export interface SkillRegistryOptions {
    readonly discover?: typeof discoverSkills;
    readonly onWarning?: (message: string, cause?: unknown) => void;
    readonly sessionId?: string;
}
export declare class SessionSkillRegistry implements AgentSkillRegistry {
    private readonly byName;
    private readonly byPluginAndName;
    private readonly roots;
    private readonly skipped;
    private readonly discoverImpl;
    private readonly onWarning;
    readonly sessionId?: string;
    constructor(options?: SkillRegistryOptions);
    loadRoots(roots: readonly SkillRoot[]): Promise<void>;
    registerBuiltinSkill(skill: SkillDefinition): void;
    register(skill: SkillDefinition, options?: {
        readonly replace?: boolean;
    }): void;
    getSkill(name: string): SkillDefinition | undefined;
    getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined;
    private indexPluginSkill;
    renderSkillPrompt(skill: SkillDefinition, rawArgs: string): string;
    listSkills(): readonly SkillDefinition[];
    listInvocableSkills(): readonly SkillDefinition[];
    getSkillRoots(): readonly string[];
    getSkippedByPolicy(): readonly SkippedSkill[];
    getKimiSkillsDescription(): string;
    getModelSkillListing(): string;
}
