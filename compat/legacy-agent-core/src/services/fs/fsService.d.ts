import { Disposable } from '../../di';
import type { FsEntry, FsListManyRequest, FsListManyResponse, FsListRequest, FsListResponse, FsMkdirRequest, FsReadRequest, FsReadResponse, FsStatManyRequest, FsStatManyResponse, FsStatRequest } from '@spiderbyte/protocol';
import { type Ignore } from 'ignore';
import { ISessionService } from '../session/session';
import { IFsService, type FsDownloadResolved, type FsPathResolved } from './fs';
export declare class FsService extends Disposable implements IFsService {
    protected readonly sessions: ISessionService;
    readonly _serviceBrand: undefined;
    protected gitignoreCache: Map<string, Ignore>;
    constructor(sessions: ISessionService);
    dispose(): void;
    list(sessionId: string, req: FsListRequest): Promise<FsListResponse>;
    read(sessionId: string, req: FsReadRequest): Promise<FsReadResponse>;
    listMany(sessionId: string, req: FsListManyRequest): Promise<FsListManyResponse>;
    stat(sessionId: string, req: FsStatRequest): Promise<FsEntry>;
    statMany(sessionId: string, req: FsStatManyRequest): Promise<FsStatManyResponse>;
    mkdir(sessionId: string, req: FsMkdirRequest): Promise<FsEntry>;
    resolveDownload(sessionId: string, relPath: string): Promise<FsDownloadResolved>;
    resolvePath(sessionId: string, relPath: string): Promise<FsPathResolved>;
    protected matcher(realCwd: string): Promise<Ignore | undefined>;
}
