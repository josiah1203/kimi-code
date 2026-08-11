import type { CoreAPI as NativeCoreAPI } from '@spiderbyte/agent-core/agent/rpc/core-api';

/** Local RPC typing used by the in-process SDK facade. */
export type RPCMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Promise<Awaited<Return>>
    : never;
} & Record<string, (...args: any[]) => Promise<any>>;

/**
 * The v2 client implements this contract directly. Keeping the base transport
 * shape structural avoids importing the retired v1 RPC contract into the
 * canonical SDK.
 */
export type CoreAPI = NativeCoreAPI & Record<string, (...args: any[]) => any>;

export interface SDKAPI {
  emitEvent: (event: unknown) => void;
  requestApproval: (request: unknown) => Promise<unknown>;
  requestQuestion: (request: unknown) => Promise<unknown>;
  toolCall: (request: unknown) => Promise<unknown>;
}

export interface BeginGlobalMcpServerAuthResult {
  readonly status: 'already-authorized' | 'authorization-required';
  readonly flowId?: string;
  readonly authorizationUrl?: string;
}
