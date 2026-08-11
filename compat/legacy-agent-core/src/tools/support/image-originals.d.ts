/**
 * Content-addressed store for pre-compression image originals.
 *
 * When an ingestion point (MCP tool result, pasted image, inline base64
 * upload) compresses an image that exists only in memory, the original bytes
 * would be gone for good — the model could never zoom into a detail the
 * downsampled copy lost. This module persists those originals so the
 * compression caption can point at a real path the model can read back with
 * `ReadMediaFile` (typically with `region`).
 *
 * Placement: callers that know their session pass
 * `{ dir: sessionMediaOriginalsDir(sessionDir) }` so originals live at
 * `<sessionDir>/media-originals/` — owned by the session, cleaned up with it,
 * and immune to OS temp reaping. The shared temp-dir cache
 * ({@link originalImageCacheDir}) is only the fallback for call sites with no
 * session context.
 *
 * Design notes:
 *  - Content-addressed (sha256): duplicate pastes/results reuse one file and
 *    repeated writes are idempotent.
 *  - Best effort: any filesystem failure returns null; callers then emit a
 *    caption without a readback path. Persistence must never block a prompt.
 *  - Size-capped: after each write the store is swept oldest-first (mtime)
 *    until it fits {@link DEFAULT_MAX_TOTAL_BYTES}, so long sessions cannot
 *    fill the disk.
 */
export interface PersistOriginalImageOptions {
    /**
     * Target directory — pass `sessionMediaOriginalsDir(sessionDir)` when the
     * session is known. Defaults to the shared temp-dir fallback.
     */
    readonly dir?: string;
    /** Override the store size cap in bytes (tests). */
    readonly maxTotalBytes?: number;
}
/**
 * Fallback store used when a call site has no session context:
 * `<os-tmp>/kimi-code-original-images`.
 */
export declare function originalImageCacheDir(): string;
/**
 * The session-owned originals store: `<sessionDir>/media-originals`. Sits
 * next to the session's other artifacts (`tasks/`, `cron/`, `logs/`,
 * `agents/`) and is removed with the session.
 */
export declare function sessionMediaOriginalsDir(sessionDir: string): string;
/**
 * Persist `bytes` into the originals store and return the absolute file
 * path, or null on any failure. Idempotent for identical bytes.
 */
export declare function persistOriginalImage(bytes: Uint8Array, mimeType: string, options?: PersistOriginalImageOptions): Promise<string | null>;
