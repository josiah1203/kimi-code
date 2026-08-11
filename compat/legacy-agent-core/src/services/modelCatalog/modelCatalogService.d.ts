import { Disposable } from '../../di';
import type { ModelCatalogItem, ProviderCatalogItem, RefreshOAuthProviderModelsResponse, RefreshProviderModelsResponse, SetDefaultModelResponse } from '@spiderbyte/protocol';
import { type ServicesAuthFacade } from '../auth/managedAuth';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';
import { IModelCatalogService, type RefreshProviderModelsOptions } from './modelCatalog';
export declare class ModelCatalogService extends Disposable implements IModelCatalogService {
    private readonly core;
    private readonly eventService;
    readonly _serviceBrand: undefined;
    private _authFacade;
    /** Serializes refresh runs so a scheduled refresh and a manual one (or two
     *  manual ones with different options) never race on writing config.toml. */
    private _refreshChain;
    constructor(env: IEnvironmentService, core: ICoreProcessService, eventService: IEventService);
    static _createForTest(env: IEnvironmentService, core: ICoreProcessService, authFacade: ServicesAuthFacade, eventService?: IEventService): ModelCatalogService;
    listModels(): Promise<readonly ModelCatalogItem[]>;
    listProviders(): Promise<readonly ProviderCatalogItem[]>;
    getProvider(providerId: string): Promise<ProviderCatalogItem>;
    setDefaultModel(modelId: string): Promise<SetDefaultModelResponse>;
    private _providerTypeOf;
    refreshOAuthProviderModels(): Promise<RefreshOAuthProviderModelsResponse>;
    refreshProviderModels(options?: RefreshProviderModelsOptions): Promise<RefreshProviderModelsResponse>;
    private _doRefreshProviderModels;
    private _buildRefreshHost;
    private _resolveOAuthToken;
    private _readConfig;
    private _provider;
    private _hasCachedToken;
}
