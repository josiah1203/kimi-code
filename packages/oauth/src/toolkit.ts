import { homedir } from 'node:os';
import { join } from 'node:path';

import { OAuthError } from './errors';
import { assertSpiderByteHostIdentity, createSpiderByteDefaultHeaders, type SpiderByteHostIdentity } from './identity';
import { OAuthManager, type LoginOptions, type OAuthManagerOptions } from './oauth-manager';
import { FileTokenStorage, type TokenStorage } from './storage';
import type { OAuthFlowConfig } from './types';
import type { ProviderOAuthRef } from './config';

/** A token source used by provider-neutral model and service adapters. */
export interface BearerTokenProvider {
  getAccessToken(options?: { readonly force?: boolean | undefined }): Promise<string>;
}

export interface AuthProviderStatus {
  readonly providerName: string;
  readonly hasToken: boolean;
}

export interface AuthStatus {
  readonly providers: readonly AuthProviderStatus[];
}

export interface SpiderByteOAuthToolkitOptions {
  readonly identity?: SpiderByteHostIdentity | undefined;
  readonly homeDir?: string | undefined;
  readonly credentialsDir?: string | undefined;
  readonly storage?: TokenStorage | undefined;
  /** Optional external-provider OAuth flow. Open Core does not supply a hosted default. */
  readonly flowConfig?: OAuthFlowConfig | undefined;
  readonly now?: OAuthManagerOptions['now'];
  readonly sleep?: OAuthManagerOptions['sleep'];
  readonly deviceCodeTimeoutMs?: number | undefined;
  readonly refreshThreshold?: OAuthManagerOptions['refreshThreshold'];
  readonly onRefresh?: OAuthManagerOptions['onRefresh'];
}

export interface SpiderByteOAuthLoginOptions extends LoginOptions {
  readonly oauthRef?: ProviderOAuthRef | undefined;
  readonly oauthHost?: string | undefined;
  readonly flowConfig?: OAuthFlowConfig | undefined;
}

export interface SpiderByteOAuthTokenRef extends ProviderOAuthRef {}

export interface SpiderByteOAuthLoginResult {
  readonly providerName: string;
  readonly ok: true;
}

export interface SpiderByteOAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
}

/**
 * Provider-neutral OAuth token manager. It can read and refresh a token for an
 * explicitly configured external provider, but it has no SpiderByte account,
 * usage, billing, feedback, or entitlement endpoint.
 */
export class SpiderByteOAuthToolkit {
  private readonly homeDir: string;
  private readonly identity: SpiderByteHostIdentity | undefined;
  private readonly storage: TokenStorage;
  private readonly defaultFlowConfig: OAuthFlowConfig | undefined;
  private readonly managerOptions: Pick<
    OAuthManagerOptions,
    'now' | 'sleep' | 'deviceCodeTimeoutMs' | 'refreshThreshold' | 'onRefresh'
  >;
  private readonly managers = new Map<string, OAuthManager>();

  constructor(options: SpiderByteOAuthToolkitOptions) {
    this.identity = options.identity === undefined ? undefined : assertSpiderByteHostIdentity(options.identity);
    this.homeDir = options.homeDir ?? defaultSpiderByteHome();
    const credentialsDir = options.credentialsDir ?? join(this.homeDir, 'credentials');
    this.storage = options.storage ?? new FileTokenStorage(credentialsDir);
    this.defaultFlowConfig = options.flowConfig;
    this.managerOptions = {
      now: options.now,
      sleep: options.sleep,
      deviceCodeTimeoutMs: options.deviceCodeTimeoutMs,
      refreshThreshold: options.refreshThreshold,
      onRefresh: options.onRefresh,
    };
  }

  async status(providerName: string, oauthRef?: SpiderByteOAuthTokenRef): Promise<AuthStatus> {
    return {
      providers: [
        {
          providerName,
          hasToken: await this.managerFor(providerName, oauthRef).hasToken(),
        },
      ],
    };
  }

  async login(
    providerName: string,
    options: SpiderByteOAuthLoginOptions = {},
  ): Promise<SpiderByteOAuthLoginResult> {
    const manager = this.managerFor(providerName, options.oauthRef, options.oauthHost, options.flowConfig);
    const flow = options.flowConfig ?? this.defaultFlowConfig;
    if (flow === undefined && options.oauthHost === undefined && options.oauthRef?.oauthHost === undefined) {
      throw new OAuthError(
        `OAuth login for provider "${providerName}" requires an explicit provider flow configuration.`,
      );
    }
    await manager.login({ signal: options.signal, onDeviceCode: options.onDeviceCode });
    return { providerName, ok: true };
  }

  async logout(providerName: string, oauthRef?: SpiderByteOAuthTokenRef): Promise<SpiderByteOAuthLogoutResult> {
    await this.managerFor(providerName, oauthRef).logout();
    return { providerName, ok: true };
  }

  async ensureFresh(
    providerName: string,
    options: { readonly force?: boolean | undefined; readonly oauthRef?: SpiderByteOAuthTokenRef | undefined } = {},
  ): Promise<string> {
    const ref = options.oauthRef;
    if (ref?.oauthHost === undefined && this.defaultFlowConfig === undefined) {
      throw new OAuthError(`OAuth provider "${providerName}" has no configured OAuth host.`);
    }
    return this.managerFor(providerName, ref).ensureFresh(options);
  }

  async getCachedAccessToken(providerName: string, oauthRef?: SpiderByteOAuthTokenRef): Promise<string | undefined> {
    return this.managerFor(providerName, oauthRef).getCachedAccessToken();
  }

  tokenProvider(providerName: string, oauthRef?: SpiderByteOAuthTokenRef): BearerTokenProvider {
    return {
      getAccessToken: (options) => this.ensureFresh(providerName, { ...options, oauthRef }),
    };
  }

  managerFor(
    providerName: string,
    oauthRef?: SpiderByteOAuthTokenRef,
    oauthHost?: string,
    flowConfig?: OAuthFlowConfig,
  ): OAuthManager {
    const storageName = resolveOAuthTokenStorageName({
      providerName,
      oauthKey: oauthRef?.key,
    });
    const configured = flowConfig ?? this.defaultFlowConfig;
    const effectiveHost = oauthHost ?? oauthRef?.oauthHost ?? configured?.oauthHost ?? '';
    const config: OAuthFlowConfig = {
      name: storageName,
      oauthHost: effectiveHost,
      clientId: configured?.clientId ?? '',
    };
    const managerKey = `${storageName}\0${effectiveHost}`;
    const existing = this.managers.get(managerKey);
    if (existing !== undefined) return existing;

    const identity = this.identity;
    const manager = new OAuthManager({
      config,
      storage: this.storage,
      configDir: this.homeDir,
      deviceHeaders:
        identity === undefined
          ? undefined
          : () => createSpiderByteDefaultHeaders({ homeDir: this.homeDir, ...identity }),
      ...this.managerOptions,
    });
    this.managers.set(managerKey, manager);
    return manager;
  }
}

export function resolveOAuthTokenStorageName(input: {
  readonly providerName: string;
  readonly oauthKey?: string | undefined;
}): string {
  const key = input.oauthKey ?? `oauth/${input.providerName}`;
  if (key.startsWith('oauth/') && key.slice('oauth/'.length).length > 0) {
    return key.slice('oauth/'.length);
  }
  if (!key.includes('/') && !key.startsWith('.')) return key;
  throw new Error(`Invalid OAuth token key: "${key}".`);
}

function defaultSpiderByteHome(): string {
  const override = process.env['SPIDERBYTE_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.spiderbyte');
}
