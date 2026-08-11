import { type FlagId } from './registry';
import type { ExperimentalFeatureState, ExperimentalFlagConfig, FlagDefinitionInput } from './types';
/** Master switch: when truthy, forces every flag on (highest priority). */
export declare const MASTER_ENV = "KIMI_CODE_EXPERIMENTAL_FLAG";
/**
 * Pure, synchronous flag resolver. State comes entirely from (env, registry) and nothing is
 * cached: env is read live on every call, so a single shared instance always reflects the current
 * process env. Defaults to process.env + FLAG_DEFINITIONS; tests can inject a custom env / defs.
 *
 * Precedence (highest wins):
 *   L1 master switch KIMI_CODE_EXPERIMENTAL_FLAG → every flag is on
 *   L2 per-feature def.env (parseBooleanEnv, may force on or off)
 *   L3 config.toml [experimental] per-feature override
 *   L4 registry default
 */
export declare class FlagResolver {
    private readonly env;
    private readonly definitions;
    private configOverrides;
    private readonly byId;
    constructor(env?: Readonly<Record<string, string | undefined>>, definitions?: readonly FlagDefinitionInput[], configOverrides?: ExperimentalFlagConfig);
    setConfigOverrides(overrides: ExperimentalFlagConfig | undefined): void;
    enabled(id: FlagId): boolean;
    explain(id: FlagId): ExperimentalFeatureState | undefined;
    snapshot(): Record<string, boolean>;
    enabledIds(): readonly FlagId[];
    explainAll(): readonly ExperimentalFeatureState[];
    private state;
}
/**
 * Compatibility accessor for callers that only need process-global env behavior.
 * Runtime code that belongs to a KimiCore/Session/Agent should use the scoped
 * resolver on that owner instead.
 */
export declare const flags: FlagResolver;
