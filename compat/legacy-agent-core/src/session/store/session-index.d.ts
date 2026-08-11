export interface SessionIndexEntry {
    readonly sessionId: string;
    readonly sessionDir: string;
    readonly workDir: string;
}
export interface SessionIndexDeletion {
    readonly sessionId: string;
    readonly deleted: true;
}
export declare function sessionIndexPath(homeDir: string): string;
export declare function appendSessionIndexEntry(homeDir: string, entry: SessionIndexEntry): Promise<void>;
export declare function appendSessionIndexDeletion(homeDir: string, sessionId: string): Promise<void>;
export declare function readSessionIndex(homeDir: string, sessionsDir: string): Promise<Map<string, SessionIndexEntry>>;
