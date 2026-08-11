import type { ContentPart } from '@spiderbyte/kosong';
import type { AgentRecord } from './types';
export declare function isBlobRef(url: string): boolean;
export interface BlobStoreOptions {
    readonly blobsDir: string;
    readonly threshold?: number;
    readonly maxCacheSize?: number;
}
export declare class BlobStore {
    private readonly blobsDir;
    private readonly threshold;
    private readonly maxCacheSize;
    private readonly cache;
    private readonly cacheSizes;
    private currentCacheSize;
    constructor(options: BlobStoreOptions);
    offload(record: AgentRecord): Promise<AgentRecord>;
    private offloadParts;
    rehydrate(record: AgentRecord): Promise<void>;
    rehydrateParts(parts: readonly ContentPart[]): Promise<void>;
    private offloadContentPart;
    private rehydrateContentPart;
    private rehydrateBlobRefUrl;
    private readBlob;
    private maybeOffloadString;
    private writeBlob;
    private setCache;
    private evictLRU;
}
