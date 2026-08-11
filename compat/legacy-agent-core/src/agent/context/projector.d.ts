import type { Message } from '@spiderbyte/kosong';
import type { ContextMessage } from './types';
export interface ProjectOptions {
    /**
     * When `true`, emit a synthetic `tool_result` for *every* assistant `tool_use`
     * whose result is not present in the provided messages — including a trailing,
     * still-in-flight call. Used by full compaction, where the compacted prefix is
     * a slice that may exclude a delayed result preserved in the retained tail; the
     * synthetic result keeps the exchange closed so the summary request is not
     * rejected. Leave `false` for normal turns: a *trailing* missing result there
     * means the call is still in-flight and must not be closed prematurely. (A
     * *non-trailing* missing result is always closed regardless of this flag — see
     * `repairToolExchangeAdjacency` — because a later turn proves it is not
     * in-flight.)
     */
    readonly synthesizeMissing?: boolean;
    /**
     * When `true`, drop any `tool_result` whose `toolCallId` matches no assistant
     * `tool_use` anywhere in the provided messages. Such an orphan is wire-invalid
     * on every strict provider and useless to the model (it has no record of the
     * call the result answers). Enabled on every request-building projection — the
     * normal wire, the strict resend, and the compaction summarizer — so a stray
     * result never reaches a provider. Left OFF for non-request projections (e.g.
     * token-estimating a history slice), where a result's matching call may
     * legitimately sit outside the slice and must not be mistaken for an orphan.
     */
    readonly dropOrphanResults?: boolean;
    /**
     * When `true`, drop leading messages until the first one is a user turn. Strict
     * providers require the first message to be `user`; a history that (after
     * dropping/compaction) starts with an assistant or tool message is rejected.
     * Strict-resend only — the normal path keeps the original opening.
     */
    readonly dropLeadingNonUser?: boolean;
    /**
     * When `true`, merge back-to-back assistant messages into one. Strict providers
     * reject consecutive same-role turns ("roles must alternate"); consecutive user
     * turns are already merged at the provider boundary, but consecutive assistant
     * turns are not. Strict-resend only. Content is concatenated verbatim — callers
     * must not rely on this when extended-thinking ordering matters, but two
     * consecutive assistant turns do not arise in well-formed transcripts.
     */
    readonly mergeConsecutiveAssistants?: boolean;
    /**
     * When `true`, drop assistant tool calls whose id already appeared earlier
     * (first occurrence wins; a message left with no calls and no sendable
     * content is dropped), and drop every tool result after the first for a
     * given id so the kept call keeps exactly one answer. Duplicate ids are
     * wire-invalid on
     * strict providers ("`tool_use` ids must be unique") and no other pass can
     * repair them. Strict-resend only: a provider that accepted the duplicates
     * when it produced them (e.g. per-response counter ids like `call_0`) must
     * keep seeing the history it generated — deduping the normal path would
     * silently erase its later tool exchanges.
     */
    readonly dedupeDuplicateToolCalls?: boolean;
    /**
     * Optional sink invoked for every repair the projector applies to keep the
     * outgoing wire valid: a displaced result moved back next to its call, a
     * synthetic result invented for a missing one, a stray result dropped, a
     * leading non-user message dropped, or consecutive assistants merged. The
     * projection itself stays a pure transform; the caller decides whether/how to
     * surface these (the context logs them so a silently-mangled history is never
     * papered over without a trace). Not called when the history is already
     * well-formed.
     */
    readonly onAnomaly?: (anomaly: ProjectionAnomaly) => void;
}
/**
 * A repair the projector applied to make the history wire-valid. Each one means
 * the stored history was not directly sendable to a strict provider.
 */
