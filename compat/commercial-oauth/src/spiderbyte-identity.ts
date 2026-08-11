/** SpiderByte account OAuth/OIDC client.
 *
 * This module is deliberately separate from the managed Kimi provider OAuth
 * flow. SpiderByte account tokens are a tenancy credential, not an LLM
 * provider credential, and are persisted under a separate credentials
 * directory. The authority is configured by the host so the local Open Core
 * path never depends on a hosted identity service.
 */

import { createHash, randomBytes } from 'node:crypto';

import { FileTokenStorage } from './storage';
import type { TokenInfo } from './types';
import { isRecord } from './utils';

const DEFAULT_SCOPE = 'openid profile email offline_access';
const HTTP_TIMEOUT_MS = 30_000;

export interface SpiderByteIdentityConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly scope?: string | undefined;
  readonly redirectUri?: string | undefined;
  readonly authorizationEndpoint?: string | undefined;
  readonly tokenEndpoint?: string | undefined;
  readonly deviceAuthorizationEndpoint?: string | undefined;
  readonly revocationEndpoint?: string | undefined;
  readonly userInfoEndpoint?: string | undefined;
}

export interface SpiderByteAccountToken {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresAt: number;
  readonly scope: string;
  readonly tokenType: string;
}

export interface SpiderByteIdentityStatus {
  readonly authenticated: boolean;
  readonly authority: string;
  readonly expiresAt?: number | undefined;
}

export interface SpiderByteAuthorizationRequest {
  readonly url: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

export interface SpiderByteDeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string | undefined;
  readonly expiresIn: number;
  readonly interval: number;
}

export type SpiderByteDevicePollResult =
  | { readonly kind: 'success'; readonly token: SpiderByteAccountToken }
  | { readonly kind: 'pending'; readonly errorCode: string; readonly description: string }
  | { readonly kind: 'expired' }
  | { readonly kind: 'denied'; readonly description: string };

export interface SpiderByteTokenStorage {
  load(): Promise<SpiderByteAccountToken | undefined>;
  save(token: SpiderByteAccountToken): Promise<void>;
  remove(): Promise<void>;
}

/** Separate on-disk class/path from provider OAuth and provider SecretRefs. */
export class FileSpiderByteTokenStorage implements SpiderByteTokenStorage {
  private readonly fileStorage: FileTokenStorage;

  constructor(credentialsDir: string) {
    this.fileStorage = new FileTokenStorage(credentialsDir);
  }

  async load(): Promise<SpiderByteAccountToken | undefined> {
    const token = await this.fileStorage.load('account');
    if (token === undefined || token.accessToken.length === 0) return undefined;
    return fromTokenInfo(token);
  }

  async save(token: SpiderByteAccountToken): Promise<void> {
    await this.fileStorage.save('account', toTokenInfo(token));
  }

  async remove(): Promise<void> {
    await this.fileStorage.remove('account');
  }
}

export class SpiderByteIdentityError extends Error {
  readonly status: number | undefined;
  readonly errorCode: string | undefined;

  constructor(
    message: string,
    options?: { readonly status?: number | undefined; readonly errorCode?: string | undefined },
  ) {
    super(message);
    this.name = 'SpiderByteIdentityError';
    this.status = options?.status;
    this.errorCode = options?.errorCode;
  }
}

export class SpiderByteIdentityClient {
  private readonly config: SpiderByteIdentityConfig;
  private readonly storage: SpiderByteTokenStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private discovered: Promise<ResolvedIdentityEndpoints> | undefined;

