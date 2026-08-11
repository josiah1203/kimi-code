/**
 * `ServiceCollection` is the unordered map of service-id → (descriptor | instance)
 * used to seed an `InstantiationService`. It's a thin wrapper over `Map` whose
 * value type is `SyncDescriptor<T> | T` — the container decides which based on
 * `instanceof SyncDescriptor`.
 */
import type { SyncDescriptor } from './descriptors';
import type { ServiceIdentifier } from './instantiation';
export declare class ServiceCollection {
    private readonly _entries;
    constructor(...entries: ReadonlyArray<readonly [ServiceIdentifier<any>, unknown]>);
    /**
     * Set an entry. Returns the previous value (or `undefined` if the id was
     * not previously set).
     */
    set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): T | SyncDescriptor<T> | undefined;
    has(id: ServiceIdentifier<any>): boolean;
    get<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> | undefined;
    /** Iterate all entries. Order is insertion-order (Map semantics). */
    forEach(callback: (id: ServiceIdentifier<any>, value: unknown) => void): void;
}
