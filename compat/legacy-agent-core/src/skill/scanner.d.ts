import type { SkillDefinition, SkillRoot, SkillSource, SkippedSkill } from './types';
export interface SkillPathContext {
    readonly userHomeDir: string;
    /**
     * Brand data dir — `KIMI_CODE_HOME`, or `<userHomeDir>/.kimi-code` by default.
     * User brand skills live directly under here as `skills/`, so this path
     * carries no `.kimi-code` segment of its own (that would double the prefix).
     */
    readonly brandHomeDir?: string;
    readonly workDir: string;
}
export interface ResolveSkillRootsOptions {
    readonly paths: SkillPathContext;
    readonly builtinDir?: string;
    readonly explicitDirs?: readonly string[];
    readonly extraDirs?: readonly string[];
    readonly pluginSkillRoots?: readonly SkillRoot[];
    readonly mergeAllAvailableSkills?: boolean;
    readonly realpath?: (p: string) => Promise<string>;
    readonly isDir?: (p: string) => Promise<boolean>;
}
export interface DiscoverSkillsOptions {
    readonly roots: readonly SkillRoot[];
    readonly onWarning?: (message: string, cause?: unknown) => void;
    readonly onSkippedByPolicy?: (skill: SkippedSkill) => void;
    readonly onDiscoveredSkill?: (skill: SkillDefinition) => void;
    readonly readdir?: (p: string) => Promise<readonly string[]>;
    readonly isFile?: (p: string) => Promise<boolean>;
    readonly isDir?: (p: string) => Promise<boolean>;
    readonly parse?: (input: {
        readonly skillMdPath: string;
        readonly skillDirName: string;
        readonly source: SkillSource;
    }) => Promise<SkillDefinition>;
}
export interface WorkspaceWithAdditionalDirs {
    readonly workspaceDir: string;
    readonly additionalDirs: readonly string[];
}
export declare function resolveSkillRoots(options: ResolveSkillRootsOptions): Promise<readonly SkillRoot[]>;
export declare function discoverSkills(options: DiscoverSkillsOptions): Promise<readonly SkillDefinition[]>;
export declare function extendWorkspaceWithSkillRoots<T extends WorkspaceWithAdditionalDirs>(workspace: T, skillRoots: readonly string[]): T;
