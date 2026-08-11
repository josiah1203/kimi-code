/**
 * WriteTool — overwrite or append to a file.
 *
 * Creates the file if it does not exist. Missing parent directories are
 * created automatically, mirroring `mkdir(parents=True, exist_ok=True)`.
 * Path access policy is resolved before any Kaos I/O.
 */
import type { Kaos } from '@spiderbyte/kaos';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type { WorkspaceConfig } from '../../support/workspace';
export declare const WriteInputSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    mode: z.ZodOptional<z.ZodEnum<{
        append: "append";
        overwrite: "overwrite";
    }>>;
}, z.core.$strip>;
export declare const WriteOutputSchema: z.ZodObject<{
    bytesWritten: z.ZodNumber;
}, z.core.$strip>;
export type WriteInput = z.Infer<typeof WriteInputSchema>;
export type WriteOutput = z.Infer<typeof WriteOutputSchema>;
export declare class WriteTool implements BuiltinTool<WriteInput> {
    private readonly kaos;
    private readonly workspace;
    readonly name: "Write";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(kaos: Kaos, workspace: WorkspaceConfig);
    resolveExecution(args: WriteInput): ToolExecution;
    private execution;
    /**
     * Best-effort check that the parent directory is usable, creating it when
     * it is missing.
     *
     * If the parent (or any ancestor) does not exist, it is created
     * recursively — mirroring Python's `Path.mkdir(parents=True,
     * exist_ok=True)` — so the agent does not need a separate `mkdir` round
     * trip before writing into a fresh subfolder. An existing parent that is
     * not a directory is still a hard error. Any other `stat` failure
     * (permissions, an environment without `stat`) is treated as
     * inconclusive: the check is skipped and the write proceeds, surfacing
     * the real I/O error if any.
     *
     * Returns an error string when the precondition is definitively violated,
     * or `undefined` otherwise.
     */
    private ensureParentDirectory;
}
