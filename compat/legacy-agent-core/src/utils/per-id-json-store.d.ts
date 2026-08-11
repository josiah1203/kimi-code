/**
 * Per-id JSON record store — write each value as `<rootDir>/<subdir>/<id>.json`.
 *
 * Hoisted out of `tools/background/persist.ts` so cron / background / any
 * future "session-scoped, per-id, small-JSON" persistence can share the
 * same atomic-write + path-traversal-guarded readdir loop. The store has
 * no opinion on `T` — callers supply an id regex (also the basename
 * validator) and may optionally supply a cheap shape guard for ignoring
 * incompatible files on `list()`.
 *
 * Crash safety: writes go through `atomicWrite` (write-tmp, fsync,
 * rename) so a kill mid-write never leaves a torn file. `list()`
 * silently drops basenames that don't match `idRegex`, files that fail
 * to read, JSON parse errors, and values that fail `isValid` when a
 * validator is supplied — the caller wants "everything that's safely
 * loadable", not a partial throw.
 *
 * Not concurrent-process-safe by itself: two CLI processes writing to
 * the same id will race on the rename. We accept this because the
 * session model already assumes one live process per session at a time
 * (resume kills the previous).
 */
export interface PerIdJsonStore<T> {
    /**
     * Atomically write `value` to `<rootDir>/<subdir>/<id>.json`. Creates
     * the subdir on demand. Throws if `id` doesn't match `idRegex`
     * (path-traversal guard fires before any FS call) or if the write
     * itself fails.
     */
    write(id: string, value: T): Promise<void>;
    /**
     * Read a single record. Returns `undefined` for missing files,
     * unreadable files, parse errors, or values that fail `isValid` when
     * a validator is supplied. Throws only for an invalid id
     * (path-traversal guard).
     */
    read(id: string): Promise<T | undefined>;
    /**
     * Enumerate every record in the subdir whose basename matches
     * `idRegex` and, when a validator is supplied, whose parsed content
     * satisfies `isValid`. Silently drops everything else (corrupt JSON,
     * stray files, partial writes).
     */
    list(): Promise<readonly T[]>;
    /**
     * Idempotently delete `<rootDir>/<subdir>/<id>.json`. ENOENT is not an
     * error. Throws for an invalid id or any other FS failure.
     */
    remove(id: string): Promise<void>;
}
export interface PerIdJsonStoreOptions<T> {
    /** Session-scoped root directory (e.g. the agent's homedir). */
    readonly rootDir: string;
    /** Per-feature leaf directory under `rootDir` (e.g. `'cron'`, `'tasks'`). */
    readonly subdir: string;
    /**
     * Strict id shape. Doubles as the path-traversal guard — anything
     * with `..` / `/` / a stray dot is rejected by the regex before the
     * filename hits the filesystem.
     */
    readonly idRegex: RegExp;
    /**
     * Optional cheap structural validator. Run on every parsed JSON value;
     * failing values are silently dropped from `list()` (and `read()`
     * returns `undefined`). Should be inexpensive — it runs once per file
     * per `list()`.
     */
    readonly isValid?: (obj: unknown) => obj is T;
    /**
     * Human-readable name used in path-traversal rejection errors —
     * `Invalid <entityName>: "<id>"`. Lets each caller preserve its own
     * pre-refactor wording (`'task id'`, `'cron job id'`, ...) so error
     * messages stay stable across the abstraction. Defaults to `'id'`.
     */
    readonly entityName?: string;
}
export declare function createPerIdJsonStore<T>(opts: PerIdJsonStoreOptions<T>): PerIdJsonStore<T>;
