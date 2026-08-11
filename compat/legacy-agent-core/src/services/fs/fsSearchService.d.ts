import { Disposable } from '../../di';
import type { FsGrepRequest, FsGrepResponse, FsSearchRequest, FsSearchResponse } from '@spiderbyte/protocol';
import { type Ignore } from 'ignore';
import { ISessionService } from '../session/session';
import { ILogService } from '../logger/logger';
import { type TelemetryClient } from '../../telemetry';
import { IFsSearchService } from './fsSearch';
export declare class FsSearchService extends Disposable implements IFsSearchService {
    protected readonly sessions: ISessionService;
    protected readonly logger: ILogService;
    readonly _serviceBrand: undefined;
    protected gitignoreCache: Map<string, Ignore>;
    protected rgPath: string | null | undefined;
    protected rgMissingWarned: boolean;
    protected readonly telemetry: TelemetryClient;
    constructor(telemetry: TelemetryClient, sessions: ISessionService, logger: ILogService);
    dispose(): void;
    search(sessionId: string, req: FsSearchRequest): Promise<FsSearchResponse>;
    grep(sessionId: string, req: FsGrepRequest): Promise<FsGrepResponse>;
    protected probeRg(): Promise<string | null>;
    protected grepWithRg(rgBinary: string, cwd: string, req: FsGrepRequest, signal: AbortSignal, startedAt: number): Promise<FsGrepResponse>;
    protected grepWithNode(cwd: string, req: FsGrepRequest, signal: AbortSignal, startedAt: number): Promise<FsGrepResponse>;
    protected walk(rootAbs: string, rootRel: string, matcher: Ignore | undefined, visit: (relPath: string, name: string, kind: 'file' | 'directory' | 'symlink') => Promise<void>, depth?: number): Promise<void>;
    protected matcher(realCwd: string): Promise<Ignore | undefined>;
}
