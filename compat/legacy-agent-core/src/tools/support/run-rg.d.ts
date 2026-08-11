/**
 * run-rg — shared ripgrep subprocess plumbing.
 *
 * Single place that knows how we spawn `rg` through Kaos: timeout / abort
 * handling, capped stdout / stderr draining, two-phase kill with process
 * disposal, and the standard exclusion globs (VCS metadata + sensitive
 * files) shared by GrepTool and GlobTool. Mode-specific argument building
 * and output parsing stay in the tools themselves.
 */
import type { Kaos } from '@spiderbyte/kaos';
import type { ExecutableToolResult } from '../../loop/types';
export declare const DEFAULT_TIMEOUT_MS = 20000;
export declare const SIGTERM_GRACE_MS = 5000;
export declare const MAX_OUTPUT_BYTES: number;
export declare const VCS_DIRECTORIES_TO_EXCLUDE: readonly [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];
export declare const SENSITIVE_KEY_BASENAMES: readonly ["id_rsa", "id_ed25519", "id_ecdsa"];
export declare const SENSITIVE_KEY_GLOBS_TO_EXCLUDE: string[];
export declare const SENSITIVE_GLOBS_TO_EXCLUDE: readonly ["**/.env", ...string[], "**/.aws/credentials", "**/.aws/credentials/**", "**/.gcp/credentials", "**/.gcp/credentials/**"];
export interface RipgrepRunResult {
    readonly kind: 'result';
    readonly exitCode: number;
    readonly stdoutText: string;
    readonly stderrText: string;
    readonly bufferTruncated: boolean;
    readonly stderrTruncated: boolean;
    readonly timedOut: boolean;
}
export type RipgrepRunOutcome = RipgrepRunResult | {
    readonly kind: 'tool-error';
    readonly result: ExecutableToolResult;
};
export interface RunRipgrepOptions {
    /** Message surfaced when the run is aborted via `signal`. Defaults to `"Aborted"`. */
    readonly abortedMessage?: string;
}
export declare function runRipgrepOnce(kaos: Kaos, rgArgs: readonly string[], signal: AbortSignal, options?: RunRipgrepOptions): Promise<RipgrepRunOutcome>;
export declare function shouldRetryRipgrepEagain(result: RipgrepRunResult): boolean;
