/**
 * `authSummary` domain — `IAuthSummaryService` implementation.
 *
 * Stateless App-scope projector over the configured providers and model
 * registry. The hosted-account compatibility field is always null in Open
 * Core.
 */

import type { AuthSummary } from './authSummary';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IModelService } from '#/kosong/model/model';
import { IProviderService } from '#/kosong/provider/provider';

import { IAuthReadinessService } from './authSummary';

export class AuthReadinessService implements IAuthReadinessService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IProviderService private readonly providerService: IProviderService,
    @IModelService private readonly modelService: IModelService,
  ) {}

  async get(): Promise<AuthSummary> {
    await this.modelService.ready;

    const providers = this.providerService.list();
    const providers_count = Object.keys(providers).length;
    const default_model = nonEmpty(this.modelService.getDefaultModel());

    return {
      ready: providers_count >= 1 && default_model !== null,
      providers_count,
      default_model,
      managed_provider: null,
    };
  }
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

registerScopedService(
  LifecycleScope.App,
  IAuthReadinessService,
  AuthReadinessService,
  ScopeActivation.OnScopeCreated,
  'authSummary',
);
