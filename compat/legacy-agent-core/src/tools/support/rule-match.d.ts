import { type PermissionPathMatchOptions } from './path-glob-match';
export declare function literalRulePattern(toolName: string, subject: string): string;
export declare function escapeRuleSubjectLiteral(subject: string): string;
export declare function matchesGlobRuleSubject(ruleArgs: string, subject: string): boolean;
export declare function matchesPathRuleSubject(ruleArgs: string, subject: string, options?: PermissionPathMatchOptions): boolean;
