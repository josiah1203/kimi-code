/**
 * `workspaces.json` file format and atomic access — the on-disk contract of
 * the known-workspaces catalog, shared by `WorkspaceRegistryService` (the
 * services-layer facade, which adds locking and events on top) and by
 * in-process runtime callers that only need a best-effort touch (e.g.
 * `KimiCore` registering the cwd on session creation). It lives next to
 * `session-index.ts` because the runtime must not import back into
 * `services/` (see `src/services/AGENTS.md`).
 *
 * The layout is the v1-compatible `{ version, workspaces, deleted_workspace_ids }`
 * document at `<homeDir>/workspaces.json`; agent-core-v2 reads and writes the
 * same file, so both engines must agree on this shape.
 */
export interface WorkspaceRegistryEntry {
    root: string;
    name: string;
    created_at: string;
    last_opened_at: string;
}
export interface WorkspaceRegistryFile {
    version: number;
    workspaces: Record<string, WorkspaceRegistryEntry>;
    /** Workspace ids the user explicitly removed. Their session buckets stay on
     *  disk, so derived workspaces (computed from the session index) must skip
     *  them to keep deletion durable. */
    deleted_workspace_ids: string[];
}
/** Diagnostic hook for malformed-content warnings; `(context, message)`. */
export type WorkspaceRegistryWarn = (context: object, message: string) => void;
/** Read `<homeDir>/workspaces.json`, tolerating a missing or malformed file
 *  (both yield an empty catalog). Unknown fields are ignored; entries failing
 *  sanitization are dropped. */
export declare function readWorkspaceRegistryFile(homeDir: string, warn?: WorkspaceRegistryWarn): Promise<WorkspaceRegistryFile>;
/** Atomically write `<homeDir>/workspaces.json` (tmp file + rename). */
export declare function writeWorkspaceRegistryFile(homeDir: string, file: WorkspaceRegistryFile): Promise<void>;
/**
 * Best-effort read-modify-write: register `root` in `<homeDir>/workspaces.json`
 * (or bump its `last_opened_at` when already present). An explicit touch clears
 * any prior deletion tombstone for the workspace id.
 *
 * Unlike `WorkspaceRegistryService.createOrTouch` this performs no
 * root-existence check and publishes no events; callers must treat failures as
 * non-fatal (the catalog is a hint, not session state). Concurrent writers in
 * other processes cannot corrupt the file (atomic rename), though a lost
 * update is possible — the next session-index merge heals missing entries.
 *
 * Identity folding matches the service: a spelling that only case/slash-differs
 * from an existing entry's root (e.g. `c:\Foo` after `C:\Foo` was added)
 * touches THAT entry instead of minting a duplicate. Without this the session
 * store's `resolveWorkspaceId` would split buckets again — the minted alias id
 * becomes the preferred id on the next create.
 */
export declare function touchWorkspaceRegistry(homeDir: string, root: string, name?: string): Promise<{
    workspaceId: string;
    created: boolean;
}>;