  constructor(options: {
    readonly config: SpiderByteIdentityConfig;
    readonly storage: SpiderByteTokenStorage;
    readonly fetchImpl?: typeof fetch | undefined;
    readonly now?: (() => number) | undefined;
  }) {
    this.config = validateConfig(options.config);
    this.storage = options.storage;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async status(): Promise<SpiderByteIdentityStatus> {
    const token = await this.storage.load();
    return {
      authenticated: token !== undefined && token.expiresAt > this.now(),
      authority: this.config.issuer,
      expiresAt: token?.expiresAt,
    };
  }

  async getAccessToken(): Promise<string | undefined> {
    const token = await this.storage.load();
    if (token === undefined) return undefined;
    if (token.expiresAt > this.now() + 60) return token.accessToken;
    if (token.refreshToken === undefined) return undefined;
    const refreshed = await this.refresh(token.refreshToken);
    await this.storage.save(refreshed);
    return refreshed.accessToken;
  }

  async createAuthorizationRequest(options?: {
    readonly redirectUri?: string | undefined;
    readonly state?: string | undefined;
    readonly nonce?: string | undefined;
  }): Promise<SpiderByteAuthorizationRequest> {
    const endpoints = await this.endpoints();
    const redirectUri = options?.redirectUri ?? this.config.redirectUri;
    if (redirectUri === undefined) {
      throw new SpiderByteIdentityError('SpiderByte PKCE login requires a registered redirect URI.');
    }
    const state = options?.state ?? randomBase64Url(32);
    const nonce = options?.nonce ?? randomBase64Url(32);
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
    const url = new URL(endpoints.authorization);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', this.config.scope ?? DEFAULT_SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), state, codeVerifier, nonce, redirectUri };
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string, redirectUri?: string): Promise<SpiderByteAccountToken> {
    const endpoints = await this.endpoints();
    const response = await postForm(this.fetchImpl, endpoints.token, {
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri ?? this.config.redirectUri ?? '',
    });
    const token = tokenFromPayload(response.data, response.status);
    await this.storage.save(token);
    return token;
  }

  async requestDeviceAuthorization(): Promise<SpiderByteDeviceAuthorization> {
    const endpoints = await this.endpoints();
    if (endpoints.deviceAuthorization === undefined) {
      throw new SpiderByteIdentityError('SpiderByte authority does not advertise device authorization.');
    }
    const response = await postForm(this.fetchImpl, endpoints.deviceAuthorization, {
      client_id: this.config.clientId,
      scope: this.config.scope ?? DEFAULT_SCOPE,
    });
    const data = response.data;
    const deviceCode = requiredString(data['device_code'], 'device_code', response.status);
    const userCode = requiredString(data['user_code'], 'user_code', response.status);
    const verificationUri = requiredString(
      data['verification_uri'] ?? data['verification_url'],
      'verification_uri',
      response.status,
    );
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete:
        typeof data['verification_uri_complete'] === 'string'
          ? data['verification_uri_complete']
          : undefined,
      expiresIn: positiveNumber(data['expires_in'], 900),
      interval: Math.max(1, positiveNumber(data['interval'], 5)),
    };
  }

