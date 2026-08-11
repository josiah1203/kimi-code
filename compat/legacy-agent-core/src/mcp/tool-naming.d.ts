/**
 * Replace any character outside the safe ASCII set with `_`, then collapse
 * any run of `_` into a single underscore. The collapse step guarantees neither the sanitized server
 * nor tool name contains the `__` separator used by {@link qualifyMcpToolName},
 * which lets {@link isMcpToolName}-aware decoders split unambiguously on the
 * first `__` after the prefix.
 */
export declare function sanitizeMcpNamePart(part: string): string;
export declare function isMcpToolName(name: string): boolean;
/**
 * Produce the qualified MCP tool name used inside the agent and on the wire.
 * If the result would exceed {@link MAX_QUALIFIED_LENGTH}, a deterministic
 * 8-char hash suffix replaces the tail so the prefix structure stays intact.
 */
export declare function qualifyMcpToolName(serverName: string, toolName: string): string;
