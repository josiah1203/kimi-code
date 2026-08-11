/**
 * MoonshotFetchURLProvider — host-side UrlFetcher.
 *
 * Flow:
 *   1. Try Moonshot coding-fetch service (POST {url}, Bearer token from a
 *      narrow token provider, Accept: text/markdown, host-provided headers).
 *   2. Moonshot 200 → return the body as `extracted` content (the
 *      service has already extracted the main page text on its side).
 *   3. Any Moonshot failure — non-200, network error, or token
 *      refresh failure — → delegate to `localFallback`, forwarding its
 *      content kind, so the LLM still gets *something* when the service
 *      is down.
 *   4. If localFallback also throws → propagate that error.
 */
import { type UrlFetcher, type UrlFetchResult } from '../builtin';
export interface BearerTokenProvider {
    getAccessToken(options?: {
        readonly force?: boolean | undefined;
    }): Promise<string>;
}
export interface MoonshotFetchURLProviderOptions {
    tokenProvider?: BearerTokenProvider;
    apiKey?: string;
    baseUrl: string;
    defaultHeaders?: Record<string, string>;
    customHeaders?: Record<string, string>;
    localFallback: UrlFetcher;
    fetchImpl?: typeof fetch;
}
export declare class MoonshotFetchURLProvider implements UrlFetcher {
    private readonly tokenProvider;
    private readonly apiKey;
    private readonly baseUrl;
    private readonly defaultHeaders;
    private readonly customHeaders;
    private readonly localFallback;
    private readonly fetchImpl;
    constructor(options: MoonshotFetchURLProviderOptions);
    fetch(url: string, options?: {
        toolCallId?: string;
    }): Promise<UrlFetchResult>;
    private fetchViaMoonshot;
    private post;
    private resolveApiKey;
}
