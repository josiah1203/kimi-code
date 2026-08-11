import type { FSWatcher } from 'chokidar';
import type { FsChangeEntry } from '@spiderbyte/protocol';
export declare class FsWatchLimitError extends Error {
    readonly connectionId: string;
    readonly attempted: number;
    readonly limit: number;
    constructor(connectionId: string, attempted: number, limit: number);
}
export interface FsChangedFrame {
    type: 'event.fs.changed';
    seq: number;
    session_id: string;
    timestamp: string;
    payload: {
        changes: FsChangeEntry[];
        coalesced_window_ms: number;
        truncated?: boolean;
        count?: number;
    };
}
export interface IFsWatcher {
    readonly _serviceBrand: undefined;
    addPaths(sessionId: string, connectionId: string, absPaths: readonly string[]): readonly string[];
    removePaths(sessionId: string, connectionId: string, absPaths: readonly string[]): readonly string[];
    countForConnection(connectionId: string): number;
    forgetConnection(connectionId: string): void;
    watchedPaths(connectionId: string, sessionId: string): readonly string[];
}
export declare const IFsWatcher: import("../..").ServiceIdentifier<IFsWatcher>;
export interface FsWatcherDeliverySink {
    send(frame: FsChangedFrame): void;
}
export interface FsWatcherConnectionLookup {
    resolve(connectionId: string): FsWatcherDeliverySink | undefined;
}
export interface FsWatcherServiceOptions {
    debounceMs?: number;
    maxChangesPerWindow?: number;
    maxPathsPerConnection?: number;
    watcherFactory?: () => FSWatcher;
}
export declare function createConnectionLookup(getConnection: (connId: string) => FsWatcherDeliverySink | undefined): FsWatcherConnectionLookup;
