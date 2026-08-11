import {
  SpiderByteOAuthToolkit,
  type BearerTokenProvider as OAuthBearerTokenProvider,
  type SpiderByteOAuthTokenRef,
} from '@spiderbyte/oauth';

import type { SpiderByteConfig } from '#/types';

/** Local/provider-neutral authentication status. Hosted identity is outside Open Core. */
export interface AuthStatus {
  readonly providerName: string;
  readonly loggedIn: false;
  readonly hasToken: boolean;
  readonly mode: 'local' | 'byok';
  /** Compatibility projection for hosts that render provider status lists. */
  readonly providers: readonly [{ readonly providerName: string; readonly hasToken: boolean }];
}

export interface SpiderByteAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
}

export interface SpiderByteAuthFacadeOptions {
  readonly homeDir: string;
  readonly configPath: string;
  readonly onConfigUpdated?: (config: SpiderByteConfig) => void;
}

export type BearerTokenProvider = OAuthBearerTokenProvider;

/**
 * Open Core auth facade. It deliberately does not contact a hosted identity,
 * billing, usage, or feedback service. Provider API keys and local OAuth
 * adapters are configured through the provider configuration surface.
 */
export class SpiderByteAuthFacade {
  private readonly toolkit: SpiderByteOAuthToolkit;

  constructor(private readonly options: SpiderByteAuthFacadeOptions) {
    this.toolkit = new SpiderByteOAuthToolkit({ homeDir: options.homeDir });
  }

  async status(providerName = 'local', oauthRef?: SpiderByteOAuthTokenRef): Promise<AuthStatus> {
    void this.options.configPath;
    const toolkitStatus = await this.toolkit.status(providerName, oauthRef);
    const hasToken = toolkitStatus.providers[0]?.hasToken === true;
    return {
      providerName,
      loggedIn: false,
      hasToken,
      mode: hasToken ? 'byok' : 'local',
      providers: [{ providerName, hasToken }],
    };
  }

  async logout(providerName = 'local'): Promise<SpiderByteAuthLogoutResult> {
    await this.toolkit.logout(providerName);
    return { providerName, ok: true };
  }

  getCachedAccessToken(providerName = 'local', oauthRef?: SpiderByteOAuthTokenRef): Promise<string | undefined> {
    return this.toolkit.getCachedAccessToken(providerName, oauthRef);
  }

  resolveOAuthTokenProvider(providerName: string, oauthRef?: SpiderByteOAuthTokenRef): BearerTokenProvider {
    return this.toolkit.tokenProvider(providerName, oauthRef);
  }
}
