import type { LogContext, LogEntry } from './types';
export declare const MSG_MAX_CHARS = 200;
export declare const CTX_VALUE_MAX_CHARS = 2048;
export declare const STACK_MAX_BYTES = 2048;
export declare const ENTRY_MAX_BYTES = 4096;
export declare const REDACT_MAX_DEPTH = 10;
export declare function redactCtx(ctx: LogContext): LogContext;
export interface FormatOptions {
    readonly ansi?: boolean | undefined;
    readonly omitContextKeys?: readonly string[];
}
export interface FormattedEntry {
    readonly text: string;
    readonly dropped: boolean;
}
export declare function formatEntry(entry: LogEntry, options?: FormatOptions): FormattedEntry;
export declare function extractError(value: Error): {
    message: string;
    stack?: string;
};
