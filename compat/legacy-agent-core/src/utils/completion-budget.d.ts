import type { ChatProvider, ModelCapability } from '@spiderbyte/kosong';
/** Completion-token budget for the next LLM request. */
export interface CompletionBudgetConfig {
    /** Explicit user-configured maximum. */
    readonly hardCap?: number;
    /** Conservative cap for providers/models whose context window is unknown. */
    readonly fallback?: number;
}
/**
 * Resolve configured completion budget. Env values are explicit hard caps;
 * non-positive env values disable clamping.
 */
export declare function resolveCompletionBudget(args: {
    readonly maxOutputSize?: number;
    readonly reservedContextSize?: number;
    readonly env?: NodeJS.ProcessEnv;
}): CompletionBudgetConfig | undefined;
/**
 * Compute the effective `max_completion_tokens` cap.
 */
export declare function computeCompletionBudgetCap(args: {
    readonly budget: CompletionBudgetConfig;
    readonly capability: ModelCapability | undefined;
}): number;
/**
 * Apply a completion budget to a provider via its optional
 * `withMaxCompletionTokens` capability. Returns the original provider
 * unchanged when no budget is configured or the provider opts out.
 *
 * The returned provider is intentionally a shallow clone that shares the
 * original's HTTP client. Callers MUST treat it as a single-step value
 * and NOT persist it back to durable agent state — see the F3 discussion
 * in `KimiChatProvider._clone()`.
 */
export declare function applyCompletionBudget(args: {
    readonly provider: ChatProvider;
    readonly budget: CompletionBudgetConfig | undefined;
    readonly capability: ModelCapability | undefined;
    readonly usedContextTokens?: number;
}): ChatProvider;
