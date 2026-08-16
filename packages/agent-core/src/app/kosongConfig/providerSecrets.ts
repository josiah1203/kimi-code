/**
 * Provider/model credential normalization at the config boundary.
 *
 * Persisted config contains only `secretRef`; `apiKey` is accepted here solely
 * as a legacy migration input or a transient environment/runtime overlay. The
 * encrypted store is the only durable home for raw provider credentials.
 */

import {
  providerSecretRefSchema,
  type ProviderSecretRef,
} from '@spiderbyte/protocol';

import { deepMerge } from '#/app/config/configPure';
import type { ModelRecord, ModelsSection } from '#/kosong/model/model';
import type { ProviderConfig, ProvidersSection } from '#/kosong/provider/provider';

import type { IPlatformSecretStore } from '../secrets/platformSecretStore';

export interface NormalizedProviderSecrets {
  readonly providers: ProvidersSection;
  readonly models: ModelsSection;
  readonly changed: boolean;
}

/**
 * Normalizes a public config patch before it reaches the persistence layer.
 * Config patches are deep-merged by `IConfigService`; doing the same merge
 * here lets us migrate a legacy raw key while preserving all untouched
 * provider/model fields and the existing opaque reference.
 */
export async function normalizeProviderModelConfigPatch(
  currentProviders: ProvidersSection,
  currentModels: ModelsSection,
  patch: { readonly providers?: unknown; readonly models?: unknown },
  store: IPlatformSecretStore,
): Promise<{ readonly providers?: unknown; readonly models?: unknown }> {
  const providers =
    patch.providers === undefined
      ? undefined
      : deepMerge(currentProviders, patch.providers) as ProvidersSection;
  const models =
    patch.models === undefined
      ? undefined
      : deepMerge(currentModels, patch.models) as ModelsSection;
  const normalized = await migrateProviderSecrets(
    isRecord(providers) ? providers as ProvidersSection : {},
    isRecord(models) ? models as ModelsSection : {},
    store,
  );
  return {
    providers:
      providers === undefined
        ? undefined
        : isRecord(providers)
          ? normalized.providers
          : providers,
    models:
      models === undefined
        ? undefined
        : isRecord(models)
          ? normalized.models
          : models,
  };
}

/**
 * Converts legacy persisted `apiKey` fields (including custom-registry source
 * keys) into encrypted references. This function must be called with the
 * user-layer config, never with an env-overlaid effective view.
 */
export async function migrateProviderSecrets(
  providers: ProvidersSection,
  models: ModelsSection,
  store: IPlatformSecretStore,
): Promise<NormalizedProviderSecrets> {
  await store.ready;
  let changed = false;
  const referenceCache = new Map<string, ProviderSecretRef>();

  const nextProviders: ProvidersSection = {};
  for (const [id, provider] of Object.entries(providers)) {
    const result = await migrateProviderRecord(provider, store, referenceCache);
    nextProviders[id] = result.value;
    changed ||= result.changed;
  }

  const nextModels: ModelsSection = {};
  for (const [id, model] of Object.entries(models)) {
    const result = await migrateModelRecord(model, store, referenceCache);
    nextModels[id] = result.value;
    changed ||= result.changed;
  }

  return { providers: nextProviders, models: nextModels, changed };
}

/** Hydrates raw credentials into runtime records without changing references. */
export async function hydrateProviderSecrets(
  providers: ProvidersSection,
  models: ModelsSection,
  store: IPlatformSecretStore,
): Promise<{ readonly providers: ProvidersSection; readonly models: ModelsSection }> {
  await store.ready;
  const nextProviders: ProvidersSection = {};
  for (const [id, provider] of Object.entries(providers)) {
    nextProviders[id] = await hydrateRecord(provider, store);
  }

  const nextModels: ModelsSection = {};
  for (const [id, model] of Object.entries(models)) {
    nextModels[id] = await hydrateRecord(model, store);
  }
  return { providers: nextProviders, models: nextModels };
}

/** Stores a transient API key and returns the reference safe to persist. */
export async function secretRefForInput(
  store: IPlatformSecretStore,
  apiKey: string | undefined,
  existing?: ProviderSecretRef,
): Promise<ProviderSecretRef | undefined> {
  await store.ready;
  if (existing !== undefined) providerSecretRefSchema.parse(existing);
  if (apiKey === undefined) return existing;
  if (apiKey.length === 0) {
    if (existing !== undefined) await store.remove(existing);
    return undefined;
  }
  if (existing !== undefined) {
    await store.set(existing, apiKey);
    return existing;
  }
  return store.put(apiKey);
}

interface MigratedRecord<T extends ProviderConfig | ModelRecord> {
  readonly value: T;
  readonly changed: boolean;
}

async function migrateProviderRecord(
  record: ProviderConfig,
  store: IPlatformSecretStore,
  referenceCache: Map<string, ProviderSecretRef>,
): Promise<MigratedRecord<ProviderConfig>> {
  const result = await migrateRecord(record, store, referenceCache);
  const sourceResult = await migrateSource(record.source, store, referenceCache);
  const value: ProviderConfig = { ...(result.value as ProviderConfig) };
  let changed = result.changed;
  const envResult = await migrateProviderEnvCredential(value, store, referenceCache);
  changed ||= envResult.changed;
  if (sourceResult.value !== undefined) {
    value.source = sourceResult.value;
    if (value.secretRef === undefined) {
      const sourceSecretRef = readSecretRef(sourceResult.value['secretRef']);
      if (sourceSecretRef !== undefined) {
        value.secretRef = sourceSecretRef;
        changed = true;
      }
    }
  }
  else if (Object.hasOwn(value, 'source')) value.source = undefined;
  return { value, changed: changed || sourceResult.changed };
}

