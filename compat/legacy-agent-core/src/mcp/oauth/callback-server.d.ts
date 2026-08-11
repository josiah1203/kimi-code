/**
 * One-shot localhost OAuth callback listener.
 *
 * `startCallbackServer()` binds 127.0.0.1 on a random free port and returns a
 * handle exposing the resulting `redirect_uri` and an awaitable
 * `waitForCode()` that resolves with `{ code, state }` from the first
 * `/callback` request. Any subsequent requests get a generic 404 and a
 * non-callback path is ignored. The server is closed automatically once a
 * code has been delivered (or `close()` is called explicitly).
 */
export interface CallbackResult {
    readonly code: string;
    readonly state: string | undefined;
}
export interface CallbackServer {
    readonly redirectUri: string;
    /**
     * Resolves with the OAuth callback payload, or rejects when:
     *  - `signal` aborts → AbortError
     *  - `timeoutMs` elapses → Error('OAuth callback timed out')
     *  - the user's authorization server returns an error → Error('OAuth error: <code>')
     */
    waitForCode(opts: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<CallbackResult>;
    close(): Promise<void>;
}
export declare function startCallbackServer(): Promise<CallbackServer>;
