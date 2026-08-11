export interface IDisposableTracker {
    trackDisposable(disposable: IDisposable): void;
    setParent(child: IDisposable, parent: IDisposable | null): void;
    markAsDisposed(disposable: IDisposable): void;
    markAsSingleton(disposable: IDisposable): void;
}
export declare class DisposableTracker implements IDisposableTracker {
    private static idx;
    private readonly livingDisposables;
    private getDisposableData;
    trackDisposable(d: IDisposable): void;
    setParent(child: IDisposable, parent: IDisposable | null): void;
    markAsDisposed(x: IDisposable): void;
    markAsSingleton(d: IDisposable): void;
    private getRootParent;
    getTrackedDisposables(): IDisposable[];
}
export declare function setDisposableTracker(tracker: IDisposableTracker | null): void;
export declare function trackDisposable<T extends IDisposable>(x: T): T;
export declare function markAsDisposed(disposable: IDisposable): void;
export declare function markAsSingleton<T extends IDisposable>(singleton: T): T;
export interface IDisposable {
    dispose(): void;
}
export declare function isDisposable<E>(thing: E): thing is E & IDisposable;
export declare function dispose<T extends IDisposable>(disposable: T): T;
export declare function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export declare function dispose<T extends IDisposable, A extends Iterable<T> = Iterable<T>>(disposables: A): A;
export declare function dispose<T extends IDisposable>(disposables: Array<T>): Array<T>;
export declare function dispose<T extends IDisposable>(disposables: ReadonlyArray<T>): ReadonlyArray<T>;
export declare function disposeIfDisposable<T extends IDisposable | object>(disposables: Array<T>): Array<T>;
export declare function toDisposable(fn: () => void): IDisposable;
export declare function combinedDisposable(...disposables: IDisposable[]): IDisposable;
export declare class DisposableStore implements IDisposable {
    private readonly _toDispose;
    private _isDisposed;
    constructor();
    add<T extends IDisposable>(d: T): T;
    delete<T extends IDisposable>(d: T): void;
    deleteAndLeak<T extends IDisposable>(d: T): void;
    clear(): void;
    dispose(): void;
    get isDisposed(): boolean;
    assertNotDisposed(): void;
}
export declare abstract class Disposable implements IDisposable {
    protected readonly _store: DisposableStore;
    constructor();
    protected _register<T extends IDisposable>(d: T): T;
    dispose(): void;
}
export declare namespace Disposable {
    const None: IDisposable;
}
export declare class MutableDisposable<T extends IDisposable> implements IDisposable {
    private _value;
    private _isDisposed;
    constructor();
    get value(): T | undefined;
    set value(value: T | undefined);
    dispose(): void;
    clear(): void;
    clearAndLeak(): T | undefined;
}
export declare class MandatoryMutableDisposable<T extends IDisposable> implements IDisposable {
    private readonly _disposable;
    private _isDisposed;
    constructor(initialValue: T);
    get value(): T;
    set value(value: T);
    dispose(): void;
}
export declare class RefCountedDisposable {
    private readonly _disposable;
    private _counter;
    constructor(_disposable: IDisposable);
    acquire(): this;
    release(): this;
}
export interface IReference<T> extends IDisposable {
    readonly object: T;
}
export declare abstract class ReferenceCollection<T> {
    private readonly references;
    acquire(key: string, ...args: unknown[]): IReference<T>;
    protected abstract createReferencedObject(key: string, ...args: unknown[]): T;
    protected abstract destroyReferencedObject(key: string, object: T): void;
}
export declare class AsyncReferenceCollection<T> {
    private readonly referenceCollection;
    constructor(referenceCollection: ReferenceCollection<Promise<T>>);
    acquire(key: string, ...args: unknown[]): Promise<IReference<T>>;
}
export declare class ImmortalReference<T> implements IReference<T> {
    readonly object: T;
    constructor(object: T);
    dispose(): void;
}
export declare class DisposableMap<K, V extends IDisposable = IDisposable> implements IDisposable {
    private readonly _store;
    private _isDisposed;
    constructor(store?: Map<K, V>);
    dispose(): void;
    clearAndDisposeAll(): void;
    has(key: K): boolean;
    get size(): number;
    get(key: K): V | undefined;
    set(key: K, value: V, skipDisposeOnOverwrite?: boolean): void;
    deleteAndDispose(key: K): void;
    deleteAndLeak(key: K): V | undefined;
    keys(): IterableIterator<K>;
    values(): IterableIterator<V>;
    [Symbol.iterator](): IterableIterator<[K, V]>;
}
export declare class DisposableSet<V extends IDisposable = IDisposable> implements IDisposable {
    private readonly _store;
    private _isDisposed;
    constructor(store?: Set<V>);
    dispose(): void;
    clearAndDisposeAll(): void;
    has(value: V): boolean;
    get size(): number;
    add(value: V): void;
    deleteAndDispose(value: V): void;
    deleteAndLeak(value: V): V | undefined;
    values(): IterableIterator<V>;
    [Symbol.iterator](): IterableIterator<V>;
}
export declare function disposeOnReturn(fn: (store: DisposableStore) => void): void;
export declare function thenIfNotDisposed<T>(promise: Promise<T>, then: (result: T) => void): IDisposable;
export declare function thenRegisterOrDispose<T extends IDisposable>(promise: Promise<T>, store: DisposableStore): Promise<T>;
