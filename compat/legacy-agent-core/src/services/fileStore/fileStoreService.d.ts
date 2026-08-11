import type { Readable } from 'node:stream';
import { Disposable } from '../../di';
import type { FileMeta } from '@spiderbyte/protocol';
import { IEnvironmentService } from '../environment/environment';
import { ILogService } from '../logger/logger';
import { IFileStore } from './fileStore';
export declare class FileStore extends Disposable implements IFileStore {
    private readonly logger;
    readonly _serviceBrand: undefined;
    private readonly baseDir;
    private readonly indexPath;
    private readonly maxUploadBytes;
    private indexCache;
    private indexLoadPromise;
    constructor(env: IEnvironmentService, logger: ILogService);
    save(source: Readable, filename: string, options?: import('./fileStore.js').SaveOptions): Promise<FileMeta>;
    get(fileId: string): Promise<import('./fileStore.js').GetResult>;
    delete(fileId: string): Promise<void>;
    private ensureIndex;
    private loadIndex;
    private writeIndex;
    dispose(): void;
}
