import { type KimiConfig, type ModelAlias, type ProviderConfig, type ProviderType } from '../../config';
import type { ModelCatalogItem, ProviderCatalogItem, RefreshOAuthProviderModelsResponse, RefreshProviderModelsResponse, SetDefaultModelResponse } from '@spiderbyte/protocol';
export type RefreshProviderModelsScope = 'all' | 'oauth';
export interface RefreshProviderModelsOptions {
    readonly scope?: RefreshProviderModelsScope;
    /** Refresh only this provider id. When set, `scope` is ignored. */
    readonly providerId?: string;
}
export interface IModelCatalogService {
    readonly _serviceBrand: undefined;
    listModels(): Promise<readonly ModelCatalogItem[]>;
    listProviders(): Promise<readonly ProviderCatalogItem[]>;
    getProvider(providerId: string): Promise<ProviderCatalogItem>;
    setDefaultModel(modelId: string): Promise<SetDefaultModelResponse>;
    refreshOAuthProviderModels(): Promise<RefreshOAuthProviderModelsResponse>;
    refreshProviderModels(options?: RefreshProviderModelsOptions): Promise<RefreshProviderModelsResponse>;
}
export declare const IModelCatalogService: import("../..").ServiceIdentifier<IModelCatalogService>;
export declare class ProviderNotFoundError extends Error {
    readonly providerId: string;
    constructor(providerId: string);
}
export declare class ModelNotFoundError extends Error {
    readonly modelId: string;
    constructor(modelId: string);
}
export declare function toProtocolModel(modelId: string, alias: ModelAlias, providerType?: ProviderType): ModelCatalogItem;
export interface ProviderCredentialState {
    readonly hasApiKey: boolean;
    readonly hasOAuthToken: boolean;
}
export declare function toProtocolProvider(providerId: string, provider: ProviderConfig, config: KimiConfig, credential: ProviderCredentialState): ProviderCatalogItem;
export declare function modelIdsForProvider(config: KimiConfig, providerId: string): string[];
