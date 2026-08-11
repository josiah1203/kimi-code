/**
 * Per-process OAuth orchestrator for MCP HTTP servers.
 *
 * The service owns one {@link McpOAuthClientProvider} per server/resource and
 * mediates the synthetic `mcp__<server>__authenticate` tool flow:
 *
 *  1. `getProvider(serverName, serverUrl)` returns the cached provider.
 *     `HttpMcpClient` hands this to `StreamableHTTPClientTransport.authProvider`
 *     only when the server has no static bearer token configured **and** the
 *     provider has stored tokens for that same server URL — first-time
 *     connections that lack tokens skip the provider entirely so a 401 surfaces
 *     as `UnauthorizedError` from the transport instead of being swallowed by an
 *     in-flight `auth()` attempt.
 *  2. `beginAuthorization(serverName, serverUrl)` spins up a one-shot
 *     localhost callback listener, sets the redirect URL on the provider,
 *     and drives the SDK `auth()` orchestrator forward until it surfaces an
 *     authorization URL. It returns that URL plus a `complete()` callback
 *     that finishes the code exchange once the user finishes the browser
 *     flow.
 *  3. After `complete()` resolves successfully the provider has tokens on
 *     disk; the caller (the synthetic tool) drives a manager-level
 *     `reconnect` to swap the synthetic tool out for the real MCP tools.
 */
import { McpOAuthClientProvider } from './provider';
import { JsonFileStore } from './store';
export interface McpOAuthServiceOptions {
    /** Storage backend; overrides `kimiHomeDir` when supplied. */
    readonly store?: JsonFileStore;
    /** Resolved Kimi home; credentials default to `<kimiHomeDir>/credentials/mcp/`. */
    readonly kimiHomeDir?: string;
    /** Override for the label embedded in DCR `client_name`. */
    readonly clientLabel?: string;
}
export interface BeginAuthorizationOptions {
    /** Override the `client_name` embedded in the DCR registration request. */
    readonly clientLabel?: string;
}
export interface BeginAuthorizationResult {
    /** The authorization URL the user must open in their browser. */
    readonly authorizationUrl: URL;
    /**
     * Awaits the OAuth callback, validates `state`, exchanges the code for
     * tokens, and persists them via the provider. Resolves on success;
     * rejects on abort, timeout, or auth-server error.
     */
    complete(opts?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<void>;
    /**
     * Tears down the callback listener without finishing the flow. Safe to
     * call repeatedly; called automatically by `complete()`.
     */
    cancel(): Promise<void>;
}
export declare class McpOAuthService {
    private readonly store;
    private readonly clientLabel;
    private readonly providers;
    constructor(options?: McpOAuthServiceOptions);
    /** Returns the cached provider for `serverName` + `serverUrl`, constructing it on first use. */
    getProvider(serverName: string, serverUrl: string | URL): McpOAuthClientProvider;
    /** True once the provider has persisted tokens for this server/resource identity. */
    hasTokens(serverName: string, serverUrl: string | URL): boolean;
    /**
     * Drive the SDK `auth()` orchestrator far enough to surface an
     * authorization URL. The caller is responsible for displaying the URL
     * (typically via the synthetic authenticate tool) and then awaiting
     * `complete()` to finish the code exchange.
     */
    beginAuthorization(serverName: string, serverUrl: string | URL, options?: BeginAuthorizationOptions): Promise<BeginAuthorizationResult>;
    /**
     * Clear stored credentials for a server. Use `'all'` after the user
     * explicitly signs out; use `'tokens'` to force a re-auth while keeping
     * the registered DCR client.
     */
    invalidate(serverName: string, serverUrl: string | URL, scope?: 'all' | 'client' | 'tokens' | 'discovery'): void;
}
/** Thrown by `beginAuthorization` when stored tokens already satisfy the server. */
export declare class AlreadyAuthorizedError extends Error {
    constructor(serverName: string);
}
