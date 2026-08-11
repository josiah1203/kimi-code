/**
 * Static inspection of agent-file tool patterns.
 *
 * Three entry shapes are dead on arrival under the tool manager's matching
 * semantics, so they surface as warnings instead of silently shrinking the
 * active tool set: `wildcard-not-mcp` (non-MCP entries match builtin/user
 * tools by exact name only, so a wildcard outside an `mcp__…` pattern can
 * never match — a bare `*` in a denylist is a no-op), `incomplete-mcp-name`
 * (an `mcp__…` literal without glob magic must be a full
 * `mcp__<server>__<tool>` name; `mcp__github__*` is the working form for a
 * whole server), and `unknown-tool` (a literal naming no registered or
 * built-in tool, almost always a typo such as `read` instead of `Read`).
 *
 * Ported from the v2 engine (`findInactiveToolPatterns` in
 * `packages/agent-core/src/agent/toolPolicy/evaluate.ts`) — keep the two
 * in sync: warning kinds and matching rules must land in both engines.
 */
export type InactiveToolPatternKind = 'wildcard-not-mcp' | 'incomplete-mcp-name' | 'unknown-tool';
export interface InactiveToolPattern {
    readonly pattern: string;
    readonly kind: InactiveToolPatternKind;
}
export declare function findInactiveToolPatterns(patterns: readonly string[], isKnownToolName?: (name: string) => boolean): InactiveToolPattern[];
export declare function describeInactiveToolPattern(issue: InactiveToolPattern): string;
