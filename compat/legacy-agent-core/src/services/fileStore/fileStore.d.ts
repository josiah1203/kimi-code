import type { Readable } from 'node:stream';
import type { FileMeta } from '@spiderbyte/protocol';
export declare const DEFAULT_MAX_UPLOAD_BYTES: number;
export declare class FileNotFoundError extends Error {
    readonly fileId: string;
    constructor(fileId: string);
}
export declare class FileTooLargeError extends Error {
    readonly limit: number;
    readonly seen: number;
    constructor(seen: number, limit: number);
}
export interface SaveOptions {
    name?: string;
    mimeType?: string;
    expiresInSec?: number;
}
export interface GetResult {
    meta: FileMeta;
    blobPath: string;
}
export interface IFileStore {
    readonly _serviceBrand: undefined;
    save(source: Readable, filename: string, options?: SaveOptions): Promise<FileMeta>;
    get(fileId: string): Promise<GetResult>;
    delete(fileId: string): Promise<void>;
}
export declare const IFileStore: import("../..").ServiceIdentifier<IFileStore>;
