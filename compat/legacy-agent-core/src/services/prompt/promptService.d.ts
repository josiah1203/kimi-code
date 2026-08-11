/**
 * `PromptService` — implementation of `IPromptService`.
 */
import { Disposable } from '../../di';
import type { PromptListResponse, PromptSubmission, PromptSteerResult, PromptSubmitResult } from '@spiderbyte/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IAuthSummaryService } from '../authSummary/authSummary';
import { IEventService } from '../event/event';
import { ILogService } from '../logger/logger';
import { ISessionService } from '../session/session';
import { IPromptService, type AgentStatePatch, type AgentStateSnapshot, type AgentStateSource, type PromptAbortResult, type PromptDispatchLogEntry, type SyntheticPromptCompletedEvent, type SyntheticPromptAbortedEvent } from './prompt';
/**
 * Per-session "active prompt" state. Cleared on completion/abort.
 *
 * `turnId === null` when the prompt has been submitted but the first
 * `turn.started` hasn't arrived yet (the RPC pair queues calls before
 * `ready()` so the gap is small but non-zero in practice).
 *
 * `terminal === true` is set when `turn.ended` arrives — we keep the record
 * around so abort-on-already-completed surfaces as 40903, not 40402.
 */
interface PromptState {
    agentId: string;
    promptId: string;
    userMessageId: string;
    body: PromptSubmission;
    createdAt: string;
    turnId: number | null;
    /** Set on `turn.ended` for the top-level turn (reason='completed'|'failed'|'blocked'). */
    completed: boolean;
    /** Set on `turn.ended` with reason='cancelled' or after a successful abort RPC. */
    aborted: boolean;
}
/**
 * Per-session shadow of `model` / `thinking` / `permissionMode` /
 * `planMode`. Type re-exported from `./prompt` so the daemon debug route
 * can consume it without reaching into `PromptService` internals.
 * Absent until first `submit` bootstraps. See `_bootstrapAgentState` +
 * `_applyAgentState`.
 */
