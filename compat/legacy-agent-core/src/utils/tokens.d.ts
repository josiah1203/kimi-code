import type { ContentPart, Message, Tool } from '@spiderbyte/kosong';
/**
 * Structural subset of kosong's {@link Message} that token estimation reads.
 * Accepting the subset (instead of the full `Message`) lets callers with
 * message-shaped objects — such as the compaction helpers in `handoff.ts`,
 * which carry only `role`/`content`/`origin` — estimate tokens without an
 * unsafe cast, while full `Message` values still satisfy it.
 */
interface TokenEstimatableMessage {
    readonly role: string;
    readonly content: readonly ContentPart[];
    readonly toolCalls?: readonly {
        readonly name: string;
        readonly arguments: unknown;
    }[];
    readonly tools?: readonly Tool[] | undefined;
}
/**
 * Estimate token count from text using a character-based heuristic.
 *   - ASCII (~4 chars per token)
 *   - CJK and other non-ASCII (~1 char per token)
 * The estimate is transient — the next LLM call returns the real count
 * and supersedes this value. Used to keep `tokenCountWithPending`
 * monotonic between LLM round-trips without paying for a tokenizer.
 */
export declare function estimateTokens(text: string): number;
export declare function estimateTokensForMessages(messages: readonly Message[]): number;
export declare function estimateTokensForTools(tools: readonly Tool[]): number;
export declare function estimateTokensForMessage(message: TokenEstimatableMessage): number;
export declare function estimateTokensForContentParts(parts: readonly ContentPart[]): number;
/**
 * Transient per-part token floor for media (image/audio/video) whose real size
 * cannot be cheaply derived from a data URL without decoding it. Mirrors the
 * fixed ~2000-tokens-per-image estimate used elsewhere in the industry and, by
 * the same reasoning, deliberately does NOT count the base64 payload as text —
 * that would wildly over-count (a few MB of data URL would read as ~1M tokens).
 * The value is transient: the next LLM round-trip returns the real usage and
 * supersedes it. Its only job is to stop compaction triggers, the
 * overflow-shrink budget, the kept-user budget, and `tokensAfter` from treating
 * media parts as free.
 */
export declare const MEDIA_TOKEN_ESTIMATE = 2000;
export declare function estimateTokensForContentPart(part: ContentPart): number;
export {};
