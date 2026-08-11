/**
 * `OAuthClientProvider` implementation backed by per-MCP-server JSON files.
 *
 * One provider instance per server/resource identity. The provider:
 *  - Persists OAuth tokens, the registered DCR client info, and discovery
 *    state under `<KIMI_CODE_HOME>/credentials/mcp/<key>-*.json`
 *    (mode 0600; default home is `~/.kimi-code`).
 *  - Captures the authorization URL when the SDK calls
 *    `redirectToAuthorization` — the {@link McpOAuthService} reads that field
 *    after the first `auth()` call returns `'REDIRECT'`.
 *  - Keeps the PKCE verifier and OAuth `state` in-memory (one flow per
 *    provider at a time; callers serialize via the service).
 *
 * The provider does **not** open browsers or run servers. The service is the
 * orchestrator; the provider is the persistence + flow-state shim.
 */
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { JsonFileStore } from './store';
export interface McpOAuthProviderOptions {
    /** Friendly name of the MCP server; used in DCR `client_name`. */
    readonly serverName: string;
    /** Canonical resource identity used to isolate credentials for this server entry. */
    readonly serverUrl: string | URL;
    /** JSON store used for persistence. Tests inject an in-memory dir. */
    readonly store: JsonFileStore;
    /** Identifier embedded in DCR `client_name` ("kimi-code (server)"). */
    readonly clientLabel?: string;
}
export declare class McpOAuthClientProvider implements OAuthClientProvider {
    readonly storeKey: string;
    readonly serverUrl: string;
    private readonly store;
    private readonly clientLabel;
    private _redirectUrl;
    private _codeVerifier;
    private _state;
    private _lastAuthorizationUrl;
    constructor(options: McpOAuthProviderOptions);
    setRedirectUrl(url: URL): void;
    /** URL captured from the most recent `redirectToAuthorization` call. */
    takeAuthorizationUrl(): URL | undefined;
    /** OAuth `state` value generated for the most recent flow, for callback verification. */
    expectedState(): string | undefined;
    resetFlow(): void;
    get redirectUrl(): string | URL;
    get clientMetadata(): OAuthClientMetadata;
    state(): string;
    clientInformation(): OAuthClientInformationMixed | undefined;
    saveClientInformation(info: OAuthClientInformationMixed): void;
    tokens(): OAuthTokens | undefined;
    saveTokens(tokens: OAuthTokens): void;
    redirectToAuthorization(url: URL): void;
    saveCodeVerifier(codeVerifier: string): void;
    codeVerifier(): string;
    saveDiscoveryState(state: OAuthDiscoveryState): void;
    discoveryState(): OAuthDiscoveryState | undefined;
    /**
     * Drop the persisted DCR client registration when its `redirect_uris` no
     * longer cover `redirectUri`. Returns true when a stale registration was
     * dropped.
     *
     * The callback listener binds a random port per flow, while a DCR
     * registration pins the redirect URIs of the flow that created it. Reusing
     * a registration whose URIs no longer match guarantees an
     * "invalid redirect URI" rejection at the authorization endpoint — rendered
     * only in the user's browser, while this client waits for a callback that
     * never comes. Dropping the registration lets the next `auth()` call
     * re-register with the current callback URI.
     */
    invalidateStaleRegistration(redirectUri: string): boolean;
    invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void;
    private effectiveRedirectUri;
}
