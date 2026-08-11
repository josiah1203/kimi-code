import { Disposable } from '../../di';
import type { FsDiffRequest, FsDiffResponse, FsGitStatusRequest, FsGitStatusResponse } from '@spiderbyte/protocol';
import { ISessionService } from '../session/session';
import { IFsGitService } from './fsGit';
export declare class FsGitService extends Disposable implements IFsGitService {
    protected readonly sessions: ISessionService;
    readonly _serviceBrand: undefined;
    private readonly pullRequestCache;
    constructor(sessions: ISessionService);
    status(sessionId: string, req: FsGitStatusRequest): Promise<FsGitStatusResponse>;
    private readPullRequest;
    diff(sessionId: string, req: FsDiffRequest): Promise<FsDiffResponse>;
}
