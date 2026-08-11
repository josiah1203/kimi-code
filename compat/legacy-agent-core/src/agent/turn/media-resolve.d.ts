/**
 * Turn-level prompt media resolution.
 *
 * A video attached directly to a prompt rides in as a `video_url` part whose
 * url is a local `file://` reference (the TUI materializes the paste into a
 * cache copy and points the part at it). That reference must never reach the
 * model or the persisted history: the provider would send the `file://` string
 * verbatim on the wire, and a resumed session would replay it. So the turn
 * resolves every local `file://` video into its final delivered form — an
 * uploaded `ms://` reference, or an inline/tag fallback — BEFORE the prompt is
 * appended to context.
 *
 * Two entry points:
 *   - `resolvePromptMedia` (async): the primary prompt path. Validates and
 *     uploads through the provider's channel (see `deliverVideoContent`),
 *     degrading to a `<video path>` tag on validation failure, re-throwing
 *     auth rejections so the turn fails visibly, and re-throwing the abort
 *     reason when the turn is cancelled mid-upload so the cancellation ends
 *     the turn instead of appending a degraded message.
 *   - `degradeUnresolvedVideoToTag` (sync): the always-safe floor for the few
 *     append sites that cannot await an upload (steer-buffer flushes, the
 *     budget-exhausted goal turn). The local video becomes a `<video path>`
 *     tag the model opens with ReadMediaFile, which uploads it in-turn — the
 *     same path a pasted video took before inline prompt delivery existed.
 */
import type { ContentPart } from '@spiderbyte/kosong';
import type { Agent } from '..';
/**
 * Resolve prompt-attached local videos to their final delivered form. Upload
 * through the provider channel when the model supports video and the file
 * validates; otherwise degrade to a `<video path>` tag. Auth rejections from
 * the upload channel propagate so the turn fails visibly. Returns the input
 * unchanged when it carries no local video part.
 */
export declare function resolvePromptMedia(agent: Agent, input: readonly ContentPart[], signal?: AbortSignal): Promise<readonly ContentPart[]>;
/**
 * Synchronously replace every prompt-attached local `file://` video part with
 * a `<video path>` tag. The always-safe floor for append sites that cannot
 * await an upload. Returns the input unchanged when it carries no local video.
 */
export declare function degradeUnresolvedVideoToTag(input: readonly ContentPart[]): readonly ContentPart[];
