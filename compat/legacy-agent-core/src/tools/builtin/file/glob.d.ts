/**
 * GlobTool — file pattern matching via ripgrep.
 *
 * Finds files matching a glob pattern, returned sorted by modification
 * time (most recent first). Implemented by shelling out to `rg --files`
 * through Kaos — sharing the ripgrep binary, subprocess plumbing, and
 * gitignore / sensitive-file handling with GrepTool.
 *
 * Output convention: `content` shown to the LLM is relativized to the
 * search base only when the base is inside the primary workspace. External
 * roots stay absolute so downstream Read/Edit target the same file.
 *
 * Behaviour:
 *   - `.gitignore` / `.ignore` / `.rgignore` are respected by default
 *     (ripgrep native). Pass `include_ignored` to also surface ignored
 *     files (e.g. build outputs, `node_modules`). Sensitive files such
 *     as `.env` are always filtered out.
 *   - Brace expansion (`*.{ts,tsx}`, `{src,test}/**`) is handled by
 *     ripgrep's glob engine.
 *   - `path` is validated by `resolvePathAccess` in `absolute-outside-allowed`
 *     mode. Explicit absolute paths outside the workspace are allowed; relative
 *     paths that escape the workspace stay rejected.
 *   - Match count is capped at `MAX_MATCHES`. Callers are expected to add an
 *     anchor (extension, subdirectory) when that would not be enough.
 */
import type { Kaos } from '@spiderbyte/kaos';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { type TelemetryClient } from '../../../telemetry';
import type { WorkspaceConfig } from '../../support/workspace';
export declare const GlobInputSchema: z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    include_ignored: z.ZodOptional<z.ZodBoolean>;
    include_dirs: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type GlobInput = z.infer<typeof GlobInputSchema>;
export declare const MAX_MATCHES = 100;
/**
 * Path-shape hint appended to the tool description only on a Windows
 * (`win32` path class) backend. The `path` argument accepts both native
 * Windows paths and POSIX-style paths, but matched paths come back in
 * Windows backslash form — a command run through Bash must convert them
 * to forward slashes first. Injected conditionally so non-Windows
 * sessions are not shown a hint that does not apply to them.
 */
export declare const WINDOWS_PATH_HINT: string;
/**
 * Tool-level description shown to the LLM at tool declaration time.
 * Tells the model — before any round-trip — which patterns are accepted,
 * how brace expansion is handled, and which directories are too large to
 * recurse into. On a Windows backend the description also carries
 * `WINDOWS_PATH_HINT` (path-shape guidance).
 */
export declare class GlobTool implements BuiltinTool<GlobInput> {
    private readonly kaos;
    private readonly workspace;
    readonly name: "Glob";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    private readonly telemetry;
    constructor(kaos: Kaos, workspace: WorkspaceConfig, telemetry?: TelemetryClient);
    resolveExecution(args: GlobInput): ToolExecution;
    private execution;
}
/**
 * Split `rg --files` stdout into complete paths. When the run was capped or
 * timed out (`truncatedOutput`), a path cut mid-write lacks its terminating
 * newline; drop that trailing fragment so it is never surfaced as a match.
 * Complete output always ends in `\n`, so the split is lossless in that case.
 */
export declare function splitCompletePaths(stdoutText: string, truncatedOutput: boolean): string[];
