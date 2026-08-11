import { type McpServerConfig } from '#/config/schema';
export interface McpJsonPaths {
    readonly user: string;
    readonly projectRoot: string;
    readonly project: string;
}
export interface ResolveMcpJsonPathsInput {
    readonly cwd: string;
    readonly homeDir?: string;
}
export declare function resolveMcpJsonPaths(input: ResolveMcpJsonPathsInput): Promise<McpJsonPaths>;
export interface LoadMcpServersInput {
    readonly cwd: string;
    readonly homeDir?: string;
}
/**
 * Load MCP server declarations from the user-global `~/.kimi-code/mcp.json`,
 * the project-root `<project root>/.mcp.json`, and the project-local
 * `<cwd>/.kimi-code/mcp.json`. Entries in later files override earlier files
 * with the same key, so a repo can specialise or replace a shared definition,
 * and Kimi-specific project config wins over the Claude-compatible root file.
 *
 * Note: project-local entries may spawn stdio commands at session start, so
 * opening a session inside an untrusted checkout will execute whatever its
 * `mcp.json` declares. Only enable this in repos you trust.
 */
export declare function loadMcpServers(input: LoadMcpServersInput): Promise<Record<string, McpServerConfig>>;
