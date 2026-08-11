export declare const PENDING_MAX = 1000;
export interface Sink {
    enqueue(line: string): void;
    /** Resolves to false when the pending batch could not be written. */
    flush(): Promise<boolean>;
    close(): Promise<void>;
    flushSync(): void;
}
interface RotatingFileSinkOptions {
    readonly path: string;
    readonly maxBytes: number;
    readonly files: number;
}
export declare class RotatingFileSink implements Sink {
    private readonly options;
    private readonly queue;
    private pending;
    private dropped;
    private closed;
    private lastStderrNotice;
    private currentBytes;
    private directorySynced;
    constructor(options: RotatingFileSinkOptions);
    enqueue(line: string): void;
    flush(): Promise<boolean>;
    close(): Promise<void>;
    flushSync(): void;
    private scheduleDrain;
    private drain;
    private restorePending;
    private appendLines;
    private appendChunk;
    private rotate;
    private statSize;
    private takeDroppedNotice;
    private noteFailure;
}
export {};
