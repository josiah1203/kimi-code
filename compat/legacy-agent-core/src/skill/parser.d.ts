import type { SkillDefinition, SkillMetadata, SkillSource } from './types';
export declare class FrontmatterError extends Error {
    constructor(message: string, cause?: unknown);
}
export declare class SkillParseError extends Error {
    readonly reason?: unknown;
    constructor(message: string, cause?: unknown);
}
export declare class UnsupportedSkillTypeError extends Error {
    readonly skillType: string;
    constructor(skillType: string);
}
export interface ParseSkillOptions {
    readonly skillMdPath: string;
    readonly skillDirName: string;
    readonly source: SkillSource;
}
export interface ParseSkillTextOptions extends ParseSkillOptions {
    readonly text: string;
}
export interface SkillExpandContext {
    readonly skillDir: string;
    readonly sessionId?: string;
    readonly argumentNames?: readonly string[];
}
export interface ParsedFrontmatter {
    readonly data: unknown;
    readonly body: string;
}
export declare function parseSkillFromFile(options: ParseSkillOptions): Promise<SkillDefinition>;
export declare function parseFrontmatter(text: string): ParsedFrontmatter;
export declare function parseSkillText(options: ParseSkillTextOptions): SkillDefinition;
export declare function parseMermaidFlowchart(markdown: string): string | undefined;
export declare function parseD2Flowchart(markdown: string): string | undefined;
/**
 * Expand argument placeholders in a skill body.
 *
 * Placeholder syntax ($ARGUMENTS, $0, $name, etc.) is modelled after common
 * shell/CLI conventions rather than any specific product.
 */
export declare function expandSkillParameters(body: string, rawArgs: string, context: SkillExpandContext): string;
export declare function skillArgumentNames(metadata: SkillMetadata): readonly string[];
