import type { Logger } from '#/logging/types';
import type { ProviderConfig as KosongProviderConfig, ModelCapability, ProviderRequestAuth } from '@spiderbyte/kosong';
import { type KimiConfig, type ModelAlias, type OAuthRef, type ProviderType } from '../config';
export interface BearerTokenProvider {
    getAccessToken(options?: {
        readonly force?: boolean;
    }): Promise<string>;
}
export type OAuthTokenProviderResolver = (providerName: string, oauthRef?: OAuthRef) => BearerTokenProvider | undefined;
export interface ResolvedRuntimeProvider {
    readonly providerName: string;
    readonly provider: KosongProviderConfig;
    readonly modelCapabilities: ModelCapability;
    /** Declared 'always_thinking' capability — the model cannot disable thinking. */
    readonly alwaysThinking?: boolean;
    readonly supportEfforts?: readonly string[];
    readonly defaultEffort?: string;
    readonly maxOutputSize?: number;
    /** Configured provider wire type (`provider.type`), before any model-level protocol override. */
    readonly type: ProviderType;
    /** Model-level protocol override (`alias.protocol`); when set, takes precedence over `type` for transport selection. */
    readonly protocol: ModelAlias['protocol'];
}
interface ProviderManagerOptions {
    readonly config: KimiConfig | (() => KimiConfig);
    readonly kimiRequestHeaders?: Record<string, string>;
    readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
    readonly promptCacheKey?: string;
}
type AuthorizedRequest = <T>(request: (auth: ProviderRequestAuth) => Promise<T>) => Promise<T>;
export interface ModelProvider {
    readonly defaultModel?: string;
    resolveProviderConfig(model: string): ResolvedRuntimeProvider;
    resolveAuth?(model: string, options?: {
        readonly log?: Logger;
    }): AuthorizedRequest | undefined;
}
export declare class SingleModelProvider implements ModelProvider {
    private readonly providerConfig;
    private readonly modelCapabilities;
    constructor(providerConfig: KosongProviderConfig, modelCapabilities?: ModelCapability);
    get defaultModel(): string;
    resolveProviderConfig(model: string): ResolvedRuntimeProvider;
}
export declare class ProviderManager implements ModelProvider {
    private readonly options;
    constructor(options: ProviderManagerOptions);
    private get config();
    resolveProviderConfig(model: string): ResolvedRuntimeProvider;
    resolveAuth(model: string, options?: {
        readonly log?: Logger;
    }): AuthorizedRequest | undefined;
}
export {};
