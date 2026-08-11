import { type ContentPart } from '@spiderbyte/kosong';
import type { Agent } from '..';
import { type LoopTurnStopReason } from '../../loop/index';
import type { TurnEndedEvent } from '../../rpc';
import { type PromptOrigin } from '../context';
export interface TurnEndResult {
    readonly event: TurnEndedEvent;
    readonly stopReason?: LoopTurnStopReason;
    readonly blockedByUserPromptHook?: boolean;
}
export declare class TurnFlow {
    protected readonly agent: Agent;
    private steerBuffer;
    private turnId;
    private activeTurn;
    private readonly toolCallStartedAt;
    private readonly toolCallDupType;
    private readonly stepToolCallKeys;
    private readonly telemetryModeByTurn;
    private readonly currentStepByTurn;
    private readonly interruptedTelemetryTurnIds;
    private readonly interruptedTraceIdByTurn;
    private readonly stepFailureByTurn;
    private activeRequestTrace;
    private latestTraceId;
    private currentStep;
    constructor(agent: Agent);
    /** Best-effort agent id (main / generated id) derived from the agent homedir. */
    private get agentId();
    prompt(input: readonly ContentPart[], origin?: PromptOrigin): number | null;
    steer(input: readonly ContentPart[], origin?: PromptOrigin): number | null;
    retry(trigger?: string): number | null;
    private launch;
    /** Allocates the next monotonic turn id. */
    private allocateTurnId;
    restorePrompt(): void;
    /**
     * Raise the turn counter to cover a turnId observed in a replayed loop event.
     * This is the authoritative source of the restored counter: every turn that
     * ran — a prompted turn, a goal continuation, or a steer-launched turn —
     * emits loop events carrying its real turnId, even though only prompted turns
     * write a `turn.prompt` record. Resuming then continues from `max + 1`. Only
     * ever raises the counter, never lowers it, so the live path (where `turnId`
     * is already allocated before any loop event) is unaffected.
     */
    observeRestoredTurnId(turnId: number): void;
    restoreSteer(input: readonly ContentPart[], origin: PromptOrigin): void;
    cancel(turnId?: number, reason?: unknown): void;
    get currentId(): number;
    activeRequestTraceId(): string | undefined;
    get hasActiveTurn(): boolean;
    private ensureActiveTurn;
    waitForCurrentTurn(signal?: AbortSignal | undefined): Promise<TurnEndResult>;
    waitForTurnFirstRequest(): Promise<void>;
    private abortTurn;
    private flushSteerBuffer;
    /**
     * Replay inputs (prompts or steers) that were deferred while a manual compaction
     * held the context. Called by `FullCompaction` once the compaction lifecycle
     * (summary + reinjection) is done — and on cancel/failure — so deferred input is
     * never lost or stuck. If a turn is somehow already active (e.g. one that raced
     * and cancelled the compaction), let it consume the buffer like any other steer;
     * otherwise launch a fresh turn from the first buffered item, with the rest
     * draining into it via `flushSteerBuffer`.
     */
    onCompactionFinished(): void;
    finishResume(): void;
    /**
     * The body of the single in-flight `activeTurn`. Routes to the goal driver
     * (sequential continuation turns) when a goal is active, otherwise runs exactly
     * one turn. Clears `activeTurn` when the whole run finishes (identified by the
     * launch signal, so a superseding turn is never clobbered).
     */
    private turnWorker;
    /**
     * Drives an active goal as a sequence of ordinary turns — the autonomous
     * equivalent of the user repeatedly typing "continue". Each iteration runs one
     * full turn, then reads the goal status the model set via `UpdateGoal`:
     * `complete` (the record is cleared) / `blocked` stop the loop; `active`
     * (the model didn't decide) re-injects the goal reminder and runs the
     * next continuation turn. Aborted or failed turns pause the goal — except a
     * turn that only failed by reaching the per-turn step limit, which just
     * fragments goal work into more continuation turns. Goal-state
     * blockers, such as explicit `UpdateGoal('blocked')`, prompt-hook blocks, and
     * budget limits, block it (all resumable). Returns the final turn's result.
     */
    private driveGoal;
    private endGoalTurnWithoutModel;
    /**
     * Runs exactly one logical turn end to end: per-turn bookkeeping, `turn.started`,
     * the prompt + goal reminder, the step loop, and `turn.ended`. Goal-agnostic —
     * the driver layers goal semantics on top. Never throws; abnormal ends are
     * mapped to a `cancelled`/`failed` `turn.ended` and returned.
     */
    private runOneTurn;
    private applyUserPromptHook;
    private runStepLoop;
    private closeAbandonedToolExchange;
    private buildDispatchEvent;
    private noteFirstRequestEvent;
    private trackLoopTelemetry;
    private beginTrackedStep;
    private trackToolLifecycle;
    private trackDuplicateToolCall;
    private hasPriorStepToolCallKey;
    private trackTurnInterrupted;
    private telemetryMode;
    /**
     * Resolve the current model's provider wire type and any model-level protocol
     * override for request telemetry. Never throws — telemetry must not break a
     * turn over an unresolvable provider config (the step loop will surface that
     * error on its own).
     */
    private requestProtocolProps;
    private shouldTrackApiError;
}
/**
 * Resolve the effective per-turn step cap. Precedence:
 * `KIMI_LOOP_MAX_STEPS_PER_TURN` (non-negative integer) → config
 * (`loop_control.max_steps_per_turn`) → `undefined` (no cap). `0` means no
 * cap, same as the config field; an invalid env value is ignored.
 */
export declare function resolveMaxStepsPerTurn(configValue?: number): number | undefined;
/**
 * Resolve the effective per-step retry budget. Precedence:
 * `KIMI_LOOP_MAX_RETRIES_PER_STEP` (non-negative integer) → config
 * (`loop_control.max_retries_per_step`) → `undefined` (the loop's built-in
 * default). An invalid env value is ignored.
 */
export declare function resolveMaxRetriesPerStep(configValue?: number): number | undefined;
