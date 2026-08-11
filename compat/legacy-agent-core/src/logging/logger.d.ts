import { type Logger, type RootLogger } from './types';
export declare function getRootLogger(): RootLogger;
export declare function flushDiagnosticLogs(): Promise<boolean>;
/**
 * Synchronous variant for crash / emergency-exit paths that call
 * `process.exit()` on the same tick: pending entries are appended with
 * `appendFileSync`, so they survive the immediate exit that would otherwise
 * drop everything still sitting in the async queue.
 */
export declare function flushDiagnosticLogsSync(): void;
/**
 * Root logger. Import and use directly for events that don't belong to any
 * session (CLI startup, harness construction, etc.):
 *
 *   import { log } from 'kimi-code-sdk';
 *   log.info('kimi-code starting', { version });
 *
 * For events scoped to a session or agent, use the parent's `log` field:
 *
 *   session.log.error('mcp initial load failed', error);
 *   agent.log.error('turn failed', { turnId, error });
 *
 * Late-binding: methods look up the current `RootLogger` on every call, so
 * importing `log` at module load (before `KimiHarness` configures the root)
 * is safe — calls during the pre-configure window are silent noops.
 */
export declare const log: Logger;
export declare function redact<T>(value: T): T;
/** @internal — vitest only. */
export declare function __resetRootLoggerForTest(): Promise<void>;
export declare function resolveGlobalLogPath(homeDir: string): string;
