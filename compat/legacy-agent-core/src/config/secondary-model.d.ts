import type { KimiConfig, ModelAliasOverrides, SecondaryModelConfig } from './schema';
/**
 * Secondary-model runtime overlay.
 *
 * `[secondary_model]` is a recipe: `model` points at a `[models]` entry and
 * every remaining field is a subagent-only patch. When patch fields exist,
 * {@link applySecondaryModelConfig} synthesizes the derived model entry
 * ({@link SECONDARY_DERIVED_MODEL_ALIAS}) into the in-memory `models` view — a
 * copy of the pointed entry with the patch merged into its `overrides` block
 * (patch wins conflicts) — so subagent binding resolves it through the
 * standard alias path, riding the same `effectiveModelAlias` merge as any
 * `models.*.overrides`. With no patch fields, subagents bind the pointed
 * entry directly and nothing is synthesized.
 *
 * The `KIMI_SECONDARY_MODEL` / `KIMI_SECONDARY_EFFORT` env vars override
 * `model` / `default_effort` in memory only: like the `KIMI_MODEL_*`
 * synthesized entries, the derived entry and the env-injected fields must
 * never reach `config.toml`. {@link stripSecondaryModelConfig} is the write
 * path mirror, wired next to `stripEnvModelConfig`.
 */
export declare const SECONDARY_DERIVED_MODEL_ALIAS = "__secondary__";
export declare const SECONDARY_MODEL_ENV = "KIMI_SECONDARY_MODEL";
export declare const SECONDARY_MODEL_EFFORT_ENV = "KIMI_SECONDARY_EFFORT";
type Env = Readonly<Record<string, string | undefined>>;
/**
 * The patch half of the recipe: every field except `model`. Returns
 * `undefined` when no patch field is set — the signal that subagents bind the
 * pointed entry directly and no derived entry is synthesized.
 */
export declare function secondaryModelPatch(secondary: SecondaryModelConfig | undefined): ModelAliasOverrides | undefined;
/**
 * Apply the secondary-model runtime view: env overrides for the recipe, then
 * the derived-entry synthesis. Returns the config unchanged when neither
 * applies. Nothing is synthesized when `secondary.model` is unset or the
 * pointed entry does not exist (the session warning reports the dangling
 * pointer; spawn fails with the wrapped error).
 */
export declare function applySecondaryModelConfig(config: KimiConfig, env?: Env): KimiConfig;
/**
 * Remove the runtime-only secondary-model state before a config is persisted
 * to disk: the synthesized derived entry (never a legitimate on-disk entry,
 * mirroring the v2 overlay which strips a user-configured entry under the
 * reserved id all the same), a `default_model` pointer at the derived entry
 * (restored from raw so it cannot dangle after the recipe is removed), and
 * the env-injected recipe fields (restored from raw when the value being
 * written still equals the env value, so a `getConfig` -> `setConfig`
 * round-trip cannot persist shell overrides, while a genuinely new selection
 * — e.g. a `/secondary_model` pick made under `KIMI_SECONDARY_MODEL` — does
 * reach the disk, mirroring the pointer check in `stripEnvModelConfig`).
 */
export declare function stripSecondaryModelConfig(config: KimiConfig, env?: Env): KimiConfig;
export {};
