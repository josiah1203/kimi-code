/**
 * FetchURLTool — host-injected URL fetcher.
 *
 * kimi-core defines the interface; the host provides the real fetch
 * implementation via `UrlFetcher`. If no fetcher is supplied, the tool
 * should not be registered (not exposed to the LLM).
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
/**
 * How the returned content relates to the original response body.
 *
 * - `passthrough` — the body was already plain text / markdown and is
 *   returned verbatim, in full.
 * - `extracted` — the body was an HTML page; only the main article text
 *   was extracted and returned.
 */
export type UrlFetchKind = 'passthrough' | 'extracted';
export interface UrlFetchResult {
    /** The text handed to the LLM. */
    content: string;
    /** Whether `content` is a verbatim passthrough or extracted main text. */
    kind: UrlFetchKind;
}
export interface UrlFetcher {
    fetch(url: string, options?: {
        toolCallId?: string;
    }): Promise<UrlFetchResult>;
}
/**
 * Thrown by a `UrlFetcher` when the upstream HTTP request completed but
 * returned a non-success status. The tool branches on this to surface
 * `Status: N` in the error message; non-HTTP failures (DNS, timeout,
 * connection reset, …) keep flowing through as plain `Error`.
 */
export declare class HttpFetchError extends Error {
    readonly name = "HttpFetchError";
    readonly status: number;
    constructor(status: number, message: string);
}
export declare const FetchURLInputSchema: z.ZodObject<{
    url: z.ZodString;
}, z.core.$strip>;
export type FetchURLInput = z.Infer<typeof FetchURLInputSchema>;
export declare class FetchURLTool implements BuiltinTool<FetchURLInput> {
    private readonly fetcher;
    readonly name: "FetchURL";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(fetcher: UrlFetcher);
    resolveExecution(args: FetchURLInput): ToolExecution;
    private execution;
}
