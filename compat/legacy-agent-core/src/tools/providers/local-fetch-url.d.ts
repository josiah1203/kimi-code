/**
 * LocalFetchURLProvider — host-side URL fetcher.
 *
 * Flow:
 *   1. Validate the URL against the SSRF rules (scheme, IP literals, DNS
 *      resolution) and GET it with a Chrome-like UA, following redirects
 *      manually with every hop re-validated and pinned to the validated
 *      addresses.
 *   2. Reject HTTP >= 400 with the status code in the message.
 *   3. Reject responses larger than `maxBytes` (content-length first,
 *      then measured body length as a defensive second check).
 *   4. `text/plain` / `text/markdown` → passthrough verbatim.
 *   5. Otherwise (assumed HTML) → run Readability over a linkedom
 *      document. Return `# ${title}\n\n${text}` (title omitted when
 *      absent). If extraction yields no meaningful text, fall back to
 *      common content containers (`<article>` / `<main>` / `<body>`)
 *      before throwing a "meaningful content" error.
 */
import { type UrlFetcher, type UrlFetchResult } from '../builtin';
export interface LocalFetchURLProviderOptions {
    userAgent?: string;
    fetchImpl?: typeof fetch;
    maxBytes?: number;
    /**
     * Allow fetching loopback / RFC 1918 / link-local / ULA addresses.
     * Defaults to `false` — enabled only for tests and (future) explicit
     * opt-in. Keeps an LLM that's been prompt-injected from exfiltrating
     * AWS/GCP metadata (169.254.169.254), probing internal services
     * (10.x, 192.168.x), or reading local daemons (127.0.0.1:*).
     */
    allowPrivateAddresses?: boolean;
}
export declare class LocalFetchURLProvider implements UrlFetcher {
    private readonly userAgent;
    private readonly fetchImpl;
    private readonly maxBytes;
    private readonly allowPrivateAddresses;
    constructor(options?: LocalFetchURLProviderOptions);
    fetch(url: string, _options?: {
        toolCallId?: string;
    }): Promise<UrlFetchResult>;
    private readResponse;
    /**
     * GET `url`, following redirects manually. Every hop re-runs the full
     * SSRF check (IP-literal + DNS) before the request goes out — a public
     * URL must not be able to bounce the fetcher at an internal address.
     * Redirects without a `Location` header are treated as final responses.
     */
    private requestWithValidatedRedirects;
    /**
     * Pin the connection to the addresses the safety check just validated.
     * undici resolves the origin again when it connects, so without pinning
     * an attacker-controlled DNS could answer the check with a public IP and
     * the connect with an internal one (TOCTOU / DNS rebinding).
     */
    private pinnedDispatcherFor;
    private extractMainContent;
}
