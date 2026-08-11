/**
 * Tool-call lifecycle for one completed provider response.
 *
 * This module keeps the provider-order invariant in one place:
 *   - validate every provider tool call before hooks or events
 *   - run preparation hooks and compute tool-call display fields in provider order
 *   - dispatch `tool.call` before execution starts
 *   - execute tools with non-conflicting resource accesses concurrently
 *   - serialize tools whose resource accesses conflict
 *   - dispatch terminal `tool.result` events in provider order
 *
 * These phases are coupled by transcript ordering and abort handling, so they
 * should be reviewed together.
 */
import type { Logger } from '#/logging/types';
import type { LoopEventDispatcher } from './events';
import type { LLM, LLMChatResponse, LLMRequestTrace } from './llm';
import type { ExecutableTool, LoopHooks } from './types';
export interface ToolCallStepContext {
    readonly tools?: readonly ExecutableTool[] | undefined;
    /** See RunTurnInput.describeMissingTool. */
    readonly describeMissingTool?: ((name: string) => string | undefined) | undefined;
    readonly hooks?: LoopHooks | undefined;
    readonly log?: Logger | undefined;
    readonly dispatchEvent: LoopEventDispatcher;
    readonly llm: LLM;
    readonly signal: AbortSignal;
    readonly turnId: string;
    readonly currentStep: number;
    readonly stepUuid: string;
    readonly trace: LLMRequestTrace;
}
export interface ToolCallBatchResult {
    readonly stopTurn: boolean;
}
export declare function runToolCallBatch(step: ToolCallStepContext, response: LLMChatResponse): Promise<ToolCallBatchResult>;
/**
 * Record tool calls from a response the step will NOT execute: the provider
 * stream broke off (paused / overloaded / token limit), so running the calls
 * — whose arguments may be truncated mid-stream — would be unsafe. Dropping
 * them silently is not an option either: it loses the model's intent and,
 * when the response carried no other usable content, persists an assistant
 * message strict providers reject as empty. Each call is recorded with
 * sanitized arguments (unparseable JSON, e.g. truncated by an interrupted
 * stream, becomes `{}`) and immediately closed with a synthetic error result,
 * so the exchange stays wire-valid and the model learns the calls never ran.
 */
export declare function recordUnexecutedToolCalls(step: ToolCallStepContext, response: LLMChatResponse): Promise<void>;
