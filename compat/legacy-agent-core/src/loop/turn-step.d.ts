/**
 * Executes one provider step.
 *
 * A step owns the provider call, atomic transcript envelope, streaming callback
 * wiring, tool-call lifecycle, and post-step hooks. Provider usage is recorded
 * immediately after `llm.chat` returns so a later abort during tool execution
 * does not lose model usage that was already spent.
 */
import { type TokenUsage } from '@spiderbyte/kosong';
import type { Logger } from '#/logging/types';
import type { LoopEventDispatcher } from './events';
import { type LLM, type LLMRequestTrace } from './llm';
import type { ExecutableTool, LoopHooks, LoopMessageBuilder, LoopStepStopReason, RecordStepUsageResult } from './types';
export interface ExecuteLoopStepDeps {
    readonly turnId: string;
    readonly signal: AbortSignal;
    readonly buildMessages: LoopMessageBuilder;
    /**
     * Media projection already used by `buildMessages` for this step. Defaults
     * to `normal` for direct callers. Recovery only moves forward:
     * normal -> media-degraded -> media-stripped.
     */
    readonly initialMediaProjection?: 'normal' | 'media-degraded' | 'media-stripped';
    readonly buildMessagesStrict?: LoopMessageBuilder | undefined;
    /** See RunTurnInput.buildMessagesMediaDegraded. */
    readonly buildMessagesMediaDegraded?: LoopMessageBuilder | undefined;
    /** See RunTurnInput.buildMessagesMediaStripped. */
    readonly buildMessagesMediaStripped?: LoopMessageBuilder | undefined;
    readonly dispatchEvent: LoopEventDispatcher;
    readonly llm: LLM;
    readonly tools?: readonly ExecutableTool[] | undefined;
    /**
     * Per-step tool table builder; wins over the static `tools` snapshot.
     * Evaluated after `beforeStep`, next to `buildMessages`, so the executable
     * table and the request messages reflect the same state — `beforeStep` can
     * run compaction, which discards loaded dynamic tool schemas.
     */
    readonly buildTools?: (() => readonly ExecutableTool[]) | undefined;
    /** See RunTurnInput.describeMissingTool. */
    readonly describeMissingTool?: ((name: string) => string | undefined) | undefined;
    readonly hooks?: LoopHooks | undefined;
    readonly log?: Logger | undefined;
    readonly currentStep: number;
    readonly maxRetryAttempts?: number;
    readonly recordUsage: (usage: TokenUsage) => RecordStepUsageResult | void | Promise<RecordStepUsageResult | void>;
    readonly onRequestTrace?: (trace: LLMRequestTrace) => void;
}
export declare function executeLoopStep(deps: ExecuteLoopStepDeps): Promise<{
    readonly usage: TokenUsage;
    readonly stopReason: LoopStepStopReason;
    /**
     * True when this step only succeeded after resending with the
     * media-degraded projection. The turn loop uses it to keep later steps on
     * that projection — re-sending the full-media history would pay a fresh
     * rejection on every step of the turn.
     */
    readonly mediaDegradedResendUsed?: boolean;
    /**
     * True when this step only succeeded after resending with every media
     * part stripped (image-format rejection, or a 413 that survived the
     * media-degraded resend). The turn loop keeps later steps on the stripped
     * projection for the same reason as above.
     */
    readonly mediaStrippedResendUsed?: boolean;
}>;
