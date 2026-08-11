/**
 * GrepTool — content search via ripgrep.
 *
 * Shells out to `rg` through Kaos. Supports glob/type filtering, context
 * lines, output modes, pagination, multiline, and case-insensitive search.
 *
 * Path safety is enforced before any Kaos I/O. Explicit absolute paths outside
 * the workspace are allowed; relative paths that escape the workspace are
 * rejected.
 *
 * Output is bounded and post-processed before it reaches the model:
 *   - timeout and ambient abort both terminate the rg subprocess;
 *   - stdout/stderr are capped while streams continue draining;
 *   - hidden files are searched, but VCS metadata and common sensitive glob
 *     patterns are prefiltered where possible;
 *   - parsed path records are filtered again after rg returns, using the active
 *     backend path class.
 */
import type { Kaos } from '@spiderbyte/kaos';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { type TelemetryClient } from '../../../telemetry';
import type { WorkspaceConfig } from '../../support/workspace';
export declare const GrepInputSchema: z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    glob: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodString>;
    output_mode: z.ZodOptional<z.ZodEnum<{
        content: "content";
        files_with_matches: "files_with_matches";
        count_matches: "count_matches";
    }>>;
    '-i': z.ZodOptional<z.ZodBoolean>;
    '-n': z.ZodOptional<z.ZodBoolean>;
    '-A': z.ZodOptional<z.ZodNumber>;
    '-B': z.ZodOptional<z.ZodNumber>;
    '-C': z.ZodOptional<z.ZodNumber>;
    head_limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
    multiline: z.ZodOptional<z.ZodBoolean>;
    include_ignored: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const GrepOutputSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        content: "content";
        files_with_matches: "files_with_matches";
        count_matches: "count_matches";
    }>;
    numFiles: z.ZodNumber;
    filenames: z.ZodArray<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    numLines: z.ZodOptional<z.ZodNumber>;
    numMatches: z.ZodOptional<z.ZodNumber>;
    appliedLimit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type GrepInput = z.Infer<typeof GrepInputSchema>;
export type GrepOutput = z.Infer<typeof GrepOutputSchema>;
export declare class GrepTool implements BuiltinTool<GrepInput> {
    private readonly kaos;
    private readonly workspace;
    readonly name: "Grep";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    private readonly telemetry;
    constructor(kaos: Kaos, workspace: WorkspaceConfig, telemetry?: TelemetryClient);
    resolveExecution(args: GrepInput): ToolExecution;
    private execution;
}