async function migrateModelRecord(
  record: ModelRecord,
  store: IPlatformSecretStore,
  referenceCache: Map<string, ProviderSecretRef>,
): Promise<MigratedRecord<ModelRecord>> {
  return migrateRecord(record, store, referenceCache);
}

async function migrateRecord<T extends ProviderConfig | ModelRecord>(
  record: T,
  store: IPlatformSecretStore,
  referenceCache: Map<string, ProviderSecretRef>,
): Promise<MigratedRecord<T>> {
  const value = { ...record } as T;
  let changed = false;
  if (Object.hasOwn(record, 'apiKey')) {
    const apiKey = record.apiKey;
    if (apiKey === undefined) {
      // `apiKey: undefined` is how runtime write paths explicitly remove a
      // stale raw field. It must not clear an otherwise valid reference.
    } else if (typeof apiKey !== 'string') {
      // Leave malformed input untouched so the owning config schema rejects
      // it; normalization must never store arbitrary values as secrets.
      return { value, changed: false };
    } else if (apiKey.length === 0) {
      if (value.secretRef !== undefined) {
        await store.remove(value.secretRef);
        value.secretRef = undefined;
      }
    } else {
      value.secretRef = await storeSecret(store, apiKey, value.secretRef, referenceCache);
    }
    value.apiKey = undefined;
    // Even an explicitly undefined legacy field must be removed from the
    // persisted representation. Keeping this true also lets the TOML writer
    // delete a stale api_key from a hand-edited file.
    changed = true;
  }
  return { value, changed };
}

async function migrateSource(
  source: Record<string, unknown> | undefined,
  store: IPlatformSecretStore,
  referenceCache: Map<string, ProviderSecretRef>,
): Promise<{ readonly value: Record<string, unknown> | undefined; readonly changed: boolean }> {
  if (source === undefined || !isRecord(source)) return { value: source, changed: false };
  if (!Object.hasOwn(source, 'apiKey')) return { value: source, changed: false };

  const next = { ...source };
  const apiKey = next['apiKey'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    next['secretRef'] = await storeSecret(
      store,
      apiKey,
      readSecretRef(next['secretRef']),
      referenceCache,
    );
  } else if (apiKey !== undefined && typeof apiKey === 'string') {
    const existing = readSecretRef(next['secretRef']);
    if (existing !== undefined) await store.remove(existing);
    next['secretRef'] = undefined;
  } else if (apiKey !== undefined) {
    // Preserve malformed source input for the owning config schema to reject.
    return { value: source, changed: false };
  }
  next['apiKey'] = undefined;
  return { value: next, changed: true };
}

async function hydrateRecord<T extends ProviderConfig | ModelRecord>(
  record: T,
  store: IPlatformSecretStore,
): Promise<T> {
  if (record.apiKey !== undefined || record.secretRef === undefined) return { ...record } as T;
  const secret = await store.get(record.secretRef);
  return secret === undefined ? { ...record } as T : { ...record, apiKey: secret } as T;
}

async function storeSecret(
  store: IPlatformSecretStore,
  secret: string,
  existing: ProviderSecretRef | undefined,
  referenceCache: Map<string, ProviderSecretRef>,
): Promise<ProviderSecretRef> {
  if (existing !== undefined) {
    providerSecretRefSchema.parse(existing);
    await store.set(existing, secret);
    return existing;
  }
  const cached = referenceCache.get(secret);
  if (cached !== undefined) return cached;
  const reference = await store.put(secret);
  referenceCache.set(secret, reference);
  return reference;
}

/**
 * Legacy provider records could persist a vendor API key under `[providers.x.env]`.
 * Move only the declared credential slot for known provider types; endpoint
 * settings and unknown extension keys remain intact.
 */
async function migrateProviderEnvCredential(
  provider: ProviderConfig,
  store: IPlatformSecretStore,
  referenceCache: Map<string, ProviderSecretRef>,
): Promise<{ readonly changed: boolean }> {
  const env = provider.env;
  if (env === undefined || provider.type === undefined) return { changed: false };
  const key = providerCredentialEnvNames(provider.type).find((name) => {
    const value = env[name];
    return typeof value === 'string' && value.length > 0;
  });
  if (key === undefined) return { changed: false };

  const nextEnv = { ...env };
  delete nextEnv[key];
  provider.env = Object.keys(nextEnv).length === 0 ? undefined : nextEnv;
  if (provider.secretRef === undefined) {
    provider.secretRef = await storeSecret(store, env[key] as string, undefined, referenceCache);
  }
  return { changed: true };
}

function providerCredentialEnvNames(providerType: string): readonly string[] {
  switch (providerType) {
    case 'anthropic':
      return ['ANTHROPIC_API_KEY'];
    case 'openai':
    case 'openai_responses':
      return ['OPENAI_API_KEY'];
    case 'openrouter':
      return ['OPENROUTER_API_KEY'];
    case 'google-genai':
    case 'vertexai':
      return ['VERTEXAI_API_KEY', 'GOOGLE_API_KEY'];
    case 'kimi':
      return ['SPIDERBYTE_API_KEY'];
    default:
      return [];
  }
}

function readSecretRef(value: unknown): ProviderSecretRef | undefined {
  if (value === undefined) return undefined;
  return providerSecretRefSchema.parse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
