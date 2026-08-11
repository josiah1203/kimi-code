/**
 * Service descriptors: a `SyncDescriptor` packages a constructor + static
 * args for later instantiation by the container. Modelled after VSCode's
 * `SyncDescriptor`.
 */
/**
 * Wraps a constructor plus optional static arguments. The container picks up
 * a `SyncDescriptor` from the `ServiceCollection` (rather than an already-
 * built instance) and constructs it on first `get`.
 */
export declare class SyncDescriptor<T> {
    readonly staticArguments: ReadonlyArray<any>;
    readonly supportsDelayedInstantiation: boolean;
    readonly ctor: any;
    constructor(ctor: new (...args: any[]) => T, staticArguments?: ReadonlyArray<any>, supportsDelayedInstantiation?: boolean);
}
export interface SyncDescriptor0<T> {
    readonly ctor: new () => T;
}
