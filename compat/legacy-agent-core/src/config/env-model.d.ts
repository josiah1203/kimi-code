import { type KimiConfig } from './schema';
/** Reserved keys for the env-driven synthetic provider / model alias. */
export declare const ENV_MODEL_PROVIDER_KEY = "__kimi_env__";
export declare const ENV_MODEL_ALIAS_KEY = "__kimi_env_model__";
type Env = Readonly<Record<string, string | undefined>>;
/**
 * When `KIMI_MODEL_NAME` is set, synthesize one provider + one model alias from
 * the `KIMI_MODEL_*` environment variables and make it the default model.
 * Returns the config unchanged when the trigger variable is absent.
 *
 * IMPORTANT: the synthesized provider/model/default_model exist ONLY in the
 * in-memory runtime config and must never be serialized back to config.toml.
 * Two layers enforce this: write paths read the raw config via `readConfigFile`,
 * and `writeConfigFile` strips the reserved entries via `stripEnvModelConfig` as
 * a final guard against patch round-trips (getConfig -> setConfig).
 */
export declare function applyEnvModelConfig(config: KimiConfig, env?: Env): KimiConfig;
/**
 * Remove the env-synthesized provider/model before a config is persisted to
 * disk. Mirror of {@link applyEnvModelConfig}: that injects the reserved entries
 * into the in-memory runtime config; this guarantees they never reach
 * config.toml — including via a `getConfig` -> `setConfig` patch round-trip,
 * where the runtime config (carrying the env provider and its shell API key)
 * would otherwise be merged back and written out. Every env-injected top-level
 * field (default_model, thinking) is restored to its on-disk
 * value from `config.raw` rather than erased, so real values already in
 * config.toml survive the round-trip.
 */
export declare function stripEnvModelConfig(config: KimiConfig): KimiConfig;
export {};
