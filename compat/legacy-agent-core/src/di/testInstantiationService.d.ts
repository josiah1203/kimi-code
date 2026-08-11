import * as sinon from 'sinon';
import { SyncDescriptor, type SyncDescriptor0 } from './descriptors';
import { type GetLeadingNonServiceArgs, type ServiceIdentifier, type ServicesAccessor } from './instantiation';
import { InstantiationService } from './instantiationService';
import { DisposableStore, type IDisposable } from './lifecycle';
import { ServiceCollection } from './serviceCollection';
type AnyConstructor<T = unknown> = new (...args: any[]) => T;
export declare class TestInstantiationService extends InstantiationService implements IDisposable, ServicesAccessor {
    private readonly _serviceCollection;
    private readonly _properDispose?;
    private readonly _classStubs;
    private readonly _parentTestService?;
    constructor(_serviceCollection?: ServiceCollection, strict?: boolean, parent?: InstantiationService, _properDispose?: boolean | undefined);
    get<T>(id: ServiceIdentifier<T>): T;
    set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): T | SyncDescriptor<T> | undefined;
    mock<T>(id: ServiceIdentifier<T>): T | sinon.SinonMock;
    stubInstance<T>(ctor: AnyConstructor<T>, instance: Partial<T>): void;
    protected _getClassStub(ctor: Function): unknown;
    createInstance<T>(descriptor: SyncDescriptor0<T>): T;
    createInstance<Ctor extends AnyConstructor, R extends InstanceType<Ctor>>(ctor: Ctor, ...args: GetLeadingNonServiceArgs<ConstructorParameters<Ctor>>): R;
    stub<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): T | SyncDescriptor<T>;
    stub<T>(id: ServiceIdentifier<T>, ctor: AnyConstructor<T>): T;
    stub<T, V>(id: ServiceIdentifier<T>, obj: Partial<NoInfer<T>> | Function, property: string, value: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
    stub<T, V>(id: ServiceIdentifier<T>, property: string, value: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
    stubPromise<T>(id?: ServiceIdentifier<T>, fnProperty?: string, value?: any): T | sinon.SinonStub;
    stubPromise<T, V>(id?: ServiceIdentifier<T>, ctor?: any, fnProperty?: string, value?: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
    stubPromise<T, V>(id?: ServiceIdentifier<T>, obj?: any, fnProperty?: string, value?: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
    spy<T>(id: ServiceIdentifier<T>, property: string): sinon.SinonSpy;
    private _create;
    private _getOrCreateService;
    private _createService;
    private _createStub;
    private _createReplacement;
    private _hasSinonOption;
    private _isServiceMock;
    createChild(services: ServiceCollection): TestInstantiationService;
    dispose(): void;
}
export type ServiceIdCtorPair<T> = [
    id: ServiceIdentifier<T>,
    ctorOrInstance: T | AnyConstructor<T>
];
export declare function createServices(disposables: DisposableStore, services: ServiceIdCtorPair<any>[]): TestInstantiationService;
export {};
