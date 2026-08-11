/**
 * Kosong-backed implementation of the loop `LLM` interface.
 *
 * Bridges the new `loop/llm.ts` contract onto
 * the kosong `generate()` streaming API:
 *
 *   - kosong's per-part `onMessagePart` is forwarded to loop per-delta
 *     callbacks (`onTextDelta`, `onThinkDelta`, `onToolCallDelta`).
 *   - loop per-block callbacks (`onTextPart`, `onThinkPart`) only fire
 *     after the kosong stream drains, iterating over the merged
 *     `result.message.content`. Completed
 *     blocks land on the WAL seam, raw deltas never do.
 *   - kosong's finish reasons are preserved as provider diagnostics. The loop
 *     derives loop control from the normalized response shape, not from the
 *     provider's finish-reason spelling.
 */
import { generate as kosongGenerate, type ChatProvider, type Message, type ModelCapability } from '@spiderbyte/kosong';
import type { LLM, LLMChatParams, LLMChatResponse } from '../../loop';
import { type CompletionBudgetConfig } from '../../utils/completion-budget';
export type GenerateFn = typeof kosongGenerate;
export interface KosongLLMConfig {
    readonly provider: ChatProvider;
    readonly systemPrompt: string;
    readonly capability?: ModelCapability | undefined;
    /**
     * Optional override for the kosong `generate()` entry point. Lets the
     * agent host (and its test harness) inject a scripted generator without
     * having to substitute the entire LLM implementation.
     */
    readonly generate?: GenerateFn | undefined;
    /**
     * Completion budget config resolved from agent/provider settings. The
     * final cap is applied to each request.
     */
    readonly completionBudgetConfig?: CompletionBudgetConfig | undefined;
    /**
     * Returns the number of context tokens already consumed by the latest
     * completed step (API-reported input + output). Used by chat-completions
     * providers to size the completion budget to the remaining context window.
     */
    readonly usedContextTokens?: (() => number) | undefined;
}
export declare class KosongLLM implements LLM {
    readonly systemPrompt: string;
    readonly modelName: string;
    readonly capability?: ModelCapability | undefined;
    private readonly provider;
    private readonly generate;
    private readonly completionBudgetConfig;
    private readonly usedContextTokens;
    constructor(config: KosongLLMConfig);
    chat(params: LLMChatParams): Promise<LLMChatResponse>;
    isRetryableError(error: unknown): boolean;
}
export declare function buildMessagesWithSystem(systemPrompt: string, history: Message[]): Message[];
export declare function downgradeUnsupportedMedia(messages: readonly Message[], capability: ModelCapability | undefined): Message[];
