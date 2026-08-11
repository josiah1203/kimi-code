import type { TelemetryClient } from '../../telemetry';
import type { LLMRequestTrace } from '../../loop/llm';
import type { ExecutableToolResult } from '../../loop/types';
declare function makeReminderText2(repeatCount: number): string;
/**
 * Detects and suppresses repetitive tool calls within a single turn.
 *
 * Two behaviours are layered:
 * - Same-step dedup: a duplicate `(toolName, args)` issued in the same LLM step
 *   reuses the original call's result instead of executing the tool twice.
 * - Cross-step dedup: when the exact same call is repeated consecutively
 *   across steps, the result returned to the model is suffixed with a system
 *   reminder once the streak hits 3. The reminder escalates as the streak
 *   grows: r1 (expectation-setting nudge) from streak 3, r2 (forced decision
 *   menu) from streak 5, r3 (final hand-off instruction) from streak 8. From streak 12
 *   onward the turn is force-stopped via `{ stopTurn: true }` so the loop
 *   cannot keep spinning on the same call. Force-stop does not flip a
 *   successful tool result into an error — the underlying tool's `isError`
 *   is preserved.
 *
 * Telemetry: every finalized original call with streak >= 2 emits a
 * `tool_call_repeat` event carrying the current streak count as `repeat_count`
 * along with the tool name and which action was taken (none/r1/r2/r3/stop).
 */
export declare class ToolCallDeduplicator {
    private stepDeferreds;
    private stepCalls;
    private originalCallIndex;
    private syntheticCallIds;
    /**
     * Records the dedup key used at `checkSameStep` time, keyed by `toolCallId`.
     * The loop is allowed to rewrite args between `prepareToolExecution` and
     * `finalizeToolResult` via `PrepareToolExecutionResult.updatedArgs`, so the
     * `(toolName, args)` pair available at finalize may differ from what was
     * registered. We pin the key at registration time and look it up by call id
     * during finalize.
     */
    private callKeyByCallId;
    private consecutiveKey;
    private consecutiveCount;
    private readonly telemetry;
    private requestTrace;
    constructor(options?: {
        readonly telemetry?: TelemetryClient | undefined;
    });
    beginStep(trace?: LLMRequestTrace): void;
    endStep(): void;
    /**
     * Called from `prepareToolExecution`. If this `(toolName, args)` was already
     * seen in the current step, returns a placeholder result so the loop can
     * skip executing the tool again; the real result is patched in during
     * `finalizeResult`. Returns `null` for the first occurrence so the normal
     * execution path proceeds.
     *
     * This method is intentionally synchronous to avoid deadlocking the prepare
     * loop on a deferred that only resolves in the finalize phase.
     */
    checkSameStep(toolCallId: string, toolName: string, args: unknown): ExecutableToolResult | null;
    /**
     * Register a call that bypassed `prepareToolExecution` — e.g. args
     * validation rejected it in preflight, so the prepare hook never ran. Must
     * be called before `finalizeResult` for such calls, otherwise the repeat
     * circuit breaker never counts rejected calls and the model can re-issue
     * the same invalid call without ever tripping the streak. No-op when the
     * call was already registered through the normal prepare path.
     *
     * `rawArguments` is the provider's raw arguments string. Args that failed
     * JSON parsing were normalized to `{}` by the loop, which would key every
     * malformed-but-different attempt identically; those are keyed on the raw
     * text so only true re-issues count as repeats.
     */
    registerSkipped(toolCallId: string, toolName: string, args: unknown, rawArguments?: string | null): void;
    /**
     * Called from `finalizeToolResult`, in provider order. For first-occurrence
     * calls, projects the consecutive streak ending at this call and, if the
     * threshold is reached, appends the system reminder, then resolves the
     * deferred so subsequent same-step dups can fetch the real result. For
     * synthetic duplicates, awaits the original's deferred and returns its
     * value, discarding the placeholder.
     */
    finalizeResult(toolCallId: string, toolName: string, args: unknown, result: ExecutableToolResult): Promise<ExecutableToolResult>;
}
export declare const __testing: {
    REMINDER_TEXT_1: string;
    REMINDER_TEXT_3: string;
    makeReminderText2: typeof makeReminderText2;
    REPEAT_REMINDER_1_START: number;
    REPEAT_REMINDER_2_START: number;
    REPEAT_REMINDER_3_START: number;
    REPEAT_FORCE_STOP_STREAK: number;
};
export {};
