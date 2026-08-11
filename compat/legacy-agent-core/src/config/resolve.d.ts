export interface ResolveConfigValueInput<T> {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly envKey: string;
    readonly configValue?: T;
    readonly defaultValue: T;
    readonly parseEnv: (value: string | undefined) => T | undefined;
}
export declare function resolveConfigValue<T>(input: ResolveConfigValueInput<T>): T;
export declare function parseBooleanEnv(value: string | undefined): boolean | undefined;
/**
 * Parse a floating-point environment value (e.g. `KIMI_MODEL_TEMPERATURE`).
 * Returns `undefined` when unset/blank; throws `KimiError(CONFIG_INVALID)` on a
 * non-numeric value so a typo fails fast like the other `KIMI_MODEL_*` vars.
 * No range validation — callers pass values the upstream API accepts.
 */
export declare function parseFloatEnv(value: string | undefined, varName: string): number | undefined;
