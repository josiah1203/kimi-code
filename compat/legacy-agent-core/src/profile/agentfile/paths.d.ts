/**
 * Shared path primitives for agent-file discovery: `~` expansion,
 * base-relative resolution, and fs type probes used by the root resolvers,
 * the directory walker, and the explicit-file source. Callers pick the
 * resolution base: discovery roots resolve against the project root,
 * explicit files against the session workDir.
 *
 * Ported from the v2 engine (`packages/agent-core/src/app/agentFileCatalog/paths.ts`)
 * — keep the two in sync.
 */
export declare function resolveAgentPath(path: string, baseDir: string, osHomeDir: string): string;
export declare function isDirectoryPath(p: string): Promise<boolean>;
export declare function isFilePath(p: string): Promise<boolean>;
export declare function pathExists(p: string): Promise<boolean>;
export declare function isMissingPathError(error: unknown): boolean;
