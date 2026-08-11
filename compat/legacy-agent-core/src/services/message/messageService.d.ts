/**
 * `MessageService` — implementation of `IMessageService`.
 *
 * History source: the agent's `wire.jsonl` record log, NOT the live
 * `getContext().history`. The live history is the model's CURRENT context —
 * after a compaction it collapses into `[compaction_summary, ...tail]`, which
 * made `GET /sessions/{sid}/messages` lose everything before the fold. The
 * wire log keeps every record, so `readWireTranscript` rebuilds the full
 * transcript (the same view the TUI shows after resume). See
 * `./transcript.ts` for the exact mirrored semantics.
 *
 * Live-tail merge: records reach disk through an async flush queue, so a
 * request hitting an actively-running session may find the wire file a few
 * records behind memory. `WireTranscript.foldedLength` is what the live
 * history length WOULD be from the file's records; anything beyond it in the
 * real `getContext().history` is the unflushed tail and gets appended.
 *
 * Fallback: any transcript read/parse failure degrades to the previous
 * behavior (live context history) instead of failing the endpoint.
 */
import { Disposable } from '../../di';
import type { Message, PageResponse } from '@spiderbyte/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IMessageService, type MessageListQuery } from './message';
export declare class MessageService extends Disposable implements IMessageService {
    private readonly core;
    readonly _serviceBrand: undefined;
    private readonly transcriptCache;
    constructor(core: ICoreProcessService);
    list(sid: string, query: MessageListQuery): Promise<PageResponse<Message>>;
    get(sid: string, mid: string): Promise<Message>;
    /**
     * Confirms the session exists and returns its summary (for the timestamp
     * base). Throws `SessionNotFoundError` (→ 40401) on miss.
     */
    private _requireSession;
    /**
     * Full transcript mapped to protocol messages. Ids stay index-derived;
     * `created_at` uses the wire record time when known, nudged to stay
     * strictly increasing so cursor consumers keep a stable total order.
     */
    private _getProtocolMessages;
    /**
     * Wire transcript + unflushed live tail; falls back to the live context
     * history alone when the wire file is unreadable. Ordering matters: the
     * file is read BEFORE `getContext` so the in-memory history is always at
     * least as new as the file snapshot and the tail merge can only append.
     */
    private _getTranscriptEntries;
    private _resumeSession;
    /**
     * Read + reduce the wire log, cached on `(size, mtimeMs)` so repeated
     * pagination calls do not re-parse an unchanged file. Returns `undefined`
     * when the file is missing or unreadable (caller falls back to live view).
     */
    private _readTranscriptCached;
}
