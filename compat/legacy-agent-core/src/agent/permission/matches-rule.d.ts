import type { RunnableToolExecution } from '../../loop/types';
import type { PermissionRule } from './types';
/**
 * DSL parser for PermissionRule `pattern` strings.
 *
 * Grammar:
 *   pattern    := toolName ( "(" argPattern ")" )?
 *   toolName   := identifier characters (e.g. `Bash`, `mcp__github__*`)
 *   argPattern := any string interpreted only by a tool-provided matcher
 *
 * Examples:
 *   "Write"            -> { toolName: "Write" }
 *   "Read(/etc/**)"    -> { toolName: "Read", argPattern: "/etc/**" }
 *   "Bash(!rm *)"      -> { toolName: "Bash", argPattern: "!rm *" }
 *   "mcp__github__*"   -> { toolName: "mcp__github__*" }
 */
export interface ParsedPattern {
    readonly toolName: string;
    readonly argPattern?: string;
}
export interface PermissionRuleMatchExecution {
    readonly matchesRule?: RunnableToolExecution['matchesRule'];
}
export type PermissionRuleMatchStrategy = 'tool_name_only' | 'matches_rule';
export interface PermissionRuleMatch {
    readonly rule: PermissionRule;
    readonly strategy: PermissionRuleMatchStrategy;
    readonly hasRuleArgs: boolean;
}
export interface PermissionRuleMatchInput {
    readonly rule: PermissionRule;
    readonly toolName: string;
    readonly execution: PermissionRuleMatchExecution;
}
/**
 * Parse a DSL pattern. Throws on malformed input (missing closing paren,
 * empty tool name). The parser is the single source of truth for DSL syntax.
 */
export declare function parsePattern(pattern: string): ParsedPattern;
export declare function matchPermissionRule({ rule, toolName, execution, }: PermissionRuleMatchInput): PermissionRuleMatch | undefined;
