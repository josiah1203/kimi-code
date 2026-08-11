import { DisposableStore, type IDisposable } from '../../di/lifecycle';
export interface Event<T> {
    (listener: (e: T) => unknown, thisArg?: unknown, disposables?: IDisposable[] | DisposableStore): IDisposable;
}
export declare class Emitter<T> {
    private _listeners;
    private _disposed;
    private _event;
    get event(): Event<T>;
    fire(value: T): void;
    dispose(): void;
    get isDisposed(): boolean;
}
export declare namespace Event {
    const None: Event<unknown>;
    function once<T>(event: Event<T>): Event<T>;
    function map<I, O>(event: Event<I>, map: (i: I) => O): Event<O>;
    function filter<T>(event: Event<T>, filter: (e: T) => boolean): Event<T>;
    function any<T>(...events: Event<T>[]): Event<T>;
}
