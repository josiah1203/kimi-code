import { KimiError } from './classes';
import { type KimiErrorCode } from './codes';
/**
 * Wire-safe payload of a Kimi error.
 *
 * The structure passed across process / language boundaries (RPC, events,
 * telemetry, SDK wrappers). Class identity does not survive the boundary;
 * downstream code must branch on `code` rather than `instanceof`.
 *
 * `details` is JSON-serialized. `cause` is intentionally absent -- it is
 * local-only diagnostic state and must not cross the boundary.
 */
export interface KimiErrorPayload {
    readonly code: KimiErrorCode;
    readonly message: string;
    readonly name?: string;
    readonly details?: Record<string, unknown>;
    readonly retryable: boolean;
}
/** Type guard for KimiError. */
export declare function isKimiError(error: unknown): error is KimiError;
/**
 * Build a KimiErrorPayload directly from a code + message (no Error instance
 * needed). Use this for synthetic error events that are signaled, not thrown
 * -- e.g. "turn busy" or "compaction failed". `retryable` is filled from
 * KIMI_ERROR_INFO so callers cannot drift out of sync with the registry.
 */
export declare function makeErrorPayload(code: KimiErrorCode, message: string, options?: {
    readonly details?: Record<string, unknown>;
    readonly name?: string;
}): KimiErrorPayload;
/**
 * Normalize any value into a KimiErrorPayload.
 *
 * Recognized errors:
 * - `KimiError`: passthrough.
 * - `APIStatusError`: 429 -> rate_limit, 401 -> auth_error, otherwise -> api_error.
 *   Exception: a quota-exhausted 429 maps to api_error (retryable: false) —
 *   the rate_limit code would re-mint a rate-limit error across the wire
 *   boundary and drive the swarm requeue/suspend loop, which cannot help
 *   until the account is recharged.
 * - `APIConnectionError` / `APITimeoutError`: connection_error.
 * - `ChatProviderError`: api_error.
 *
 * Anything else collapses to `internal`. We never echo `cause` or stack on
 * the wire.
 */
export declare function toKimiErrorPayload(error: unknown): KimiErrorPayload;
/**
 * Rehydrate a KimiErrorPayload into a KimiError. Used by SDK boundary code
 * receiving errors over RPC to re-surface them with a real class so
 * in-process consumers can still use `instanceof`.
 */
export declare function fromKimiErrorPayload(payload: KimiErrorPayload): KimiError;
