/**
 * `auth` domain (cross-cutting) — provider-neutral web search seam.
 *
 * The Open Core implementation has no hosted search default. It exposes an
 * adapter seam so a local or explicitly configured provider can be supplied by
 * an embedding host without leaking that implementation into the package.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

import type { WebSearchProvider } from '#/agent/tools/web-search/web-search';

export type { WebSearchProvider, WebSearchResult } from '#/agent/tools/web-search/web-search';

export interface IWebSearchProviderService {
  readonly _serviceBrand: undefined;

  getWebSearchProvider(): WebSearchProvider | undefined;
  hasWebSearchProvider(): boolean;
}

export const IWebSearchProviderService: ServiceIdentifier<IWebSearchProviderService> =
  createDecorator<IWebSearchProviderService>('webSearchProviderService');
