import { Disposable } from '../../di';
import type { FsBrowseResponse, FsHomeResponse } from '@spiderbyte/protocol';
export declare class WorkspaceFsNotAbsoluteError extends Error {
    readonly path: string;
    constructor(path: string);
}
export declare class WorkspaceFsNotFoundError extends Error {
    readonly path: string;
    constructor(path: string);
}
export declare class WorkspaceFsPermissionError extends Error {
    readonly path: string;
    constructor(path: string);
}
export interface IWorkspaceFsService {
    readonly _serviceBrand: undefined;
    browse(absPath?: string): Promise<FsBrowseResponse>;
    home(): Promise<FsHomeResponse>;
}
export declare const IWorkspaceFsService: import("../..").ServiceIdentifier<IWorkspaceFsService>;
export declare abstract class WorkspaceFsBase extends Disposable implements IWorkspaceFsService {
    readonly _serviceBrand: undefined;
    abstract browse(absPath?: string): Promise<FsBrowseResponse>;
    abstract home(): Promise<FsHomeResponse>;
}
export declare const RECENT_ROOTS_LIMIT = 8;
