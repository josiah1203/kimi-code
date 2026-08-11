import type { ExecutableToolErrorResult, ExecutableToolSuccessResult } from '../../loop/types';
export interface ToolResultBuilderOptions {
    readonly maxChars?: number;
    readonly maxLineLength?: number | null;
}
export type ExecutableToolResultBuilderResult = (ExecutableToolSuccessResult | ExecutableToolErrorResult) & {
    readonly output: string;
    readonly message: string;
    readonly truncated: boolean;
    readonly brief?: string;
};
export declare class ToolResultBuilder {
    private readonly maxChars;
    private readonly maxLineLength;
    private readonly buffer;
    private nCharsValue;
    private truncationHappened;
    constructor(options?: ToolResultBuilderOptions);
    get nChars(): number;
    get truncated(): boolean;
    write(text: string): number;
    ok(message?: string, options?: {
        readonly brief?: string;
    }): ExecutableToolResultBuilderResult;
    error(message: string, options?: {
        readonly brief?: string;
    }): ExecutableToolResultBuilderResult;
}
