import type { Kaos } from '@spiderbyte/kaos';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type { WorkspaceConfig } from '../../support/workspace';
export declare const MAX_LINES: number;
export declare const MAX_LINE_LENGTH: number;
export declare const MAX_BYTES: number;
export declare const ReadInputSchema: z.ZodObject<{
    path: z.ZodString;
    line_offset: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodNumber]>>;
    n_lines: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ReadOutputSchema: z.ZodObject<{
    content: z.ZodString;
    lineCount: z.ZodNumber;
}, z.core.$strip>;
export type ReadInput = z.Infer<typeof ReadInputSchema>;
export type ReadOutput = z.Infer<typeof ReadOutputSchema>;
export declare class ReadTool implements BuiltinTool<ReadInput> {
    private readonly kaos;
    private readonly workspace;
    readonly name: "Read";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(kaos: Kaos, workspace: WorkspaceConfig);
    resolveExecution(args: ReadInput): ToolExecution;
    private execution;
    private readForward;
    private readTail;
    private finishTailEntries;
    private finishReadResult;
    private finishMessage;
}
