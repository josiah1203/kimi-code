/**
 * `GlobalIdleValue<T>` — defers an executor until the first `value` access
 * (or the next browser idle callback / `setTimeout` fallback). Used by
 * `InstantiationService._createServiceInstance` to back
 * `supportsDelayedInstantiation: true` services: the Proxy returned to
 * callers triggers `idle.value` on first non-`onDid*` access, which runs
 * the real construction.
 *
 * Vendored from krow `packages/core/src/base/async.ts:57-97` (which is the
 * VSCode original). Node-safe: falls back to `setTimeout` when
 * `requestIdleCallback` is unavailable (the typical Node environment).
 *
 * Only `GlobalIdleValue` is exported — `runWhenGlobalIdle` is internal to
 * this module because the DI subsystem is the only consumer; if another
 * package later needs it, lift it then.
 */
/**
 * Lazy box around an executor `() => T`. The executor is scheduled to run on
 * the next idle tick, but reading `.value` BEFORE the idle tick fires
 * cancels the schedule and runs the executor synchronously — then caches
 * the result (or rethrows the captured error) on every subsequent access.
 *
 * `isInitialized` lets the Proxy distinguish "real instance exists" from
 * "still pending" so `onDid*`/`onWill*` event subscriptions can be parked
 * in an early-listener list and replayed on materialisation.
 */
export declare class GlobalIdleValue<T> {
    private readonly _executor;
    private readonly _handle;
    private _didRun;
    private _value?;
    private _error;
    constructor(executor: () => T);
    dispose(): void;
    get value(): T;
    get isInitialized(): boolean;
}
