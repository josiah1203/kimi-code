import type { ModelAlias, ProviderType } from './schema';
export declare function effectiveModelAlias(alias: ModelAlias, providerType?: ProviderType): ModelAlias;
export declare function effectiveModelAliases(models: Record<string, ModelAlias>): Record<string, ModelAlias>;
