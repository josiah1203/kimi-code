export type SkillSource = 'project' | 'user' | 'extra' | 'builtin';
export interface SkillMetadata {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly type?: string | undefined;
    readonly whenToUse?: string | undefined;
    readonly disableModelInvocation?: boolean | undefined;
    readonly isSubSkill?: boolean | undefined;
    readonly safe?: boolean | undefined;
    readonly arguments?: readonly unknown[] | string | undefined;
    readonly [key: string]: unknown;
}
export interface SkillDefinition {
    readonly name: string;
    readonly description: string;
    readonly path: string;
    readonly dir: string;
    readonly content: string;
    readonly metadata: SkillMetadata;
    readonly source: SkillSource;
    readonly plugin?: SkillPluginContext;
    readonly mermaid?: string | undefined;
    readonly d2?: string;
}
export interface SkillSummary {
    readonly name: string;
    readonly description: string;
    readonly path: string;
    readonly source: SkillSource;
    readonly type?: string | undefined;
    readonly disableModelInvocation?: boolean | undefined;
    readonly isSubSkill?: boolean | undefined;
}
export interface SkillRoot {
    readonly path: string;
    readonly source: SkillSource;
    readonly plugin?: SkillPluginContext;
}
export interface SkillPluginContext {
    readonly id: string;
    readonly instructions?: string;
}
export interface SkippedSkill {
    readonly path: string;
    readonly type: string;
    readonly reason: string;
}
export interface SkillCatalog {
    getSkill(name: string): SkillDefinition | undefined;
    listSkills(): readonly SkillDefinition[];
    listInvocableSkills(): readonly SkillDefinition[];
}
export declare function normalizeSkillName(name: string): string;
export declare function isInlineSkillType(type: string | undefined): boolean;
export declare function isUserActivatableSkillType(type: string | undefined): boolean;
export declare function isSupportedSkillType(type: string | undefined): boolean;
export declare function summarizeSkill(skill: SkillDefinition): SkillSummary;
