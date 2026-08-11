import { Disposable } from '../../di';
import { ISessionService } from '../session/session';
import { ILogService } from '../logger/logger';
import { IFsWatcher, type FsWatcherConnectionLookup, type FsWatcherServiceOptions } from './fsWatcher';
export declare class FsWatcherService extends Disposable implements IFsWatcher {
    private readonly lookup;
    private readonly logger;
    readonly _serviceBrand: undefined;
    private readonly debounceMs;
    private readonly maxChangesPerWindow;
    private readonly maxPathsPerConnection;
    private readonly makeWatcher;
    private readonly sessions;
    private readonly connections;
    constructor(lookup: FsWatcherConnectionLookup, options: FsWatcherServiceOptions, logger: ILogService, _sessionService: ISessionService);
    addPaths(sessionId: string, connectionId: string, absPaths: readonly string[]): readonly string[];
    removePaths(sessionId: string, connectionId: string, absPaths: readonly string[]): readonly string[];
    countForConnection(connectionId: string): number;
    forgetConnection(connectionId: string): void;
    watchedPaths(connectionId: string, sessionId: string): readonly string[];
    bindSessionCwd(sessionId: string, cwd: string): void;
    private getOrCreateConnection;
    private createSessionEntry;
    private onRawChange;
    private flushWindow;
    dispose(): void;
}
