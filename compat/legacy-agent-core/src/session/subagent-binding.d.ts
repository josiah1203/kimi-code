import { type KimiConfig, type SecondaryModelConfig } from '../config';
import type { ExperimentalFlagResolver } from '../flags';
import type { AgentModelPreference } from '../profile';
/**
 * Subagent model binding — the secondary-model half of the spawn decision.
 *
 * When the `secondary-model` experiment is enabled and `[secondary_model]` is
 * configured, newly spawned subagents bind to it by default instead of
 * inheriting the caller's model. The caller (the parent model, through the
 * `Agent` / `AgentSwarm` tool `model` parameter) or the spawned profile (via
 * `model_preference`) can force `primary`. A recipe with patch fields binds
 * the synthesized derived entry ({@link SECONDARY_DERIVED_MODEL_ALIAS},
 * materialized by `applySecondaryModelConfig`); a pointer-only recipe binds
 * the pointed entry directly. `default_effort` is passed as the explicit
 * subagent thinking effort; without it the child resolves thinking naturally
 * (global thinking config → the bound model's default effort) rather than
 * inheriting the caller's level. When unset, spawning behavior is unchanged:
 * subagents inherit the caller's model and effort.
 */
export type SubagentModelChoice = AgentModelPreference;
export interface SubagentModelBinding {
    readonly modelAlias: string | undefined;
    readonly thinkingEffort?: string;
}
export declare function resolveSecondaryModel(config: KimiConfig | undefined, flags: ExperimentalFlagResolver): SecondaryModelConfig | undefined;
/**
 * Resolve which model a newly spawned subagent binds to. `requested` is the
 * explicit per-spawn choice (tool argument or profile preference); `own` is
 * the caller's current model state, used when inheriting.
 */
export declare function resolveSubagentBinding(config: KimiConfig | undefined, flags: ExperimentalFlagResolver, own: {
    readonly modelAlias: string | undefined;
    readonly thinkingEffort: string;
}, requested?: SubagentModelChoice): SubagentModelBinding;
/**
 * The "Available models" block appended to the `Agent` / `AgentSwarm` tool
 * descriptions so the parent model knows it can pick. `undefined` when the
 * secondary model is not configured or the caller's model is not bound yet.
 */
export declare function buildSubagentModelDescriptions(config: KimiConfig | undefined, flags: ExperimentalFlagResolver, callerModelAlias: string | undefined): string | undefined;
/**
 * Strip the `model` property from a subagent collaboration tool's advertised
 * JSON schema. While the `secondary-model` experiment is off the parameter is
 * a silent no-op, so the schema the model sees (and the args validator
 * compiled from the same advertised schema) drops it entirely — the
 * secondary-model concept never enters the prompt, and a stray `model`
 * argument is rejected instead of silently inheriting the caller's model.
 * Returns the input unchanged when there is no `model` property; otherwise a
 * shallow copy — the input is never mutated, so callers can keep both
 * variants as shared constants.
 */
export declare function stripSubagentModelParameter(parameters: Record<string, unknown>): Record<string, unknown>;
/**
 * Point a spawn-time model resolution failure at the secondary-model
 * configuration when the bound model is not the caller's own — otherwise the
 * parent model sees a bare "model not configured" error with no hint that it
 * comes from `[secondary_model]`.
 */
export declare function wrapSubagentModelError(error: unknown, boundModel: string, callerModelAlias: string | undefined): unknown;
