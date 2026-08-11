import type { Agent } from '..';
import type { AgentRecord, AgentRecordPersistence } from './types';
export * from './types';
export { AGENT_WIRE_PROTOCOL_VERSION } from './migration';
export { FileSystemAgentRecordPersistence, InMemoryAgentRecordPersistence, } from './persistence';
export type { FileSystemAgentRecordPersistenceOptions } from './persistence';
export { BlobStore, isBlobRef } from './blobref';
export type { BlobStoreOptions } from './blobref';
export interface RestoringContext {
    time?: number;
}
export interface AgentRecordsReplayOptions {
    readonly rewriteMigratedRecords?: boolean;
}
export declare class AgentRecords {
    private readonly agent;
    private readonly persistence?;
    private _restoring;
    private metadataInitialized;
    private _replaying;
    /**
     * One-shot latch: the durable log is "open" once replay has completed (the
     * write-dedup cursors of observability records are restored) or, for agents
     * that never resume, once the first record has been logged live. Producers
     * of observability records (MCP discovery) park their writes until then —
     * logging earlier would both duplicate records that replay is about to
     * dedupe and append a stray metadata record ahead of replay.
     */
    private _opened;
    private readonly onOpenedCallbacks;
    constructor(agent: Agent, persistence?: AgentRecordPersistence | undefined);
    get restoring(): RestoringContext | null;
    /**
     * Whether observability records may be written directly. False before the
     * log is opened (see `_opened`); producers should park and re-attempt from
     * an `onOpened` callback. Always true without persistence — there is no
     * durable log to protect.
     */
    get observabilityReady(): boolean;
    /**
     * Register a callback fired once, when the log opens. Not fired for a
     * range-limited (frozen) replay — those agents are transient previews and
     * must not append new records.
     */
    onOpened(callback: () => void): void;
    private markOpened;
    logRecord(record: AgentRecord): void;
    restore(record: AgentRecord): boolean;
    replay(options?: AgentRecordsReplayOptions): Promise<{
        warning?: string;
    }>;
    flush(): Promise<void>;
}
