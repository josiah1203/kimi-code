import type { ContentPart } from '@spiderbyte/kosong';
import type { PromptOrigin } from '../context/types';
/**
 * Compaction handoff helpers.
 *
 * Compaction rewrites the model context as: the kept user messages (verbatim,
 * within a token budget) followed by a single user-role summary that is
 * prefixed with `COMPACTION_SUMMARY_PREFIX`. When the user messages exceed the
 * budget, the kept set is a HEAD segment (the oldest
 * `COMPACT_USER_MESSAGE_HEAD_TOKENS`) plus a TAIL segment (the most recent
 * remainder of the budget), with a user-invisible elision marker between them
 * telling the model what was omitted. Assistant messages, tool calls, and tool
 * results are dropped. These helpers apply the exact same rule for both the
 * live context rewrite and the transcript reducer.
 */
export declare const COMPACTION_SUMMARY_PREFIX: string;
export declare const COMPACT_USER_MESSAGE_MAX_TOKENS = 20000;
/**
 * Of `COMPACT_USER_MESSAGE_MAX_TOKENS`, the slice reserved for the OLDEST user
 * messages once the pool no longer fits the budget. The earliest prompts
 * usually carry the original task statement, which a tail-only selection
 * would drop entirely.
 */
export declare const COMPACT_USER_MESSAGE_HEAD_TOKENS = 2000;
/**
 * `InjectionOrigin.variant` of the elision marker inserted between the head
 * and tail segments. Injection-origin messages are dropped by
 * `compactionUserMessageDisposition` at the next compaction (so markers never
 * stack or get re-summarized) and are skipped on replay/transcript rendering.
 */
export declare const COMPACTION_ELISION_VARIANT = "compaction_elision";
/**
 * Structural subset of kosong's `Message` that the handoff helpers inspect.
 * Both `ContextMessage` (the live context) and the wire-transcript reducer's
 * mutable message satisfy this shape, so one set of helpers serves both
 * layers without introducing a shared nominal type. `origin` is what tells
 * real user input apart from injections and compaction summaries.
 */
interface MessageLike {
    readonly role: string;
    readonly content: readonly ContentPart[];
    readonly origin?: PromptOrigin | undefined;
}
export type CompactionUserDisposition = 'keep' | 'drop';
/**
 * Single source of truth for whether a user-role message survives compaction as
 * genuine user input. Only real user prompts and user-slash skill
 * activations are kept verbatim. Everything else user-role is
 * either rebuilt by injectors after compaction or intentionally ephemeral, so
 * it is dropped from the live context even when transcript/replay retains it
 * for UI rendering. New `PromptOrigin` kinds must update this switch.
 */
export declare function compactionUserMessageDisposition(origin: PromptOrigin | undefined): CompactionUserDisposition;
export declare function isCompactionSummaryMessage(message: MessageLike): boolean;
/**
 * Keep only genuine user input (real user prompts and user-slash skill
 * activations). See `compactionUserMessageDisposition` for the full keep/drop
 * policy and the rationale for each origin.
 */
export declare function isRealUserInput(message: MessageLike): boolean;
export declare function collectCompactableUserMessages<T extends MessageLike>(messages: readonly T[]): T[];
/**
 * Tail-only selection: keep the most recent user messages whose cumulative
 * estimated size fits `maxTokens`. The oldest kept message is truncated to the
 * remaining budget when it would otherwise overflow; older messages are
 * dropped.
 *
 * This is the selection rule compaction used before the head/tail split.
 * `selectCompactionUserMessages` is the live rule; this one is kept so wire
 * records written before `keptHeadUserMessageCount` existed restore with the
 * exact selection that produced them.
 */
export declare function selectRecentUserMessages<T extends MessageLike>(messages: readonly T[], maxTokens?: number): T[];
export interface CompactionUserSelection<T> {
    /**
     * Oldest user messages kept within the head budget. The newest of them may
     * be truncated to the remaining budget (keeping its beginning) and may be a
     * partial slice of the same original message whose end opens `tail`. Empty
     * when nothing was elided.
     */
    readonly head: T[];
    /**
     * Most recent user messages kept within the remaining budget. The oldest of
     * them may be truncated (keeping its end, which is the more recent part).
     * Holds the whole input verbatim when `elided` is false.
     */
    readonly tail: T[];
    /** True when user content between `head` and `tail` was dropped. */
    readonly elided: boolean;
    /** Estimated tokens of the dropped middle. 0 when `elided` is false. */
    readonly omittedTokens: number;
}
/**
 * Select the user messages compaction keeps verbatim.
 *
 * When the pool fits `maxTokens` it is kept whole. When it does not, the kept
 * set is the first `headTokens` of the pool (oldest messages, boundary
 * truncated keeping its beginning) plus the last `maxTokens - headTokens`
 * (newest messages, boundary truncated keeping its end). The head may extend
 * into the beginning of the same message whose end anchors the tail, so a
 * single oversized message still keeps both its start and its most recent
 * part.
 */
export declare function selectCompactionUserMessages<T extends MessageLike>(messages: readonly T[], maxTokens?: number, headTokens?: number): CompactionUserSelection<T>;
/**
 * Model-facing text of the elision marker placed between the head and tail
 * segments. Wrapped in `<system-reminder>` so the model reads it as harness
 * guidance rather than user input.
 */
export declare function buildCompactionElisionText(omittedTokens: number): string;
export declare function buildCompactionSummaryText(summary: string): string;
export {};
