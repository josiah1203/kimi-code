/**
 * EditTool — exact string replacement in a file.
 *
 * Replaces the first occurrence of `old_string` with `new_string` by
 * default. When `replace_all` is true, replaces all occurrences.
 * Errors when `old_string` is not found or not unique (when
 * `replace_all=false`). Path access policy is resolved before any
 * Kaos I/O.
 */
import type { Kaos } from '@spiderbyte/kaos';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type { WorkspaceConfig } from '../../support/workspace';
export declare const EditInputSchema: z.ZodObject<{
    path: z.ZodString;
    old_string: z.ZodString;
    new_string: z.ZodString;
    replace_all: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type EditInput = z.Infer<typeof EditInputSchema>;
export declare class EditTool implements BuiltinTool<EditInput> {
    private readonly kaos;
    private readonly workspace;
    readonly name: "Edit";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(kaos: Kaos, workspace: WorkspaceConfig);
    resolveExecution(args: EditInput): ToolExecution;
    private execution;
}
