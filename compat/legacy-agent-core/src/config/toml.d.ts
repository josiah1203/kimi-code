import { KimiError } from '#/errors';
import { type KimiConfig } from '#/config/schema';
export declare function ensureConfigFile(filePath: string): Promise<void>;
export declare function readConfigFile(filePath: string): KimiConfig;
/**
 * Strict read for write paths (read-merge-write must never use a salvaged
 * config as its base, or the rewrite would drop the user's broken-but-fixable
 * sections). Re-throws validation failures with a short actionable message —
 * UIs surface it directly — instead of the raw validation details.
 */
export declare function readConfigFileForUpdate(filePath: string): KimiConfig;
/**
 * Load the config for runtime consumption: the on-disk config plus any model
 * synthesized from `KIMI_MODEL_*` environment variables. Use this everywhere a
 * value is assigned to the live runtime config; use the raw `readConfigFile`
 * for write-back paths so the synthesized model is never persisted.
 */
export declare function loadRuntimeConfig(filePath: string, env?: Readonly<Record<string, string | undefined>>): KimiConfig;
export interface RuntimeConfigLoadResult {
    readonly config: KimiConfig;
    /** Problems in config.toml itself; non-empty means parts (or all) of the file were ignored. */
    readonly fileWarnings: readonly string[];
    /** Problems applying KIMI_MODEL_* env overrides; the overlay was skipped. */
    readonly envWarnings: readonly string[];
    /**
     * Set when the file is entirely unusable (unreadable, TOML syntax error, or
     * nothing salvageable) and `config` is pure defaults. Startup fails fast on
     * this — defaults-only means the user looks logged out, which is worse than
     * an actionable parse error. Mid-run reloads ignore it and keep the last
     * good config instead.
     */
    readonly fileError?: KimiError;
}
/**
 * Lenient variant of `loadRuntimeConfig` that never throws: schema errors
 * drop only the offending sections (whole entry for `providers`/`models`,
 * whole top-level section otherwise) and a bad KIMI_MODEL_* env overlay is
 * skipped, each reported as a warning. A file that cannot be used at all
 * additionally sets `fileError` so startup can fail fast while mid-run
 * reloads degrade. Runtime read paths use this; write paths must keep using
 * the strict readers so a broken file is never silently rewritten.
 */
export declare function loadRuntimeConfigSafe(filePath: string, env?: Readonly<Record<string, string | undefined>>): RuntimeConfigLoadResult;
export declare function parseConfigString(tomlText: string, filePath?: string): KimiConfig;
export declare function transformTomlData(data: Record<string, unknown>): Record<string, unknown>;
export declare function writeConfigFile(filePath: string, config: KimiConfig): Promise<void>;
export declare function configToTomlData(config: KimiConfig): Record<string, unknown>;
