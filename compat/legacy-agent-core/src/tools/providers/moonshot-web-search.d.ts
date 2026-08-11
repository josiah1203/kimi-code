/**
 * MoonshotWebSearchProvider — host-side `WebSearchProvider`.
 *
 * Auth uses a narrow bearer token provider per request. Host-specific
 * default headers are supplied by runtime and request-level overrides
 * come from `customHeaders`.
 */
import type { WebSearchProvider, WebSearchResult } from '../builtin';
export interface BearerTokenProvider {
    getAccessToken(options?: {
        readonly force?: boolean | undefined;
    }): Promise<string>;
}
export interface MoonshotWebSearchProviderOptions {
    tokenProvider?: BearerTokenProvider;
    apiKey?: string;
    baseUrl: string;
    defaultHeaders?: Record<string, string>;
    customHeaders?: Record<string, string>;
    fetchImpl?: typeof fetch;
}
export declare class MoonshotWebSearchProvider implements WebSearchProvider {
    private readonly tokenProvider;
    private readonly apiKey;
    private readonly baseUrl;
    private readonly defaultHeaders;
    private readonly customHeaders;
    private readonly fetchImpl;
    constructor(options: MoonshotWebSearchProviderOptions);
    search(query: string, options?: {
        toolCallId?: string;
    }): Promise<WebSearchResult[]>;
    private post;
    private resolveApiKey;
}
