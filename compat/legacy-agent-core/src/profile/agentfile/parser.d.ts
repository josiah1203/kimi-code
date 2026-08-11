/**
 * Agent-file parsing primitives.
 *
 * Parses a single agent Markdown file (frontmatter + body) into an
 * `AgentFileDefinition`. Pure functions with no IO: callers read bytes however
 * they like and pass the decoded text in, mirroring the skill parser. Unknown
 * frontmatter fields are ignored so later format extensions stay
 * forward-compatible. Compatibility conventions match other agent CLIs: a
 * missing `name` falls back to the file name (OpenCode), a lone `*` in
 * `tools` / `subagents` means unrestricted like an omitted field, and list
 * fields accept either a bare comma-separated string or the YAML list form
 * (Claude Code).
 *
 * Ported from the v2 engine (`packages/agent-core/src/app/agentFileCatalog/agentFile.ts`)
 * — keep the two in sync: agent-file format changes must land in both engines.
 */
import type { AgentFileDefinition, AgentFileSource } from './types';
export declare class AgentFileParseError extends Error {
    readonly reason?: unknown;
    constructor(message: string, cause?: unknown);
}
export interface ParseAgentFileOptions {
    readonly path: string;
    readonly source: AgentFileSource;
    readonly text: string;
}
export declare function parseAgentFileText(options: ParseAgentFileOptions): AgentFileDefinition;
