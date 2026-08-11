import {
  applyCustomRegistryProvider,
  fetchCustomRegistry,
  removeCustomRegistryProvider,
  type CustomRegistrySource,
} from './custom-registry';
import type {
  ProviderConfigShape,
  ProviderOAuthRef,
  SpiderByteConfigShape,
} from './config';
import {
  applyOpenPlatformConfig,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
} from './open-platform';
import { isRecord } from './utils';

/** Host operations needed to refresh local/provider-neutral model metadata. */
export interface RefreshProviderHost {
  getConfig(): Promise<SpiderByteConfigShape>;
  removeProvider(providerId: string): Promise<SpiderByteConfigShape>;
  setConfig(patch: SpiderByteConfigShape): Promise<SpiderByteConfigShape>;
  /** Optional external-provider token resolver. Open Core never uses it for hosted services. */
  resolveOAuthToken?(providerName: string, oauthRef?: ProviderOAuthRef): Promise<string>;
  readonly userAgent?: string;
}

export interface ProviderChange {
  readonly providerId: string;
  readonly providerName: string;
  readonly added: number;
  readonly removed: number;
}

export interface RefreshResult {
  readonly changed: readonly ProviderChange[];
  readonly unchanged: readonly string[];
  readonly failed: ReadonlyArray<{ readonly provider: string; readonly reason: string }>;
}

/** Hosted OAuth refresh is intentionally not an Open Core operation. */
export type RefreshProviderScope = 'all';

export interface RefreshProviderOptions {
  readonly scope?: RefreshProviderScope;
  readonly providerId?: string;
}

function provider(config: SpiderByteConfigShape, id: string): ProviderConfigShape | undefined {
  return config.providers[id];
}

function sourceOf(config: SpiderByteConfigShape, id: string): CustomRegistrySource | undefined {
  const raw = provider(config, id)?.source;
  if (!isRecord(raw) || raw['kind'] !== 'apiJson') return undefined;
  const url = raw['url'];
  const apiKey = raw['apiKey'];
  if (typeof url !== 'string' || url.length === 0 || typeof apiKey !== 'string') return undefined;
  return { kind: 'apiJson', url, apiKey };
}

function aliasesFor(config: SpiderByteConfigShape, providerId: string): Set<string> {
  return new Set(
    Object.entries(config.models ?? {})
      .filter(([, model]) => model.provider === providerId)
      .map(([id]) => id),
  );
}

function modelIds(config: SpiderByteConfigShape, ids: ReadonlySet<string>): Set<string> {
  return new Set(
    [...ids]
      .map((id) => config.models?.[id]?.model)
      .filter((model): model is string => model !== undefined && model.length > 0),
  );
}

function snapshot(config: SpiderByteConfigShape, ids: ReadonlySet<string>): string {
  return JSON.stringify(
    [...ids]
      .map((id) => ({ id, model: config.models?.[id] }))
      .filter((entry) => entry.model !== undefined)
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  );
}

function computeChanges(oldIds: Set<string>, newIds: Set<string>): { added: number; removed: number } {
  let added = 0;
  for (const id of newIds) if (!oldIds.has(id)) added++;
  let removed = 0;
  for (const id of oldIds) if (!newIds.has(id)) removed++;
  return { added, removed };
}

function restoreDefault(config: SpiderByteConfigShape, previousDefault: string | undefined): void {
  if (previousDefault === undefined) return;
  if (config.models?.[previousDefault] === undefined) {
    if (config.defaultModel === previousDefault) config.defaultModel = undefined;
    return;
  }
  config.defaultModel = previousDefault;
}

