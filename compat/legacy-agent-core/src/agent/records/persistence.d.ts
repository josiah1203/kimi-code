import type { BlobStore } from './blobref';
import { type AgentRecord, type AgentRecordPersistence } from './types';
export interface FileSystemAgentRecordPersistenceOptions {
    readonly onError?: ((error: unknown) => void) | undefined;
    readonly blobStore?: BlobStore | undefined;
}
export interface InMemoryAgentRecordPersistenceOptions {
    readonly onRecord?: ((record: AgentRecord) => void) | undefined;
}
export declare class InMemoryAgentRecordPersistence implements AgentRecordPersistence {
    private readonly options;
    readonly records: AgentRecord[];
    constructor(records?: readonly AgentRecord[], options?: InMemoryAgentRecordPersistenceOptions);
    read(): AsyncIterable<AgentRecord>;
    append(input: AgentRecord): void;
    rewrite(records: readonly AgentRecord[]): void;
    flush(): Promise<void>;
    close(): Promise<void>;
}
export declare class FileSystemAgentRecordPersistence implements AgentRecordPersistence {
    private readonly filePath;
    private readonly options;
    private readonly pendingRecords;
    private shouldClear;
    private directorySynced;
    private flushPromise;
    private error;
    constructor(filePath: string, options?: FileSystemAgentRecordPersistenceOptions);
    read(): AsyncIterable<AgentRecord>;
    append(input: AgentRecord): void;
    rewrite(records: readonly AgentRecord[]): void;
    flush(): Promise<void>;
    close(): Promise<void>;
    private scheduleFlush;
    private ensureFlush;
    private throwIfError;
    private drainPendingRecords;
    private drainBatch;
}
