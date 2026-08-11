import type { ConfigResponse, PatchConfigRequest } from '@spiderbyte/protocol';
export interface IConfigService {
    readonly _serviceBrand: undefined;
    get(): Promise<ConfigResponse>;
    set(patch: PatchConfigRequest): Promise<ConfigResponse>;
}
export declare const IConfigService: import("../..").ServiceIdentifier<IConfigService>;
