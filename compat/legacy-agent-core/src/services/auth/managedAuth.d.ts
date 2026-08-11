import type { OAuthRef } from '../../config';
import type { OAuthTokenProviderResolver } from '../../session/provider-manager';
import { type KimiHostIdentity, type KimiOAuthLoginOptions } from '@spiderbyte/oauth';
import type { IEnvironmentService } from '../environment/environment';
type ServicesAuthLoginOptions = Omit<KimiOAuthLoginOptions, 'provisionConfig'>;
interface ServicesAuthLoginResult {
    readonly providerName: string;
    readonly ok: true;
    readonly defaultModel: string;
    readonly defaultThinking: boolean;
    readonly configPath?: string | undefined;
}
interface ServicesAuthLogoutResult {
    readonly providerName: string;
    readonly ok: true;
}
export interface ServicesAuthFacade {
    login(providerName?: string | undefined, options?: ServicesAuthLoginOptions): Promise<ServicesAuthLoginResult>;
    logout(providerName?: string | undefined): Promise<ServicesAuthLogoutResult>;
    getCachedAccessToken(providerName?: string, oauthRef?: OAuthRef | undefined): Promise<string | undefined>;
    readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver;
}
export declare function createManagedAuthFacade(env: Pick<IEnvironmentService, 'homeDir' | 'configPath'>, identity?: KimiHostIdentity): ServicesAuthFacade;
export {};
