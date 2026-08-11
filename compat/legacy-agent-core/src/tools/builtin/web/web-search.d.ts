/**
 * WebSearchTool — host-injected web search.
 *
 * kimi-core defines the interface; the host provides the real search
 * implementation via `WebSearchProvider`. If no provider is supplied,
 * the tool should not be registered (not exposed to the LLM).
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
    date?: string;
    siteName?: string;
}
export interface WebSearchProvider {
    search(query: string, options?: {
        toolCallId?: string;
    }): Promise<WebSearchResult[]>;
}
export declare const WebSearchInputSchema: z.ZodObject<{
    query: z.ZodString;
}, z.core.$strip>;
export type WebSearchInput = z.Infer<typeof WebSearchInputSchema>;
export declare class WebSearchTool implements BuiltinTool<WebSearchInput> {
    private readonly provider;
    readonly name: "WebSearch";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    constructor(provider: WebSearchProvider);
    resolveExecution(args: WebSearchInput): ToolExecution;
    private execution;
}
