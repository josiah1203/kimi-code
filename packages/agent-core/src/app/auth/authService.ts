/** Local/provider-neutral authentication services for SpiderByte Agent Core. */

import { SpiderByteOAuthToolkit, type BearerTokenProvider } from '@spiderbyte/oauth';

import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { ILogService } from '#/_base/log/log';
import { IModelService, type ModelRecord } from '#/kosong/model/model';
import {
  deriveProviderId,
  effectiveModelConfig,
  nonEmpty,
  resolveModelAuthMaterial,
} from '#/kosong/model/modelAuth';
import { IProviderService, type OAuthRef } from '#/kosong/provider/provider';

import {
  AuthModelNotResolvedError,
  AuthProvisioningRequiredError,
  AuthTokenMissingError,
  type AuthStatus,
  IAuthSummaryService,
  IOAuthService,
  IOAuthToolkit,
} from './auth';

export class OAuthService implements IOAuthService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IOAuthToolkit private readonly toolkit: IOAuthToolkit,
    @IProviderService private readonly providerService: IProviderService,
  ) {}

  async status(provider = 'local'): Promise<AuthStatus> {
    const oauthRef = this.providerService.get(provider)?.oauth;
    const token = await this.getCachedAccessToken(provider, oauthRef);
    return token === undefined ? { loggedIn: false } : { loggedIn: true, provider };
  }

  resolveTokenProvider(provider: string, oauthRef?: OAuthRef): BearerTokenProvider | undefined {
    if (oauthRef === undefined && this.providerService.get(provider)?.oauth === undefined) {
      return undefined;
    }
    return this.toolkit.tokenProvider(provider, oauthRef ?? this.providerService.get(provider)?.oauth);
  }

  getCachedAccessToken(provider: string, oauthRef?: OAuthRef): Promise<string | undefined> {
    return this.toolkit.getCachedAccessToken(
      provider,
      oauthRef ?? this.providerService.get(provider)?.oauth,
    );
  }
}

export class AuthSummaryService implements IAuthSummaryService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IProviderService private readonly providerService: IProviderService,
    @IModelService private readonly modelService: IModelService,
    @IConfigService private readonly config: IConfigService,
    @IOAuthService private readonly oauth: IOAuthService,
    @ILogService private readonly log: ILogService,
  ) {}

  async summarize(): Promise<readonly AuthStatus[]> {
    const providers = this.providerService.list();
    const statuses: AuthStatus[] = [];
    for (const [name, config] of Object.entries(providers)) {
      if (config.oauth === undefined) continue;
      try {
        statuses.push(await this.oauth.status(name));
      } catch (error) {
        this.log.warn('provider token status unavailable', {
          provider: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return statuses;
  }

  async ensureReady(modelOverride?: string): Promise<void> {
    await this.config.reload();
    const providers = this.providerService.list();
    const models = this.modelService.list();
    const modelId = modelOverride ?? this.modelService.getDefaultModel();
    const configured = modelId === undefined || modelId === '' ? undefined : models[modelId];
    if (Object.keys(providers).length === 0 && !isProviderlessModel(configured)) {
      throw new AuthProvisioningRequiredError();
    }
    if (modelId === undefined || modelId === '') throw new AuthModelNotResolvedError(undefined);
    if (configured === undefined) throw new AuthModelNotResolvedError(modelId);

    const model = effectiveModelConfig(configured);
    const providerId = model.providerId ?? model.provider;
    const provider = providerId === undefined ? undefined : this.providerService.get(providerId);
    if (providerId !== undefined && provider === undefined) {
      throw new AuthModelNotResolvedError(modelId, providerId);
    }
    const providerName = providerId ?? providerNameFromFlatModel(model);
    if (providerName === undefined) throw new AuthModelNotResolvedError(modelId);

    const auth = resolveModelAuthMaterial({ modelId, model, provider, providerName });
    if (auth.apiKey !== undefined) return;
    if (auth.oauth !== undefined) {
      const providerKey = auth.oauthProviderKey ?? providerName;
      const token = await this.oauth.getCachedAccessToken(providerKey, auth.oauth);
      if (nonEmpty(token) !== undefined) return;
      throw new AuthTokenMissingError(providerKey);
    }
    throw new AuthTokenMissingError(providerName);
  }
}

function isProviderlessModel(model: ModelRecord | undefined): boolean {
  if (model === undefined) return false;
  const effective = effectiveModelConfig(model);
  return (
    effective.providerId === undefined &&
    effective.provider === undefined &&
    providerNameFromFlatModel(effective) !== undefined
  );
}

function providerNameFromFlatModel(model: ModelRecord): string | undefined {
  const baseUrl = nonEmpty(model.baseUrl);
  return baseUrl === undefined ? undefined : deriveProviderId(baseUrl);
}

class OAuthToolkitService extends SpiderByteOAuthToolkit implements IOAuthToolkit {
  declare readonly _serviceBrand: undefined;

  constructor(@IBootstrapService bootstrap: IBootstrapService) {
    super({ homeDir: bootstrap.homeDir, identity: bootstrap.clientIdentity });
  }
}

registerScopedService(LifecycleScope.App, IOAuthService, OAuthService, ScopeActivation.OnScopeCreated, 'auth');
registerScopedService(LifecycleScope.App, IOAuthToolkit, OAuthToolkitService, ScopeActivation.OnScopeCreated, 'auth');
registerScopedService(LifecycleScope.App, IAuthSummaryService, AuthSummaryService, ScopeActivation.OnScopeCreated, 'auth');
