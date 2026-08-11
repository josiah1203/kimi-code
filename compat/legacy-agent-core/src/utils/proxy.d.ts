import { type Dispatcher } from 'undici';
type Env = Readonly<Record<string, string | undefined>>;
/** A parsed SOCKS proxy endpoint, in the shape the `socks` client expects. */
export interface SocksProxyConfig {
    /** SOCKS protocol version: 4 (socks4/socks4a) or 5 (socks/socks5/socks5h). */
    readonly type: 4 | 5;
    readonly host: string;
    readonly port: number;
    readonly userId?: string;
    readonly password?: string;
}
/**
 * Resolve a SOCKS proxy from the environment, or `undefined` if none. A SOCKS
 * proxy may be declared via `ALL_PROXY` (the common form for Clash / V2RayN) or
 * by putting a `socks*` scheme in `HTTP(S)_PROXY`. `ALL_PROXY` wins, then
 * `HTTPS_PROXY`, then `HTTP_PROXY`. `socks://` is an alias for `socks5://`.
 */
export declare function resolveSocksProxy(env?: Env): SocksProxyConfig | undefined;
/** True when any HTTP(S) or SOCKS proxy variable is set to a usable value. */
export declare function isProxyConfigured(env?: Env): boolean;
/**
 * The effective `NO_PROXY` with loopback hosts guaranteed present so local
 * traffic stays direct. Reads both casings (lowercase first when non-blank,
 * matching undici), preserves the user's entries, and appends only the missing
 * loopback hosts.
 *
 * The `*` wildcard ("bypass everything") is returned verbatim: undici only
 * honors it as an exact-string match, so appending loopback would silently
 * defeat the user's explicit opt-out and route all non-loopback traffic
 * through the proxy.
 */
export declare function resolveNoProxy(env?: Env): string;
/**
 * Build a predicate that returns true when a host (and optional port) should
 * bypass the proxy, given a `NO_PROXY` string. Matches `*` (all), exact hosts,
 * and subdomains for both bare (`example.com`) and leading-dot (`.example.com`)
 * entries; a port-qualified entry (`host:443`) matches only that port. Used for
 * the SOCKS path, where bypass is not handled by undici for us.
 */
export declare function makeNoProxyMatcher(noProxy: string): (host: string, port?: number | string) => boolean;
export interface ProxyAgentFactories {
    /** Build the dispatcher for an HTTP/HTTPS proxy. */
    readonly makeHttpAgent: (options: {
        httpProxy?: string;
        httpsProxy?: string;
        noProxy: string;
    }) => Dispatcher;
    /** Build the dispatcher for a SOCKS proxy. */
    readonly makeSocksAgent: (options: {
        proxy: SocksProxyConfig;
        noProxy: string;
    }) => Dispatcher;
}
/**
 * Build an undici dispatcher that routes outbound `fetch` through the
 * configured proxy while honoring the (loopback-augmented) `NO_PROXY`. An
 * HTTP/HTTPS proxy takes precedence for matching traffic; otherwise a SOCKS
 * proxy (`ALL_PROXY` or a `socks*` scheme) is used. Returns `undefined` when no
 * proxy variable is set, so the zero-config majority keeps Node's default
 * dispatcher untouched.
 */
export declare function createProxyDispatcher(env?: Env, factories?: Partial<ProxyAgentFactories>): Dispatcher | undefined;
export interface InstallProxyDeps {
    readonly setGlobalDispatcher: (dispatcher: Dispatcher) => void;
    readonly createProxyDispatcher: (env: Env) => Dispatcher | undefined;
}
/**
 * Install the proxy dispatcher as the process-wide undici dispatcher so every
 * `fetch` — LLM SDKs, in-process MCP HTTP, telemetry, OAuth, web tools, update
 * checks, downloads — honors the proxy. Call once at process startup, before
 * any network use. No-op (returns `false`) when no proxy variable is set.
 */
export declare function installGlobalProxyDispatcher(env?: Env, deps?: InstallProxyDeps): boolean;
/**
 * Environment additions for spawned child node processes (e.g. stdio MCP
 * servers) so they honor the proxy natively via Node's `--use-env-proxy`
 * without bundling undici. An in-process global dispatcher is NOT inherited
 * across a process boundary — only env vars are — so children rely on this.
 *
 * Only applies to HTTP/HTTPS proxies: Node's `--use-env-proxy` does not support
 * SOCKS, so a SOCKS-only proxy yields `{}` (child SOCKS proxying is out of
 * scope). Everything is set in BOTH casings: the child inherits the parent's
 * env and undici reads the lowercase form first, so the lowercase variants must
 * also carry the resolved values or the protection/proxying is silently lost.
 *
 * Because `--use-env-proxy` reads `HTTP_PROXY`/`HTTPS_PROXY` (not `ALL_PROXY`),
 * an http-scheme `ALL_PROXY` is synthesized into the scheme-specific variables
 * so an `ALL_PROXY`-only parent still proxies the child.
 */
export declare function proxyEnvForChild(env?: Env): Record<string, string>;
/**
 * Mirror a server config's `NO_PROXY` override onto both casings of the child
 * env. undici reads the lowercase `no_proxy` first, so without this the value
 * {@link proxyEnvForChild} injected in the other casing would shadow an
 * explicit per-server override.
 *
 * Uses the first NON-blank casing (a blank `no_proxy=''` must not mask a
 * populated `NO_PROXY`, mirroring {@link resolveNoProxy}) and runs the value
 * back through {@link resolveNoProxy} so the loopback bypass is preserved and
 * `*` passes through verbatim. No-op when config sets no usable `NO_PROXY`.
 */
export declare function reconcileChildNoProxy(childEnv: Record<string, string>, configEnv?: Record<string, string>): void;
export {};
