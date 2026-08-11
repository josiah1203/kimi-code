import { type ChatProvider, type ThinkingEffort } from '@spiderbyte/kosong';
type Env = Readonly<Record<string, string | undefined>>;
/**
 * Apply Kimi sampling params (`KIMI_MODEL_TEMPERATURE`, `KIMI_MODEL_TOP_P`) from
 * the environment to a chat provider. Applied at provider construction
 * (`ConfigState.provider`) so every request built from `config.provider` — the
 * main loop AND full-history compaction — carries them, matching kimi-cli where
 * these live on the shared `create_llm` provider. Applies globally to any Kimi
 * provider (not tied to `KIMI_MODEL_NAME`).
 *
 * Non-Kimi providers — and Kimi providers with neither var set — are returned
 * unchanged. `max_tokens` is intentionally NOT handled here: `KIMI_MODEL_MAX_TOKENS`
 * already flows through the completion-budget path (`resolveCompletionBudget`).
 */
export declare function applyKimiEnvSamplingParams(provider: ChatProvider, env?: Env): ChatProvider;
/**
 * Resolve the operational `KIMI_MODEL_THINKING_EFFORT` override after the
 * model-aware effort has been resolved. The override intentionally bypasses
 * `support_efforts`, but cannot turn Thinking on after the user disabled it.
 *
 * Provider identity is supplied separately from the wire adapter so a Kimi
 * provider routed through the Anthropic protocol still receives Kimi semantics.
 */
export declare function resolveKimiEnvThinkingEffort(thinkingEffort: ThinkingEffort, kimiProvider: boolean, env?: Env): ThinkingEffort | undefined;
/**
 * Resolve the Preserved Thinking passthrough (Kimi `thinking.keep` / Anthropic
 * `context_management` `clear_thinking_20251015`) with precedence env
 * (`KIMI_MODEL_THINKING_KEEP`) > config (`thinking.keep`) > default `"all"`.
 * Only meaningful while thinking is on — otherwise the API would receive a keep
 * directive with no accompanying `thinking.type` it honors, so it resolves to
 * `undefined`. Applied via `ConfigState.provider`, which is shared by the main
 * loop AND full-history compaction, so compaction intentionally carries the
 * same keep (and, for Anthropic, the beta endpoint) when thinking is on;
 * `keep:"all"` prunes nothing and a consistent request shape maximizes KV-cache
 * reuse.
 *
 * Returns `undefined` when Preserved Thinking should be disabled.
 */
export declare function resolveThinkingKeep(env: Env, configKeep: string | undefined, thinkingEffort: ThinkingEffort): string | undefined;
/**
 * Apply the Moonshot Preserved Thinking passthrough to a chat provider. See
 * `resolveThinkingKeep` for precedence. Non-Kimi providers are returned
 * unchanged.
 */
export declare function applyKimiEnvThinkingKeep(provider: ChatProvider, thinkingEffort: ThinkingEffort, env?: Env, configKeep?: string): ChatProvider;
/**
 * Apply the Anthropic equivalent of Preserved Thinking — a `context_management`
 * `clear_thinking_20251015` edit carrying `keep` — to an Anthropic chat
 * provider. See `resolveThinkingKeep` for precedence. Non-Anthropic providers
 * are returned unchanged. Applies to every Anthropic provider (Claude and
 * Kimi's Anthropic-compatible mode) while thinking is on; `keep: "all"` tells
 * the server to retain all prior thinking blocks (prune none), mirroring Kimi's
 * `thinking.keep`.
 */
export declare function applyAnthropicThinkingKeep(provider: ChatProvider, thinkingEffort: ThinkingEffort, env?: Env, configKeep?: string): ChatProvider;
export {};
