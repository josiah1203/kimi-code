import {
  refreshProviderModels,
  type ProviderChange,
  type RefreshProviderOptions,
  type RefreshProviderScope,
  type RefreshResult,
  type RefreshProviderHost as OAuthRefreshProviderHost,
} from '@spiderbyte/oauth';
import type { SpiderByteConfigShape } from '@spiderbyte/oauth';
import type { SpiderByteConfig, SpiderByteConfigPatch } from '@spiderbyte/sdk';

/**
 * CLI-side host for provider-model refresh. Kept on the SDK's full config types
 * so existing TUI callers (and tests) don't change; the daemon uses the
 * OAuth package's provider-neutral config shape directly.
 */
export interface RefreshProviderHost {
  getConfig(): Promise<SpiderByteConfig>;
  removeProvider(providerId: string): Promise<SpiderByteConfig>;
  setConfig(patch: SpiderByteConfigPatch): Promise<SpiderByteConfig>;
  /** Product User-Agent sent on custom-registry (api.json) fetches. */
  readonly userAgent?: string;
}

export type { ProviderChange, RefreshProviderOptions, RefreshProviderScope, RefreshResult };

/**
 * Refresh remote model metadata for the configured providers. Thin adapter over
 * the shared `refreshProviderModels` orchestrator in `@spiderbyte/oauth`
 * (which is also what the daemon's scheduled/manual refresh uses).
 */
export async function refreshAllProviderModels(
  host: RefreshProviderHost,
  options: RefreshProviderOptions = {},
): Promise<RefreshResult> {
  const providerHost = {
    getConfig: () => host.getConfig() as unknown as Promise<SpiderByteConfigShape>,
    removeProvider: (providerId: string) => host.removeProvider(providerId),
    setConfig: (patch: SpiderByteConfigPatch) => host.setConfig(patch),
    userAgent: host.userAgent,
  };
  return refreshProviderModels(providerHost as unknown as OAuthRefreshProviderHost, options);
}
