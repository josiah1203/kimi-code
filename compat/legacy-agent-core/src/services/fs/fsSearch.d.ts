import type { IDisposable } from '../../di';
import type { FsGrepRequest, FsGrepResponse, FsSearchRequest, FsSearchResponse } from '@spiderbyte/protocol';
export declare class FsGrepTimeoutError extends Error {
    readonly elapsedMs: number;
    constructor(elapsedMs: number);
}
export interface IFsSearchService extends IDisposable {
    readonly _serviceBrand: undefined;
    search(sessionId: string, req: FsSearchRequest): Promise<FsSearchResponse>;
    grep(sessionId: string, req: FsGrepRequest): Promise<FsGrepResponse>;
}
export declare const IFsSearchService: import("../..").ServiceIdentifier<IFsSearchService>;
