import type { JsonObject, ListSessionsPayload, SessionSummary } from '#/rpc/core-api';
export interface CreateSessionRecordInput {
    readonly id: string;
    readonly workDir: string;
}
export interface ForkSessionRecordInput {
    readonly sourceId: string;
    readonly targetId: string;
    readonly title?: string;
    readonly metadata?: JsonObject;
    readonly turnIndex?: number;
}
export type SessionStoreOptions = {
    /**
     * Optional identity hook (wired by the services layer from the workspace
     * registry): the already-registered workspace id for the same physical root
     * as `workDir`, or undefined when no entry matches. Bucket derivation
     * prefers it over minting a fresh `encodeWorkDirKey` hash, so a session
     * created from a case/slash variant of a registered Windows root lands in
     * the registered bucket instead of splitting into a second one.
     */
    readonly resolveWorkspaceId?: (workDir: string) => Promise<string | undefined>;
};
export declare class SessionStore {
    readonly homeDir: string;
    readonly sessionsDir: string;
    private readonly resolveWorkspaceId;
    constructor(homeDir: string, options?: SessionStoreOptions);
    sessionDirFor(input: {
        readonly id: string;
        readonly workDir: string;
    }): string;
    /**
     * Bucket key for a workDir: asks the workspace registry (when wired) for the
     * registered id of the same physical root — see SessionStoreOptions — and
     * prefers it over the freshly minted `encodeWorkDirKey` hash. Falls back to
     * minting when the resolver is absent, errors, or returns an id that is not
     * a safe bucket name (registry contents are user-editable state; minted ids
     * always pass `isSafeSessionId`).
     */
    private bucketKeyFor;
    /** Like `sessionDirFor`, but under the registry-resolved bucket. */
    private resolvedSessionDirFor;
    /** Bucket directory for a workDir, registry-resolved when possible. */
    private bucketDirFor;
    create(input: CreateSessionRecordInput): Promise<SessionSummary>;
    fork(input: ForkSessionRecordInput): Promise<SessionSummary>;
    get(id: string): Promise<SessionSummary>;
    rename(id: string, title: string): Promise<void>;
    archive(id: string): Promise<SessionSummary>;
    delete(id: string): Promise<void>;
    list(options?: ListSessionsPayload): Promise<readonly SessionSummary[]>;
    /**
     * Rebuild the global session index from the session directories on disk.
     *
     * The bucket directory name is a one-way hash of the workDir, so the workDir
     * can only be recovered from each session's self-describing `state.json`
     * (`workDir`, falling back to `custom.cwd` for older sessions). Sessions that
     * record no workDir, or whose recorded workDir does not match the bucket they
     * live in, are left untouched rather than writing a misleading entry.
     *
     * The index is append-only and `readSessionIndex` lets later lines override
     * earlier ones for the same id, so appending a corrected line both adds
     * missing entries and repairs stale ones. Best-effort: never throws.
     */
    reindex(): Promise<{
        scanned: number;
        added: number;
        repaired: number;
    }>;
    private recoverWorkDir;
    private listWorkDir;
    private listSessionId;
    private listAll;
    private summaryFromWorkDirSession;
    assertDirectory(id: string): Promise<string>;
    private findSessionEntry;
    private findExistingSessionEntry;
    private writeForkedState;
    private summaryFromDir;
}
