import type { SyncDescriptor0 } from './descriptors';
import type { DisposableStore } from './lifecycle';
import type { ServiceCollection } from './serviceCollection';
export declare namespace _util {
    const serviceIds: Map<string, ServiceIdentifier<any>>;
    const DI_TARGET = "$di$target";
    const DI_DEPENDENCIES = "$di$dependencies";
    function getServiceDependencies(ctor: DI_TARGET_OBJ): {
        id: ServiceIdentifier<any>;
        index: number;
    }[];
    interface DI_TARGET_OBJ extends Function {
        [DI_TARGET]: Function;
        [DI_DEPENDENCIES]: {
            id: ServiceIdentifier<any>;
            index: number;
        }[];
    }
}
export type BrandedService = {
    _serviceBrand: undefined;
};
export interface IConstructorSignature<T, Args extends any[] = []> {
    new <Services extends BrandedService[]>(...args: [...Args, ...Services]): T;
}
export type GetLeadingNonServiceArgs<TArgs extends any[]> = TArgs extends [] ? [] : TArgs extends [...infer TFirst, BrandedService] ? GetLeadingNonServiceArgs<TFirst> : TArgs;
export interface ServiceIdentifier<T> {
    (target: any, key: string | symbol | undefined, index: number): void;
    readonly type: T;
    toString(): string;
}
export declare function createDecorator<T>(name: string): ServiceIdentifier<T>;
export declare function refineServiceDecorator<T1, T extends T1>(serviceIdentifier: ServiceIdentifier<T1>): ServiceIdentifier<T>;
export interface ServicesAccessor {
    get<T>(id: ServiceIdentifier<T>): T;
}
export interface IInstantiationService {
    readonly _serviceBrand: undefined;
    invokeFunction<R, TS extends any[] = []>(fn: (accessor: ServicesAccessor, ...args: TS) => R, ...args: TS): R;
    createInstance<T>(descriptor: SyncDescriptor0<T>): T;
    createInstance<Ctor extends new (...args: any[]) => unknown, R extends InstanceType<Ctor>>(ctor: Ctor, ...args: GetLeadingNonServiceArgs<ConstructorParameters<Ctor>>): R;
    createChild(services: ServiceCollection, store?: DisposableStore): IInstantiationService;
    dispose(): void;
}
export declare const IInstantiationService: ServiceIdentifier<IInstantiationService>;
export interface ServiceCollectionLike {
    set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: any): unknown;
    get<T>(id: ServiceIdentifier<T>): any;
    has(id: ServiceIdentifier<any>): boolean;
    forEach(callback: (id: ServiceIdentifier<any>, value: any) => void): void;
}
