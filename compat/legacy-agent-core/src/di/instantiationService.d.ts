import { SyncDescriptor } from './descriptors';
import { Graph } from './graph';
import { type IInstantiationService, type ServiceIdentifier, type ServicesAccessor } from './instantiation';
import { type DisposableStore } from './lifecycle';
import { ServiceCollection } from './serviceCollection';
declare const enum TraceType {
    None = 0,
    Creation = 1,
    Invocation = 2,
    Branch = 3
}
export declare class Trace {
    readonly type: TraceType;
    readonly name: string | null;
    static readonly all: Set<string>;
    private static readonly _None;
    static traceInvocation(_enableTracing: boolean, fn: any): Trace;
    static traceCreation(_enableTracing: boolean, ctor: any): Trace;
    private static _totals;
    private readonly _start;
    private readonly _dep;
    private constructor();
    branch(id: ServiceIdentifier<any>, first: boolean): Trace;
    stop(): void;
}
export declare class InstantiationService implements IInstantiationService {
    private readonly _services;
    private readonly _strict;
    protected readonly _enableTracing: boolean;
    readonly _serviceBrand: undefined;
    readonly _globalGraph?: Graph<string>;
    private _globalGraphImplicitDependency?;
    protected readonly _parent?: InstantiationService;
    protected readonly _constructionOrder: any[];
    protected readonly _children: Set<InstantiationService>;
    private readonly _inProgress;
    private readonly _activeInstantiations;
    private readonly _servicesToMaybeDispose;
    private _disposed;
    constructor(_services?: ServiceCollection, _strict?: boolean, parent?: InstantiationService, _enableTracing?: boolean);
    invokeFunction<R, TS extends any[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R;
    createInstance<T>(descriptor: SyncDescriptor<T>, ...rest: any[]): T;
    createInstance<T>(ctor: new (...args: any[]) => T, ...rest: any[]): T;
    createChild(services: ServiceCollection, store?: DisposableStore): IInstantiationService;
    dispose(): void;
    private _createInstance;
    protected _getOrCreateServiceInstance<T>(id: ServiceIdentifier<T>, _trace: Trace): T;
    private _safeCreateAndCacheServiceInstance;
    private _createAndCacheServiceInstance;
    private _createServiceInstanceWithOwner;
    private _createServiceInstance;
    private _setCreatedServiceInstance;
    private _getServiceInstanceOrDescriptor;
    private _throwIfStrict;
    private _root;
    private _assertNotDisposed;
}
export {};
