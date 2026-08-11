/**
 * `web` domain — `IWebFetchService` implementation.
 *
 * Yields the local `UrlFetcher` used by the `FetchURL` tool. Hosted fetch
 * adapters are intentionally outside the Open Core package; a host may bind
 * its own `IWebFetchService` implementation at the composition boundary.
 * Bound at App scope.
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
import { LocalFetchURLProvider } from './providers/local-fetch-url';
import type { UrlFetcher } from './tools/fetch-url-types';
import { IWebFetchService } from './web';

export class WebFetchService implements IWebFetchService {
  declare readonly _serviceBrand: undefined;
  private readonly localFetcher: UrlFetcher;

  constructor() {
    this.localFetcher = new LocalFetchURLProvider();
  }

  getUrlFetcher(): UrlFetcher {
    return this.localFetcher;
  }
}

registerScopedService(
  LifecycleScope.App,
  IWebFetchService,
  WebFetchService,
  ScopeActivation.OnScopeCreated,
  'web',
);
