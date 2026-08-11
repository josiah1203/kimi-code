import type { Event } from '../../base/common/event';
import type { SessionSummary } from '../../rpc';
import type { SessionMeta } from '../../session';
import { type CompactSessionRequest, type CompactSessionResponse, type CursorQuery, type PageResponse, type Session, type SessionChildCreate, type SessionCreate, type SessionFork, type SessionStatusResponse, type SessionWarning, type SessionUpdate, type UndoSessionRequest, type UndoSessionResponse } from '@spiderbyte/protocol';
export interface SessionListQuery extends CursorQuery {
    busy?: boolean;
    workDir?: string;
    /**
     * Filter by workspace id: widens to every alias spelling of the same
     * physical root (Windows case/slash splits) and returns the union of all
     * alias buckets. Takes precedence over `workDir` when both are set.
     */
    workspaceId?: string;
    includeArchive?: boolean;
    /** When true, hide sessions the user has never interacted with (no prompt yet). */
    excludeEmpty?: boolean;
}
export interface SessionClientTelemetry {
    id?: string;
    name?: string;
    version?: string;
    uiMode?: string;
}
export interface SessionCreateOptions {
    client?: SessionClientTelemetry;
}
export interface ISessionService {
    readonly _serviceBrand: undefined;
    create(input: SessionCreate, options?: SessionCreateOptions): Promise<Session>;
    list(query: SessionListQuery): Promise<PageResponse<Session>>;
    get(id: string): Promise<Session>;
    update(id: string, input: SessionUpdate): Promise<Session>;
    fork(id: string, input: SessionFork): Promise<Session>;
    listChildren(id: string, query: SessionListQuery): Promise<PageResponse<Session>>;
    createChild(id: string, input: SessionChildCreate): Promise<Session>;
    getStatus(id: string): Promise<SessionStatusResponse>;
    getSessionWarnings(id: string): Promise<readonly SessionWarning[]>;
    compact(id: string, input: CompactSessionRequest): Promise<CompactSessionResponse>;
    undo(id: string, input: UndoSessionRequest): Promise<UndoSessionResponse>;
    archive(id: string): Promise<{
        archived: true;
    }>;
    readonly onDidCreate: Event<{
        session: Session;
    }>;
    readonly onDidClose: Event<{
        sessionId: string;
    }>;
}
export declare const ISessionService: import("../..").ServiceIdentifier<ISessionService>;
export declare class SessionUndoUnavailableError extends Error {
    readonly sessionId: string;
    constructor(sessionId: string, message?: string);
}
export declare class SessionNotFoundError extends Error {
    readonly sessionId: string;
    constructor(sessionId: string);
}
export declare function toProtocolSession(summary: SessionSummary, meta?: SessionMeta | undefined, workspaceIdOverride?: string): Session;
