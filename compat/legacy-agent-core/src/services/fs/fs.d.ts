import type { IDisposable } from '../../di';
import type { FsEntry, FsListManyRequest, FsListManyResponse, FsListRequest, FsListResponse, FsMkdirRequest, FsReadRequest, FsReadResponse, FsStatManyRequest, FsStatManyResponse, FsStatRequest } from '@spiderbyte/protocol';
export declare class FsPathNotFoundError extends Error {
    readonly inputPath: string;
    constructor(inputPath: string);
}
export declare class FsIsDirectoryError extends Error {
    readonly inputPath: string;
    constructor(inputPath: string);
}
export declare class FsIsBinaryError extends Error {
    readonly inputPath: string;
    constructor(inputPath: string);
}
export declare class FsTooLargeError extends Error {
    readonly inputPath: string;
    readonly size: number;
    constructor(inputPath: string, size: number);
}
export declare class FsTooManyResultsError extends Error {
    readonly inputPath: string;
    readonly limit: number;
    constructor(inputPath: string, limit: number);
}
export declare class FsAlreadyExistsError extends Error {
    readonly inputPath: string;
    constructor(inputPath: string);
}
export interface IFsService extends IDisposable {
    readonly _serviceBrand: undefined;
    list(sessionId: string, req: FsListRequest): Promise<FsListResponse>;
    read(sessionId: string, req: FsReadRequest): Promise<FsReadResponse>;
    listMany(sessionId: string, req: FsListManyRequest): Promise<FsListManyResponse>;
    stat(sessionId: string, req: FsStatRequest): Promise<FsEntry>;
    statMany(sessionId: string, req: FsStatManyRequest): Promise<FsStatManyResponse>;
    mkdir(sessionId: string, req: FsMkdirRequest): Promise<FsEntry>;
    resolveDownload(sessionId: string, relPath: string): Promise<FsDownloadResolved>;
    resolvePath(sessionId: string, relPath: string): Promise<FsPathResolved>;
}
export interface FsDownloadResolved {
    readonly absolute: string;
    readonly relative: string;
    readonly size: number;
    readonly etag: string;
    readonly mime: string;
    readonly modifiedAt: Date;
}
export interface FsPathResolved {
    readonly absolute: string;
    readonly relative: string;
    readonly isDirectory: boolean;
}
export declare const IFsService: import("../..").ServiceIdentifier<IFsService>;
