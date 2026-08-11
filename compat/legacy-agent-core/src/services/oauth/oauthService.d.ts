/**
 * `OAuthService` — implementation of `IOAuthService`.
 */
import { Disposable } from '../../di';
import type { OAuthFlowSnapshot, OAuthFlowStart, OAuthLoginCancelResponse, OAuthLogoutResponse } from '@spiderbyte/protocol';
import { type ServicesAuthFacade } from '../auth/managedAuth';
import { IEnvironmentService } from '../environment/environment';
import { IOAuthService } from './oauth';
export declare class OAuthService extends Disposable implements IOAuthService {
    private readonly env;
    readonly _serviceBrand: undefined;
    private readonly _authFacade;
    private readonly _flows;
    constructor(env: IEnvironmentService);
    /** @internal Test-only factory that injects a mock facade. */
    static _createForTest(env: IEnvironmentService, facade: ServicesAuthFacade): OAuthService;
    startLogin(providerName?: string): Promise<OAuthFlowStart>;
    getFlow(providerName?: string): OAuthFlowSnapshot | undefined;
    cancelLogin(providerName?: string): Promise<OAuthLoginCancelResponse>;
    logout(providerName?: string): Promise<OAuthLogoutResponse>;
    dispose(): void;
    private _handleSuccess;
    private _handleFailure;
    private _setTerminal;
    private _toSnapshot;
}
