import { Disposable } from '../../di';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';
import type { Workspace } from '@spiderbyte/protocol';
import { ILogService } from '../logger/logger';
import { IWorkspaceRegistry, type WorkspacePatch } from './workspaceRegistry';
import { type WorkspaceRegistryEntry } from '../../session/store/workspace-registry-file';
/**
 * Pure scan over registry entries: the id whose root identity-matches
 * `rootKey` (see `workspaceRootKey`), or undefined. When several entries
 * identity-match (e.g. a legacy-alias id plus a canonical one for the same
 * folder), `preferredId` wins when present — callers pass the id the current
 * code would mint for the query root, so post-scan behavior stays consistent
 * with a fresh `encodeWorkDirKey`. Otherwise the first entry in file order
 * wins. Extracted so the identity-reuse rule is unit-testable without fs.
 */
export declare function findRegisteredIdByRootKey(workspaces: Record<string, WorkspaceRegistryEntry>, rootKey: string, preferredId?: string): string | undefined;
export declare class WorkspaceRegistryService extends Disposable implements IWorkspaceRegistry {
    private readonly logger;
    private readonly eventService;
    readonly _serviceBrand: undefined;
    private readonly homeDir;
    private readonly sessionsDir;
    private opQueue;
    constructor(env: IEnvironmentService, logger: ILogService, eventService: IEventService);
    list(): Promise<Workspace[]>;
    get(workspaceId: string): Promise<Workspace>;
    createOrTouch(root: string, name?: string): Promise<Workspace>;
    update(workspaceId: string, patch: WorkspacePatch): Promise<Workspace>;
    delete(workspaceId: string): Promise<void>;
    resolveRoot(workspaceId: string): Promise<string>;
    findWorkspaceIdByRoot(root: string): Promise<string | undefined>;
    resolveAliasWorkDirs(workspaceId: string): Promise<readonly string[]>;
    /**
     * Alias workDir spellings plus the session buckets that can hold sessions
     * for the same physical root as `workspaceId` — or undefined when the id is
     * unknown to both the registry and the session index. The bucket set is the
     * union of both placement eras: every registered id for the root (sessions
     * created with a wired bucket resolver land there, including legacy alias
     * ids that no longer match a fresh `encodeWorkDirKey(root)` mint) and each
     * spelling's own minted bucket (pre-resolver split, never rewritten).
     */
    private aliasLayout;
    /**
     * Active-session count across ALL alias buckets for the workspace's root,
     * not just the id's own bucket: GET /sessions?workspace_id=<id> pages the
     * union of alias buckets, so the count aggregates the same set the list can
     * actually retrieve.
     */
    private countAliasSessions;
    /** Look up a derived workspace's workDir from the session index, or undefined
     *  if the id is not a known derived bucket. */
    private findDerivedWorkDir;
    private hydrate;
    private publishWorkspace;
    private readRegistry;
    private writeRegistry;
    private runExclusive;
    dispose(): void;
}
export declare function userHomeDir(): string;
export declare const pathDirname: (path: string) => string;