  async pollDeviceAuthorization(deviceCode: string): Promise<SpiderByteDevicePollResult> {
    const endpoints = await this.endpoints();
    const response = await postForm(this.fetchImpl, endpoints.token, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: this.config.clientId,
      device_code: deviceCode,
    });
    const errorCode = typeof response.data['error'] === 'string' ? response.data['error'] : undefined;
    if (response.status === 200 && typeof response.data['access_token'] === 'string') {
      const token = tokenFromPayload(response.data, response.status);
      await this.storage.save(token);
      return { kind: 'success', token };
    }
    if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
      return {
        kind: 'pending',
        errorCode,
        description: stringValue(response.data['error_description']),
      };
    }
    if (errorCode === 'expired_token') return { kind: 'expired' };
    if (errorCode === 'access_denied') {
      return { kind: 'denied', description: stringValue(response.data['error_description']) };
    }
    throw identityError(response, 'SpiderByte device token polling failed');
  }

  async refresh(refreshToken: string): Promise<SpiderByteAccountToken> {
    const endpoints = await this.endpoints();
    const response = await postForm(this.fetchImpl, endpoints.token, {
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      refresh_token: refreshToken,
    });
    const token = tokenFromPayload(response.data, response.status, refreshToken);
    return token;
  }

  async revoke(): Promise<void> {
    const token = await this.storage.load();
    try {
      const endpoints = await this.endpoints();
      if (endpoints.revocation !== undefined && token !== undefined) {
        await postForm(this.fetchImpl, endpoints.revocation, {
          token: token.accessToken,
          client_id: this.config.clientId,
          token_type_hint: 'access_token',
        });
      }
    } finally {
      await this.storage.remove();
    }
  }

  async getUserInfo(): Promise<Record<string, unknown> | undefined> {
    const endpoints = await this.endpoints();
    if (endpoints.userInfo === undefined) return undefined;
    const accessToken = await this.getAccessToken();
    if (accessToken === undefined) return undefined;
    const response = await this.fetchImpl(endpoints.userInfo, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const data = await readJson(response);
    if (!response.ok || !isRecord(data)) throw identityError({ status: response.status, data }, 'SpiderByte userinfo failed');
    return data;
  }

  private async endpoints(): Promise<ResolvedIdentityEndpoints> {
    this.discovered ??= this.resolveEndpoints();
    return this.discovered;
  }

  private async resolveEndpoints(): Promise<ResolvedIdentityEndpoints> {
    const explicit = {
      authorization: this.config.authorizationEndpoint,
      token: this.config.tokenEndpoint,
      deviceAuthorization: this.config.deviceAuthorizationEndpoint,
      revocation: this.config.revocationEndpoint,
      userInfo: this.config.userInfoEndpoint,
    };
    if (explicit.authorization !== undefined && explicit.token !== undefined) {
      return {
        authorization: validateEndpoint(explicit.authorization),
        token: validateEndpoint(explicit.token),
        deviceAuthorization: optionalEndpoint(explicit.deviceAuthorization),
        revocation: optionalEndpoint(explicit.revocation),
        userInfo: optionalEndpoint(explicit.userInfo),
      };
    }
    const discoveryUrl = new URL('/.well-known/openid-configuration', this.config.issuer).toString();
    const response = await this.fetchImpl(discoveryUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const data = await readJson(response);
    if (!response.ok || !isRecord(data)) {
      throw identityError({ status: response.status, data }, 'SpiderByte OIDC discovery failed');
    }
    const authorization = requiredString(data['authorization_endpoint'], 'authorization_endpoint', response.status);
    const token = requiredString(data['token_endpoint'], 'token_endpoint', response.status);
    return {
      authorization: validateEndpoint(authorization),
      token: validateEndpoint(token),
      deviceAuthorization: optionalEndpoint(
        typeof data['device_authorization_endpoint'] === 'string'
          ? data['device_authorization_endpoint']
          : typeof data['device_endpoint'] === 'string'
            ? data['device_endpoint']
            : undefined,
      ),
      revocation: optionalEndpoint(
        typeof data['revocation_endpoint'] === 'string' ? data['revocation_endpoint'] : undefined,
      ),
      userInfo: optionalEndpoint(
        typeof data['userinfo_endpoint'] === 'string' ? data['userinfo_endpoint'] : undefined,
      ),
    };
  }
}

interface ResolvedIdentityEndpoints {
  readonly authorization: string;
  readonly token: string;
  readonly deviceAuthorization: string | undefined;
  readonly revocation: string | undefined;
  readonly userInfo: string | undefined;
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  params: Record<string, string>,
): Promise<{ readonly status: number; readonly data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpiderByteIdentityError(
      `SpiderByte identity request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const data = await readJson(response);
  if (!isRecord(data)) throw identityError({ status: response.status, data }, 'SpiderByte identity returned invalid JSON');
  return { status: response.status, data };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function tokenFromPayload(
  data: Record<string, unknown>,
  status: number,
  fallbackRefreshToken?: string,
): SpiderByteAccountToken {
  if (status < 200 || status >= 300) throw identityError({ status, data }, 'SpiderByte token request failed');
  const accessToken = requiredString(data['access_token'], 'access_token', status);
  const refreshToken = typeof data['refresh_token'] === 'string' ? data['refresh_token'] : fallbackRefreshToken;
  return {
    accessToken,
    refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + positiveNumber(data['expires_in'], 3600),
    scope: stringValue(data['scope']),
    tokenType: typeof data['token_type'] === 'string' ? data['token_type'] : 'Bearer',
  };
}

function identityError(
  response: { readonly status: number; readonly data: unknown },
  prefix: string,
): SpiderByteIdentityError {
  const data = isRecord(response.data) ? response.data : {};
  const code = typeof data['error'] === 'string' ? data['error'] : undefined;
  const detail = typeof data['error_description'] === 'string' ? data['error_description'] : undefined;
  return new SpiderByteIdentityError(
    `${prefix} (HTTP ${response.status})${detail === undefined ? '' : `: ${detail}`}`,
    { status: response.status, errorCode: code },
  );
}

function requiredString(value: unknown, field: string, status: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SpiderByteIdentityError(`SpiderByte response missing ${field} (HTTP ${status})`, { status });
  }
  return value;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function validateConfig(config: SpiderByteIdentityConfig): SpiderByteIdentityConfig {
  const issuer = validateEndpoint(config.issuer);
  if (config.clientId.trim().length === 0) throw new SpiderByteIdentityError('SpiderByte client ID must not be blank.');
  return { ...config, issuer };
}

function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new SpiderByteIdentityError('SpiderByte identity endpoints must use HTTPS (or loopback HTTP for development).');
  }
  return url.toString().replace(/\/$/, '');
}

function optionalEndpoint(value: string | undefined): string | undefined {
  return value === undefined ? undefined : validateEndpoint(value);
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function randomBase64Url(bytes: number): string {
  return base64Url(randomBytes(bytes));
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromTokenInfo(token: TokenInfo): SpiderByteAccountToken {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken.length === 0 ? undefined : token.refreshToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
    tokenType: token.tokenType,
  };
}

function toTokenInfo(token: SpiderByteAccountToken): TokenInfo {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? '',
    expiresAt: token.expiresAt,
    scope: token.scope,
    tokenType: token.tokenType,
    expiresIn: Math.max(0, token.expiresAt - Math.floor(Date.now() / 1000)),
  };
}
