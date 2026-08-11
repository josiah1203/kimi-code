/**
 * Local/provider-neutral authentication ports.
 *
 * Open Core deliberately has no SpiderByte account login, hosted identity,
 * usage, billing, feedback, entitlement, or managed-model contract. These
 * ports only let local runtime code resolve an explicitly configured external
 * provider token when one is present.
 */

import type { BearerTokenProvider, ProviderOAuthRef } from '@spiderbyte/oauth';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Error2 } from '#/_base/errors/errors';

import type { OAuthRef } from '#/kosong/provider/provider';
import { AuthErrors } from './errors';

export interface AuthStatus {
  readonly loggedIn: boolean;
  readonly provider?: string;
}

export interface IOAuthService {
  readonly _serviceBrand: undefined;

  status(provider?: string): Promise<AuthStatus>;
  resolveTokenProvider(provider: string, oauthRef?: OAuthRef): BearerTokenProvider | undefined;
  getCachedAccessToken(provider: string, oauthRef?: OAuthRef): Promise<string | undefined>;
}

export const IOAuthService: ServiceIdentifier<IOAuthService> =
  createDecorator<IOAuthService>('oauthService');

export interface IOAuthToolkit {
  readonly _serviceBrand: undefined;

  getCachedAccessToken(providerName: string, oauthRef?: ProviderOAuthRef): Promise<string | undefined>;
  tokenProvider(providerName: string, oauthRef?: ProviderOAuthRef): BearerTokenProvider;
}

export const IOAuthToolkit: ServiceIdentifier<IOAuthToolkit> =
  createDecorator<IOAuthToolkit>('oauthToolkit');

export interface IAuthSummaryService {
  readonly _serviceBrand: undefined;

  summarize(): Promise<readonly AuthStatus[]>;
  ensureReady(modelOverride?: string): Promise<void>;
}

export const IAuthSummaryService: ServiceIdentifier<IAuthSummaryService> =
  createDecorator<IAuthSummaryService>('authSummaryService');

export class AuthProvisioningRequiredError extends Error2 {
  constructor() {
    super(
      AuthErrors.codes.AUTH_PROVISIONING_REQUIRED,
      'no provider configured; configure a local endpoint or BYOK provider',
      { name: 'AuthProvisioningRequiredError' },
    );
  }
}

export class AuthTokenMissingError extends Error2 {
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      AuthErrors.codes.AUTH_TOKEN_MISSING,
      `provider ${providerId} has no credential configured`,
      { details: { provider_id: providerId }, name: 'AuthTokenMissingError' },
    );
    this.providerId = providerId;
  }
}

export class AuthModelNotResolvedError extends Error2 {
  readonly modelId: string | undefined;
  readonly providerId: string | undefined;

  constructor(modelId: string | undefined, providerId?: string) {
    const details: Record<string, unknown> = {};
    if (modelId !== undefined) details['model_id'] = modelId;
    if (providerId !== undefined) details['provider_id'] = providerId;
    super(
      AuthErrors.codes.AUTH_MODEL_NOT_RESOLVED,
      modelId === undefined
        ? 'no default model configured'
        : `model ${modelId} does not resolve to a configured provider`,
      {
        details: Object.keys(details).length === 0 ? undefined : details,
        name: 'AuthModelNotResolvedError',
      },
    );
    this.modelId = modelId;
    this.providerId = providerId;
  }
}
