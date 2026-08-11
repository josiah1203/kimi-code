/**
 * Turn-level loop for a stateless agent run.
 *
 * Owns convergence across steps: abort checks at loop boundaries, max-step
 * enforcement, usage aggregation, optional continuation after non-tool stops,
 * and final `TurnResult` mapping. One-step execution lives in `turn-step.ts`.
 */
import { type TokenUsage } from '@spiderbyte/kosong';
import type { Logger } from '#/logging/types';
import type { LoopEventDispatcher } from './events';
import type { LLM, LLMRequestTrace } from './llm';
import type { ExecutableTool, LoopHooks, LoopMessageBuilder, RecordStepUsageResult, TurnResult } from './types';
export interface RunTurnInput {
    readonly turnId: string;
    readonly signal: AbortSignal;
    readonly llm: LLM;
    readonly buildMessages: LoopMessageBuilder;
    /**
     * Optional strict, guaranteed wire-compliant rebuild of the request messages.
     * Used only to resend once after a provider rejects the normal projection with
     * a tool_use/tool_result adjacency 400 (see `executeLoopStep`).
     */
    readonly buildMessagesStrict?: LoopMessageBuilder | undefined;
    /**
     * Optional media-degraded rebuild of the request messages: old media parts
     * replaced by text markers, the most recent kept. Used to resend once after
     * the provider rejects the request body as too large (HTTP 413 on
     * accumulated media, see `executeLoopStep`); after a successful degraded
     * resend, later steps of the same turn build from this projection directly
     * so each step does not pay a fresh rejection.
     */
    readonly buildMessagesMediaDegraded?: LoopMessageBuilder | undefined;
    /**
     * Optional media-stripped rebuild of the request messages: EVERY media
     * part replaced by a text marker. Used to resend once after the provider
     * rejects an image's format, or as the final fallback when a request stays
     * too large after keeping only recent media (see `executeLoopStep`). After
     * a successful stripped resend, later steps of the same turn build from
     * this projection directly.
     */
    readonly buildMessagesMediaStripped?: LoopMessageBuilder | undefined;
    readonly dispatchEvent: LoopEventDispatcher;
    readonly tools?: readonly ExecutableTool[] | undefined;
    /**
     * Per-step tool table builder. When present it wins over `tools` and is
     * re-invoked before every step, so a tool loaded mid-turn (select_tools
     * schema injection) is dispatchable on the very next step and runtime tool
     * visibility stays fresh. `tools` remains as the
     * static per-turn snapshot for hosts without dynamic tool tables.
     */
    readonly buildTools?: (() => readonly ExecutableTool[]) | undefined;
    /**
     * Optional wording override for a tool call whose name resolves to no
     * executable tool. Lets the host distinguish "loaded but its server is
     * disconnected" from a plain unknown name under progressive disclosure.
     * Returning `undefined` keeps the default "not found" message.
     */
    readonly describeMissingTool?: ((name: string) => string | undefined) | undefined;
    readonly hooks?: LoopHooks | undefined;
    readonly log?: Logger | undefined;
    readonly maxSteps?: number | undefined;
    readonly maxRetryAttempts?: number;
    readonly recordStepUsage?: ((usage: TokenUsage) => RecordStepUsageResult | void | Promise<RecordStepUsageResult | void>) | undefined;
    readonly onRequestTrace?: (trace: LLMRequestTrace) => void;
}
export declare function runTurn(input: RunTurnInput): Promise<TurnResult>;
