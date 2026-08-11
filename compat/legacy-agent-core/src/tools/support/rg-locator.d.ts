/**
 * rg-locator — hybrid ripgrep binary resolution.
 *
 * Lookup order (first hit wins):
 *   1. System PATH (`which rg`) — fastest, respects developer setup
 *   2. Bundled vendor binary (hook; not wired yet — `getVendorRgPath` is a stub)
 *   3. `<KIMI_CODE_HOME>/bin/rg` — persistent cache for this app.
 *   4. CDN download to <KIMI_CODE_HOME>/bin/ — one-off bootstrap
 *
 * If steps 1-4 all fail, callers receive a structured error they can
 * turn into a user-facing "install ripgrep" hint instead of the naked
 * `spawn rg ENOENT`.
 */
export type RgResolutionSource = 'system-path' | 'vendor' | 'share-bin-cached' | 'share-bin-downloaded';
export interface RgResolution {
    readonly path: string;
    readonly source: RgResolutionSource;
}
export interface EnsureRgPathOptions {
    readonly shareDir?: string | undefined;
    /**
     * Cancels this caller's wait. A shared bootstrap download that is already in
     * progress may continue so other callers can still use the same result.
     */
    readonly signal?: AbortSignal | undefined;
}
/**
 * Resolve the absolute path to a usable `rg` binary, downloading it
 * into `<shareDir>/bin/` if necessary. Multiple concurrent callers are
 * serialized by a module-level lock so the download happens at most
 * once per process.
 */
export declare function ensureRgPath(options?: EnsureRgPathOptions): Promise<RgResolution>;
/**
 * Pure-lookup variant for test harnesses that want to assert on the
 * resolution order without triggering a real download.
 */
export declare function findExistingRg(shareDir: string): Promise<RgResolution | undefined>;
/** @internal for tests — rust-style `<arch>-<vendor>-<os>` target triple. */
export declare function detectTarget(): string | undefined;
/** @internal for tests — fail closed before extracting downloaded bytes. */
export declare function verifyArchiveChecksum(archivePath: string, archiveName: string, expectedSha256: string): Promise<void>;
/**
 * Read the downloaded `.zip` at `archivePath`, find the `rg.exe` entry
 * (basename match), and stream it out to `destination`. Throws with
 * the shared "CDN content may have
 * changed" sentinel when the archive holds no matching entry — same
 * failure semantics as the tar.gz path's `existsSync(extracted)` gate
 * so callers see a single actionable message.
 */
export declare function extractRgFromZip(archivePath: string, destination: string): Promise<void>;
/**
 * User-facing error message to show when `ensureRgPath` throws. Kept
 * in one place so the Grep / Glob / Bash plumbing can reuse it.
 */
export declare function rgUnavailableMessage(cause: unknown): string;
