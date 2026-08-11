/**
 * `auth` domain (cross-cutting) — `IWebSearchProviderService` implementation.
 *
 * The Open Core runtime deliberately does not ship a hosted search backend.
 * Hosts that provide a local or provider-specific search adapter can bind
 * `IWebSearchProviderService` at App scope.
 * Tests and hosts that need a custom backend bind `IWebSearchProviderService`
 * directly. Bound at App scope.
 *
 * Default headers split by who chose the endpoint: a `[services]` entry names
 * its own, so that path sends `agentIdentity`'s frozen `requestHeaders` — the
 * host header set with the `User-Agent` product token rewritten to the
 * configured identity — while the managed OAuth path sends the host's own
 * headers (`IBootstrapService.args.requestHeaders`) verbatim, being the
 * endpoint the session authenticated against.
 */

import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import type { WebSearchProvider } from '#/agent/tools/web-search/web-search';
import { IWebSearchProviderService } from './webSearch';

export class WebSearchProviderService implements IWebSearchProviderService {
  declare readonly _serviceBrand: undefined;

  constructor() {}

  getWebSearchProvider(): WebSearchProvider | undefined {
    return undefined;
  }

  hasWebSearchProvider(): boolean {
    return false;
  }
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

registerScopedService(
  LifecycleScope.App,
  IWebSearchProviderService,
  WebSearchProviderService,
  ScopeActivation.OnScopeCreated,
  'auth',
);
