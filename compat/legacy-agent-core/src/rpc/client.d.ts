import type { PromisableMethods, Promisify } from '#/utils/types';
import type { CoreAPI } from './core-api';
import type { SDKAPI } from './sdk-api';
export interface RPCCallOptions {
    signal?: AbortSignal;
}
export type RPCMethods<T> = {
    [K in keyof T]: T[K] extends (payload: infer Payload) => infer Return ? (payload: Payload, options?: RPCCallOptions) => Promisify<Return> : never;
};
export type RPCClient<Self extends Record<string, any>, Other extends Record<string, any>> = (self: PromisableMethods<Self>) => Promise<RPCMethods<Other>>;
export declare function createRPC<Left extends Record<string, any>, Right extends Record<string, any>>(): [
    RPCClient<Left, Right>,
    RPCClient<Right, Left>
];
export type CoreRPCClient = RPCClient<CoreAPI, SDKAPI>;
export type SDKRPCClient = RPCClient<SDKAPI, CoreAPI>;
export type CoreRPC = RPCMethods<CoreAPI>;