async function refreshOpenPlatform(
  host: RefreshProviderHost,
  config: SpiderByteConfigShape,
  providerId: string,
): Promise<{ readonly config: SpiderByteConfigShape; readonly change?: ProviderChange }> {
  const current = provider(config, providerId);
  const platform = getOpenPlatformById(providerId);
  const apiKey = current?.apiKey;
  if (platform === undefined || typeof apiKey !== 'string' || apiKey.length === 0) {
    return { config };
  }
  const models = filterModelsByPrefix(await fetchOpenPlatformModels(platform, apiKey), platform);
  if (models.length === 0) return { config };
  const selectedModel = models[0];
  if (selectedModel === undefined) return { config };

  const next = structuredClone(config);
  const previousAliases = aliasesFor(config, providerId);
  const previousIds = modelIds(config, previousAliases);
  applyOpenPlatformConfig(next, {
    platform,
    models,
    selectedModel,
    thinking: false,
    apiKey,
  });
  restoreDefault(next, config.defaultModel);
  const nextAliases = aliasesFor(next, providerId);
  if (snapshot(config, previousAliases) === snapshot(next, nextAliases)) {
    return { config, change: undefined };
  }
  await host.removeProvider(providerId);
  const saved = await host.setConfig(next);
  const change = computeChanges(previousIds, modelIds(saved, aliasesFor(saved, providerId)));
  return {
    config: saved,
    change: { providerId, providerName: platform.name, ...change },
  };
}

async function refreshCustomProvider(
  host: RefreshProviderHost,
  config: SpiderByteConfigShape,
  providerId: string,
  source: CustomRegistrySource,
): Promise<{ readonly config: SpiderByteConfigShape; readonly change?: ProviderChange }> {
  const entries = await fetchCustomRegistry(source, { userAgent: host.userAgent });
  const entry = Object.values(entries).find((candidate) => candidate.id === providerId);
  const previousAliases = aliasesFor(config, providerId);
  const previousIds = modelIds(config, previousAliases);
  const next = structuredClone(config);
  if (entry === undefined) {
    removeCustomRegistryProvider(next, providerId);
  } else {
    applyCustomRegistryProvider(next, entry, source);
  }
  restoreDefault(next, config.defaultModel);
  const nextAliases = aliasesFor(next, providerId);
  const changed =
    snapshot(config, previousAliases) !== snapshot(next, nextAliases) ||
    JSON.stringify(config.providers[providerId] ?? null) !== JSON.stringify(next.providers[providerId] ?? null);
  if (!changed) return { config };
  await host.removeProvider(providerId);
  const saved = await host.setConfig(next);
  const change = computeChanges(previousIds, modelIds(saved, aliasesFor(saved, providerId)));
  return {
    config: saved,
    change: {
      providerId,
      providerName: entry?.name ?? providerId,
      ...change,
    },
  };
}

/** Refreshes BYOK open-platform and custom-registry metadata only. */
export async function refreshProviderModels(
  host: RefreshProviderHost,
  options: RefreshProviderOptions = {},
): Promise<RefreshResult> {
  let config = await host.getConfig();
  const changed: ProviderChange[] = [];
  const unchanged: string[] = [];
  const failed: Array<{ readonly provider: string; readonly reason: string }> = [];
  const ids = options.providerId === undefined ? Object.keys(config.providers) : [options.providerId];

  for (const providerId of ids) {
    const current = provider(config, providerId);
    if (current === undefined) continue;
    // OAuth-backed providers are external/optional. They are not refreshed by
    // Open Core and never cause a hosted request from this package.
    if (current.oauth !== undefined) {
      unchanged.push(providerId);
      continue;
    }
    if (isOpenPlatformId(providerId)) {
      try {
        const result = await refreshOpenPlatform(host, config, providerId);
        config = result.config;
        if (result.change === undefined) unchanged.push(providerId);
        else changed.push(result.change);
      } catch (error) {
        failed.push({ provider: providerId, reason: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    const source = sourceOf(config, providerId);
    if (source === undefined) continue;
    try {
      const result = await refreshCustomProvider(host, config, providerId, source);
      config = result.config;
      if (result.change === undefined) unchanged.push(providerId);
      else changed.push(result.change);
    } catch (error) {
      failed.push({ provider: providerId, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { changed, unchanged, failed };
}
