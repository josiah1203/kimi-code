import { APIStatusError } from '@spiderbyte/kosong';
import type { Logger } from '#/logging/types';
import type { LoopEventDispatcher } from './events';
import type { LLM, LLMChatParams, LLMChatResponse } from './llm';
export declare const DEFAULT_MAX_RETRY_ATTEMPTS = 10;
export interface ChatWithRetryInput {
    readonly llm: LLM;
    readonly params: LLMChatParams;
    readonly dispatchEvent: LoopEventDispatcher;
    readonly turnId: string;
    readonly currentStep: number;
    readonly stepUuid: string;
    readonly maxAttempts?: number;
    readonly log?: Logger | undefined;
}
export declare function chatWithRetry(input: ChatWithRetryInput): Promise<LLMChatResponse>;
export declare function findAPIStatusError(error: unknown): APIStatusError | undefined;
export declare function retryBackoffDelays(maxAttempts: number): number[];
export declare function sleepForRetry(delayMs: number, signal: AbortSignal): Promise<void>;
