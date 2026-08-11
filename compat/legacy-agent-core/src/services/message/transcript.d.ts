/**
 * Wire-transcript reader — rebuilds the FULL message history of a session
 * agent from its `wire.jsonl` record log.
 *
 * Why: `ContextMemory.applyCompaction` rewrites the in-memory history as
 * `[...keptUserMessages, compaction_summary]` (the kept real user prompts —
 * oldest head plus most recent tail, verbatim within a token budget, with an
 * elision marker between the segments when the pool overflowed — followed by
 * a single user-role summary), so `getContext().history` only reflects the
 * model's CURRENT context. The wire log, however, keeps every record. The TUI
 * shows the full transcript on resume because `ReplayBuilder` captures every
 * `pushHistory` during record replay and is never folded by compaction. This
 * module reproduces that exact view for daemon REST consumers (web), without
 * touching agent-core: it re-reduces the `context.*` records with the same
 * semantics as `ContextMemory` restore, except that `context.apply_compaction`
 * INSERTS the summary message in place instead of dropping the compacted
 * prefix.
 *
 * Mirrored agent-core semantics (packages/agent-core/src/agent/context/index.ts):
 *   - `context.append_message`      → append (deferred while a tool exchange is open)
 *   - `context.append_loop_event`   → step.begin/content.part/tool.call mutate the
 *                                     open assistant message; tool.result appends a
 *                                     tool message with the raw output plus the
 *                                     structured isError/note fields, exactly like
 *                                     `ContextMemory` history
 *   - `context.apply_compaction`    → keep the full history, append the
 *                                     user-role summary marker (origin
 *                                     `compaction_summary`), and recover
 *                                     `foldedLength` from the recorded
 *                                     kept-count fields
 *   - `context.undo`                → remove tail messages exactly like
 *                                     `ContextMemory.undo` (skip injections, stop at
 *                                     compaction summaries / `context.clear` floors)
 *   - `context.clear`               → keep prior messages in the transcript (the TUI
 *                                     replay keeps them too) but reset the folded view
 *
 * Blob refs (`blobref:<mime>;<hash>` URLs offloaded by `BlobStore`) are
 * rehydrated from `<agentDir>/blobs/<hash>` back into data URIs, mirroring
 * `BlobStore.rehydrateParts`.
 *
 * Callers must `resumeSession` BEFORE reading: replay rewrites outdated wire
 * protocol versions in place, so a post-resume read always sees the current
 * record shapes. Reads of an actively-running session can trail the in-memory
 * history by the few records still in the persistence flush queue — compare
 * `foldedLength` with the live `getContext().history` length and append the
 * missing tail (see `MessageService`).
 */
import type { AgentRecord } from '../../agent/records';
import type { ContextMessage } from '../../agent/context';
export interface TranscriptEntry {
    readonly message: ContextMessage;
    /** Wall-clock time of the originating wire record, when present. */
    readonly time?: number | undefined;
}
export interface WireTranscript {
    /** Full message history, compacted prefixes included. */
    readonly entries: readonly TranscriptEntry[];
    /**
     * Length the live (folded) `context.history` would have after these
     * records. Lets callers detect and append a not-yet-flushed live tail.
     */
    readonly foldedLength: number;
}
/**
 * Reduce wire records into the full transcript. Pure (no I/O); exported for
 * tests. Unknown or non-context records are ignored — only `context.*`
 * records mutate history in agent-core, every other mutation path logs one.
 */
export declare function reduceWireRecords(records: Iterable<AgentRecord>): {
    entries: TranscriptEntry[];
    foldedLength: number;
};
/**
 * Parse a `wire.jsonl` file. A torn FINAL line (crash mid-flush) is dropped,
 * matching `FileSystemAgentRecordPersistence.read`; corruption anywhere else
 * throws so the caller can fall back to the live context view.
 */
export declare function readWireRecords(wirePath: string): Promise<AgentRecord[]>;
/**
 * Rebuild the full transcript for one session agent. The caller is expected
 * to have resumed the session first (wire protocol migration — see header).
 */
export declare function readWireTranscript(sessionDir: string, agentId: string): Promise<WireTranscript>;