export type ProjectionAnomaly = 
/** A recorded result was not adjacent to its call and had to be moved up. */
{
    readonly kind: 'tool_result_reordered';
    readonly toolCallId: string;
}
/**
 * No result existed for a call, so a placeholder was synthesized. `trailing`
 * is true when it closed a still-open tail call (expected under
 * `synthesizeMissing`), false when it closed a mid-history orphan whose result
 * was lost (a genuine defect worth investigating).
 */
 | {
    readonly kind: 'tool_result_synthesized';
    readonly toolCallId: string;
    readonly trailing: boolean;
}
/** A result with no matching call anywhere was dropped (wire exits only). */
 | {
    readonly kind: 'orphan_tool_result_dropped';
    readonly toolCallId: string;
}
/** A tool call whose id already appeared earlier was dropped (strict-resend only). */
 | {
    readonly kind: 'duplicate_tool_call_dropped';
    readonly toolCallId: string;
}
/** A second result for an already-answered id was dropped (strict-resend only). */
 | {
    readonly kind: 'duplicate_tool_result_dropped';
    readonly toolCallId: string;
}
/** A leading non-user message was dropped so the first turn is user (strict). */
 | {
    readonly kind: 'leading_non_user_dropped';
    readonly role: string;
}
/** Two adjacent assistant turns were merged into one (strict). */
 | {
    readonly kind: 'consecutive_assistants_merged';
}
/** A non-empty but all-whitespace text block was dropped (always). */
 | {
    readonly kind: 'whitespace_text_dropped';
    readonly role: string;
}
/**
 * Every recorded part serialized to nothing on the wire (e.g. an assistant
 * step that recorded only an empty thinking part from a provider-filtered
 * response), so the whole message was dropped. Distinct from the silent
 * empty-content drop: parts were recorded, yet none of them was sendable —
 * a genuine defect signal, not routine cleanup.
 */
 | {
    readonly kind: 'vacuous_message_dropped';
    readonly role: string;
};
export declare function project(history: readonly ContextMessage[], options?: ProjectOptions): Message[];
export declare function trimTrailingOpenToolExchange(history: readonly Message[]): Message[];
/**
 * How many of the most recent media parts survive the media-degraded
 * projection. The tail images are what the model is actively working from
 * (the screenshot it just took); everything older is replaced by a marker.
 */
export declare const MEDIA_DEGRADE_KEEP_RECENT = 2;
declare const MEDIA_DEGRADED_PLACEHOLDERS: {
    readonly image_url: "[image omitted: dropped to fit the provider request size limit; re-read the file to view it]";
    readonly audio_url: "[audio omitted: dropped to fit the provider request size limit; re-read the file to hear it]";
    readonly video_url: "[video omitted: dropped to fit the provider request size limit; re-read the file to view it]";
};
/**
 * Provider-compatible markers for a resend with every media part stripped.
 * This projection recovers from both an image-format rejection and a request
 * that remains too large after retaining recent media, so the wording must
 * not diagnose either cause. Re-reading the path gives the model the relevant
 * conversion or size-reduction guidance at the tool boundary.
 */
export declare const MEDIA_STRIPPED_PLACEHOLDERS: {
    readonly image_url: "[image omitted for provider compatibility; re-read the file to view it or get conversion guidance]";
    readonly audio_url: "[audio omitted for provider compatibility; re-read the file to hear it]";
    readonly video_url: "[video omitted for provider compatibility; re-read the file to view it]";
};
type MediaPlaceholderSet = typeof MEDIA_DEGRADED_PLACEHOLDERS | typeof MEDIA_STRIPPED_PLACEHOLDERS;
/**
 * Content identities of the media present when full stripping first becomes
 * necessary in a turn. Digests, rather than part/container object identity,
 * survive compaction and ensure re-reading identical media remains stripped.
 */
export type MediaStripSnapshot = ReadonlySet<string>;
/** Capture the provider-visible content identity of every current media part. */
export declare function captureMediaStripSnapshot(messages: readonly Message[]): MediaStripSnapshot;
/**
 * Replace only media captured in `snapshot`. Media produced later with a new
 * provider-visible identity survives, allowing the model to read a smaller
 * recovery copy while the oversized/poisoned content stays stripped.
 */
export declare function stripMediaPartsBySnapshot(messages: readonly Message[], snapshot: MediaStripSnapshot): Message[];
/**
 * Replace all but the `keepRecent` most recent media parts with deterministic
 * text markers. This is the media-degraded projection used to resend a request
 * the provider rejected as too large (HTTP 413 on accumulated base64 media)
 * and — with `keepRecent = 0` and `MEDIA_STRIPPED_PLACEHOLDERS` — the resend
 * after a provider media rejection, where only a full strip guarantees a
 * compatible request. A purely read-side
 * transform — the underlying history is left untouched — that trades pixels
 * for deliverability while the surrounding text (including ReadMediaFile's
 * `<image path="...">` wrapper) survives, so the model can re-read any file
 * it still needs. Untouched messages are returned by reference, and when
 * nothing needs degrading the input array itself is returned.
 */
export declare function degradeOlderMediaParts(messages: readonly Message[], keepRecent: number, placeholders?: MediaPlaceholderSet): Message[];
export {};
