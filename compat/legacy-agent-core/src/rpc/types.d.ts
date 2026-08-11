import type { RPCMethods } from './client';
type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};
type WithExtraPayload<T, U> = {
    [K in keyof T]: T[K] extends (payload: infer P) => infer R ? (payload: Prettify<P & U>) => R : never;
};
export type WithAgentId<T> = WithExtraPayload<T, {
    readonly agentId: string;
}>;
export type WithSessionId<T> = WithExtraPayload<T, {
    readonly sessionId: string;
}>;
export declare function proxyWithExtraPayload<T, U>(methods: RPCMethods<WithExtraPayload<T, U>>, extraPayload: U): RPCMethods<T>;
export {};
