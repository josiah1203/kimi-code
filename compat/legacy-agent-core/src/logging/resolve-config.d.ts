import type { LogLevel, LoggingConfig } from './types';
export declare const DEFAULT_LOG_LEVEL: LogLevel;
export declare const DEFAULT_GLOBAL_MAX_BYTES: number;
export declare const DEFAULT_GLOBAL_FILES = 5;
export declare const DEFAULT_SESSION_MAX_BYTES: number;
export declare const DEFAULT_SESSION_FILES = 3;
export interface ResolveLoggingInput {
    readonly homeDir: string;
    readonly env?: NodeJS.ProcessEnv | undefined;
}
/**
 * Build the runtime `LoggingConfig` from env vars + defaults.
 *
 * v1 deliberately does not read `config.toml [logging]` — the schema is in
 * flux and reading it adds a startup-time failure surface. Users who need to
 * override the defaults set env vars:
 *
 *   KIMI_LOG_LEVEL=debug
 *   KIMI_LOG_GLOBAL_MAX_BYTES=... KIMI_LOG_GLOBAL_FILES=...
 *   KIMI_LOG_SESSION_MAX_BYTES=... KIMI_LOG_SESSION_FILES=...
 */
export declare function resolveLoggingConfig(input: ResolveLoggingInput): LoggingConfig;
