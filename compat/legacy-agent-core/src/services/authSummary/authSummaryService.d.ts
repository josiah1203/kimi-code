/**
 * `AuthSummaryService` — implementation of `IAuthSummaryService`.
 */
import { Disposable } from '../../di';
import type { AuthSummary } from '@spiderbyte/protocol';
import { IEnvironmentService } from '../environment/environment';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IAuthSummaryService } from './authSummary';
export declare class AuthSummaryService extends Disposable implements IAuthSummaryService {
    private readonly env;
    private readonly core;
    readonly _serviceBrand: undefined;
    private readonly _authFacade;
    constructor(env: IEnvironmentService, core: ICoreProcessService);
    get(): Promise<AuthSummary>;
    ensureReady(modelOverride?: string): Promise<void>;
    dispose(): void;
    private _readConfig;
    private _hasCachedToken;
}
