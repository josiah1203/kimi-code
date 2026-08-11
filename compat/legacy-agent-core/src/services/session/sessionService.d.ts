import { Disposable, IInstantiationService } from '../../di';
import { type CompactSessionRequest, type CompactSessionResponse, type PageResponse, type Session, type SessionChildCreate, type SessionCreate, type SessionFork, type SessionStatusResponse, type SessionUpdate, type SessionWarning, type UndoSessionRequest, type UndoSessionResponse } from '@spiderbyte/protocol';
import { IApprovalService } from '../approval/approval';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEventService } from '../event/event';
import { IQuestionService } from '../question/question';
import { IWorkspaceRegistry } from '../workspace/workspaceRegistry';
import { ISessionService, type SessionCreateOptions, type SessionListQuery } from './session';
export declare class SessionService extends Disposable implements ISessionService {
    private readonly core;
    private readonly eventService;
    private readonly instantiation;
    private readonly approvalService;
    private readonly questionService;
    private readonly workspaceRegistry;
    readonly _serviceBrand: undefined;
    private readonly _onDidCreate;
    readonly onDidCreate: import("../../base/common/event").Event<{
        session: Session;
    }>;
    private readonly _onDidClose;
    readonly onDidClose: import("../../base/common/event").Event<{
        sessionId: string;
    }>;
    private readonly _workFactsBySession;
    private readonly _activeTurns;
    /** MAIN-agent latest turn outcome per session — an orthogonal wire fact
     *  clients may present as an "aborted" tag (busy=false + cancelled/failed). */
    private readonly _lastTurnReasonBySession;
    private _promptService;
    constructor(core: ICoreProcessService, eventService: IEventService, instantiation: IInstantiationService, approvalService: IApprovalService, questionService: IQuestionService, workspaceRegistry: IWorkspaceRegistry);
    private get promptService();
    /**
     * Compute the orthogonal work and interaction facts projected onto the wire.
     */
    private _computeWorkFacts;
    /**
     * Overwrite the placeholders on a protocol Session with live facts and
     * remember them so work-change events fire only on real transitions.
     */
    private _patchSessionStatus;
    /**
     * Publish `event.session.work_changed` when any projected fact changes.
     */
    private _emitStatusChanged;
    private _handleBusEvent;
    create(input: SessionCreate, options?: SessionCreateOptions): Promise<Session>;
    list(query: SessionListQuery): Promise<PageResponse<Session>>;
    get(id: string): Promise<Session>;
    update(id: string, input: SessionUpdate): Promise<Session>;
    fork(id: string, input: SessionFork): Promise<Session>;
    listChildren(id: string, query: SessionListQuery): Promise<PageResponse<Session>>;
    createChild(id: string, input: SessionChildCreate): Promise<Session>;
    private emitCreated;
    getStatus(id: string): Promise<SessionStatusResponse>;
    getSessionWarnings(id: string): Promise<readonly SessionWarning[]>;
    compact(id: string, input: CompactSessionRequest): Promise<CompactSessionResponse>;
    undo(id: string, input: UndoSessionRequest): Promise<UndoSessionResponse>;
    archive(id: string): Promise<{
        archived: true;
    }>;
    private requireSummary;
    private tryGetMeta;
    /**
     * Summary universe for a list query. A workspace filter widens to every
     * alias spelling of the same physical root: pre-resolver legacy splits
     * parked sessions in parallel buckets that a single workDir query cannot
     * reach — the store resolves a spelling of a registered root back onto the
     * registered bucket, hiding the split one. The index-wide list is filtered
     * by identity key instead. Read-only: buckets and the index stay untouched.
     */
    private listSummaries;
    /**
     * Registered workspace id for the wire projection, when a registry entry
     * identity-matches the session's workDir (case/slash variants of one
     * Windows directory fold). Falls back to undefined — the projection then
     * mints the key itself, the pre-resolver behavior.
     */
    private tryResolveWorkspaceId;
    dispose(): void;
}
