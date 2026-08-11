/**
 * BashTool — execute shell commands.
 *
 * Invokes bash (POSIX) according to an injected `Environment`. On Windows
 * the shell is Git Bash; the path is resolved by `detectEnvironment`.
 *
 * Dependencies injected via constructor:
 *   - `Kaos`        — shell execution abstraction (exec / execWithEnv)
 *   - `cwd`         — default working directory for commands
 *   - `Environment` — cross-platform probe (shellName / shellPath)
 *   - `BackgroundManager` — task lifecycle manager for foreground/background commands
 *
 * Execution goes through Kaos, never directly via node:child_process.
 *
 * Hardening:
 *   - `args.timeout` (seconds) and the ambient `signal` both stop the
 *     manager-owned process task on either edge.
 *   - stdin is closed immediately so interactive commands (`cat`, `read`,
 *     `python -c 'input()'`) receive EOF instead of hanging.
 *   - Two-phase kill is owned by BackgroundManager: SIGTERM → grace → SIGKILL.
 *   - stdout/stderr are captured by ProcessBackgroundTask for task output;
 *     foreground runs pass a callback to collect chunks for this call.
 */
import type { Kaos } from '@spiderbyte/kaos';
import { z } from 'zod';
import { type BackgroundManager } from '../../../agent/background';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
export declare const BashInputSchema: z.ZodObject<{
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    description: z.ZodOptional<z.ZodString>;
    run_in_background: z.ZodOptional<z.ZodBoolean>;
    disable_timeout: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const BashOutputSchema: z.ZodObject<{
    exitCode: z.ZodNumber;
    stdout: z.ZodString;
    stderr: z.ZodString;
}, z.core.$strip>;
export type BashInput = z.Infer<typeof BashInputSchema>;
export type BashOutput = z.Infer<typeof BashOutputSchema>;
export declare class BashTool implements BuiltinTool<BashInput> {
    private readonly kaos;
    private readonly cwd;
    private readonly backgroundManager;
    readonly name: "Bash";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    private readonly isWindowsBash;
    private readonly allowBackground;
    private readonly autoBackgroundOnTimeout;
    /**
     * Default deadline for background tasks when the call omits `timeout`, and
     * the re-armed deadline for foreground commands moved to the background.
     * `undefined` arms no timer at all (`background.bash_task_timeout_s = 0`).
     */
    private readonly backgroundTimeoutMs;
    constructor(kaos: Kaos, cwd: string, backgroundManager: BackgroundManager, options?: {
        allowBackground?: boolean | undefined;
        autoBackgroundOnTimeout?: boolean;
        /**
         * Effective background default timeout in seconds
         * (`background.bash_task_timeout_s`; `0` = no timeout). Defaults to
         * {@link DEFAULT_BACKGROUND_TIMEOUT_S} when unset.
         */
        backgroundTimeoutS?: number;
    });
    resolveExecution(args: BashInput): ToolExecution;
    private spawn;
    /**
     * Background deadline: an explicit `timeout` wins (the schema caps it at
     * `MAX_BACKGROUND_TIMEOUT_S`); otherwise the configured default — which is
     * `undefined` (no timer armed) when `background.bash_task_timeout_s = 0`.
     */
    private backgroundDefaultTimeoutMs;
    private execution;
    private validateRunRequest;
    private foregroundCompletionResult;
    private addForegroundOutputReference;
    private backgroundStartedResult;
    private nextStepLines;
}