export declare class PromptService extends Disposable implements IPromptService {
    private readonly core;
    private readonly eventService;
    private readonly auth;
    private readonly sessionService;
    private readonly _logger;
    readonly _serviceBrand: undefined;
    /** Active prompt per session. Cleared on completion / abort emission. */
    private readonly _active;
    private readonly _queued;
    /**
     * Per-session shadow of `model` / `thinking` / `permissionMode` /
     * `planMode`. Absent until first `submit` bootstraps. See
     * `_bootstrapAgentState` + `_applyAgentState`.
     */
    private readonly _agentState;
    /**
     * Per-session ring buffer of stateless-control setter dispatches.
     * Each entry records `{ts, kind, payload, promptId}` immediately after
     * the underlying `core.rpc.*` setter resolves inside `_applyAgentState`.
     * The buffer is capped at `DISPATCH_LOG_CAP`; on overflow the oldest
     * entry is dropped. Cleared on `ISessionService.onDidClose` together
     * with the shadow. Exposed via `_dispatchLogForTest` for the daemon's
     * `/debug/prompts/{sid}/dispatch-log` route + unit tests — never read
     * on the hot path.
     */
    private readonly _dispatchLog;
    /**
     * VSCode-style Emitter for `prompt.completed` synthetic events. Listener
     * exceptions route to `onUnexpectedError` inside `Emitter.fire()`. Owned
     * via `_register(...)` so it disposes when PromptService is torn down.
     */
    private readonly _onDidComplete;
    readonly onDidComplete: import("../../base/common/event").Event<SyntheticPromptCompletedEvent>;
    /**
     * VSCode-style Emitter for `prompt.aborted` synthetic events. Same
     * ownership + exception-routing semantics as `_onDidComplete`.
     */
    private readonly _onDidAbort;
    readonly onDidAbort: import("../../base/common/event").Event<SyntheticPromptAbortedEvent>;
    constructor(core: ICoreProcessService, eventService: IEventService, auth: IAuthSummaryService, sessionService: ISessionService, _logger: ILogService);
    list(sid: string): Promise<PromptListResponse>;
    submit(sid: string, body: PromptSubmission): Promise<PromptSubmitResult>;
    startBtw(sid: string): Promise<string>;
    steer(sid: string, promptIds: readonly string[]): Promise<PromptSteerResult>;
    private _startPrompt;
    private _publishSubmitted;
    private _publishAborted;
    abort(sid: string, pid: string): Promise<PromptAbortResult>;
    abortBySession(sid: string): Promise<PromptAbortResult>;
    getCurrentPromptId(sid: string): string | undefined;
    /**
     * `IPromptService.applyAgentState` — entry point shared by
     * `submit` (per-turn override) and `SessionService.update`
     * (`POST /sessions/{sid}/profile`). Validates the session exists,
     * bootstraps the shadow lazily, then diff-dispatches each non-shadow
     * field through the matching `core.rpc.*` setter. Dispatch-log
     * entries are tagged with the `source` so downstream observers can
     * tell prompt-driven and profile-driven setters apart.
     *
     * No-op when every field matches the shadow; throws on setter failure
     * (the caller / route layer surfaces the error). Empty `patch` is
     * accepted and bootstraps nothing — useful for SessionService.update
     * paths that need to no-op cleanly when the body carries no runtime
     * controls.
     */
    applyAgentState(sid: string, patch: AgentStatePatch, source: AgentStateSource, promptId?: string): Promise<void>;
    /**
     * Seed the per-session shadow from `getConfig` / `getPermission` /
     * `getPlan` if not yet bootstrapped. Idempotent across submits within a
     * session lifetime; cleared on `ISessionService.onDidClose`.
     *
     * The three RPCs run in parallel — they share no preconditions.
     */
    private _ensureAgentStateBootstrapped;
    /**
     * Diff-dispatch: for each of the four controls present on `patch`,
     * call the matching `core.rpc.*` setter ONLY when the value differs
     * from the shadow. Each setter runs serially so any failure surfaces
     * to the caller. Each successful setter also appends to the per-session
     * dispatch-log ring buffer; absence of an entry between two prompts is
     * the proof that the shadow suppressed a redundant dispatch.
     *
     * Pre-condition: `_ensureAgentStateBootstrapped(sid)` already ran (the
     * shadow Map carries `sid`). Callers must guard.
     */
    private _applyAgentStateInternal;
    /**
     * Append a dispatch entry to the per-session ring buffer, evicting the
     * oldest entry when the cap is hit. Called only from
     * `_applyAgentStateInternal` after the underlying setter resolves
     * successfully.
     */
    private _recordDispatch;
    private _handleBusEvent;
    /**
     * Test helper — peek at active prompt state.
     */
    _activeForTest(sid: string): Readonly<PromptState> | undefined;
    /**
     * Read the current runtime-controls shadow for a session, if it has been
     * bootstrapped. Returns a copy so callers cannot mutate internal state.
     */
    getAgentStateSnapshot(sid: string): AgentStateSnapshot | undefined;
    /**
     * Test helper — peek at the per-session stateless-controls shadow.
     * Undefined before first submit on a session.
     */
    _agentStateForTest(sid: string): Readonly<AgentStateSnapshot> | undefined;
    /**
     * Test / debug helper — return the per-session dispatch-log ring buffer
     * (newest-last). Returns `undefined` when the session has never
     * triggered a setter; an empty array means "saw submits but every
     * field matched the shadow". The daemon's `/debug/prompts/{sid}/dispatch-log`
     * route consumes this; unit tests assert against it directly.
     */
    _dispatchLogForTest(sid: string): readonly PromptDispatchLogEntry[] | undefined;
    /**
     * Test helper — inject an active prompt record. Used by daemon e2e tests
     * that need to exercise the lifecycle-synthesis path WITHOUT driving a
     * real `core.rpc.prompt(...)` call (which would require an in-memory
     * KimiCore loaded with provider credentials). Not part of the public
     * contract; the underscore prefix is a "do not use in prod" signal.
     */
    _injectActiveForTest(sid: string, promptId: string, turnId: number | null): void;
    private _createPromptState;
    private _enqueue;
    private _replaceQueue;
    private _restoreSteeredQueueItems;
    private _startNextQueued;
    private _requireSession;
    dispose(): void;
}
export {};
