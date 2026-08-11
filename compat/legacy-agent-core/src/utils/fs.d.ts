/**
 * Open a directory read-only and fsync it, then close. Used to make a
 * freshly-created or renamed file's directory entry durable.
 *
 * Windows: noop. `open(dir, 'r')` throws EISDIR, and NTFS commits the
 * dirent transaction inside the file fsync anyway — the separate dir
 * fsync would buy nothing even if we could issue it.
 */
export declare function syncDir(dirPath: string): Promise<void>;
/**
 * Synchronous variant of `syncDir`. Used by batched drain paths where a
 * single timer fire needs to be an atomic event-loop step. Windows
 * mirrors the async variant — noop.
 */
export declare function syncDirSync(dirPath: string): void;
/**
 * Write `content` to `filePath` atomically and durably:
 *   1. Write content to `<filePath>.tmp`, fsync it, close it.
 *   2. Rename `<filePath>.tmp` → `filePath` (atomic on POSIX).
 *   3. fsync the parent directory so the rename is durable.
 *
 * On any failure before the rename the `.tmp` file is removed so the
 * caller's directory is not left with a half-written leftover. A
 * failure *after* the rename (i.e. in the parent-directory fsync) is
 * surfaced to the caller — the content is already in place, but
 * durability is not guaranteed.
 */
export declare function writeFileAtomicDurable(filePath: string, content: string | Uint8Array): Promise<void>;
/**
 * Atomically write `content` to `filePath`. If the target already exists
 * it is replaced; if it does not exist it is created.
 *
 * @param filePath — absolute or relative path to the target file.
 * @param content  — string or binary payload to write.
 * @param _syncOverride — test seam: override the fsync implementation for
 *   fault injection. Production callers must never supply this.
 */
export declare function atomicWrite(filePath: string, content: string | Uint8Array, _syncOverride?: (fd: number) => Promise<void>): Promise<void>;
