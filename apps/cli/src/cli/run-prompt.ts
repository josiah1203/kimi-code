/**
 * Canonical print-mode entry point for the SpiderByte CLI.
 *
 * The native `run-print` driver owns the Agent Core lifecycle. This module
 * keeps only the small process/timing helpers shared by that driver and the
 * command dispatcher; there is no v1 harness or compatibility engine here.
 */

import type { CLIOptions } from './options';

export interface PromptOutput {
  readonly columns?: number;
  write(chunk: string): boolean;
}

export interface PromptProcess {
  once(signal: NodeJS.Signals, listener: () => void | Promise<void>): unknown;
  off(signal: NodeJS.Signals, listener: () => void | Promise<void>): unknown;
  exit(code?: number): never | void;
}

export interface PromptRunIO {
  readonly stdout?: PromptOutput;
  readonly stderr?: PromptOutput;
  readonly process?: PromptProcess;
}

export async function runPrompt(
  opts: CLIOptions,
  version: string,
  io: PromptRunIO = {},
): Promise<void> {
  const { runPrint } = await import('./run-print');
  await runPrint(opts, version, io);
}

export function configuredModel(...models: readonly (string | undefined)[]): string | undefined {
  return models.find((model) => model !== undefined && model.trim().length > 0);
}

export function requireConfiguredModel(...models: readonly (string | undefined)[]): string {
  const model = configuredModel(...models);
  if (model === undefined) {
    throw new Error(
      'No model configured. Run `spyderbyte` and use /connect or /provider to configure a local or BYOK provider, then retry; or set default_model in config.toml.',
    );
  }
  return model;
}

/**
 * Await a cleanup promise with a bounded wait. A late rejection is consumed
 * after the timeout so shutdown cannot create an unhandled rejection.
 */
export async function raceWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.catch((error: unknown) => {
    if (timedOut) return;
    throw error;
  });
  const timedOutSignal = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([guarded, timedOutSignal]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function installPromptTerminationCleanup(
  promptProcess: PromptProcess,
  cleanup: () => void | Promise<void>,
): () => void {
  let terminating = false;
  const exitAfterCleanup = async (signal: NodeJS.Signals): Promise<void> => {
    if (terminating) return;
    terminating = true;
    try {
      await cleanup();
    } finally {
      promptProcess.exit(signalExitCode(signal));
    }
  };
  const onSigint = () => void exitAfterCleanup('SIGINT');
  const onSigterm = () => void exitAfterCleanup('SIGTERM');
  const onSighup = () => void exitAfterCleanup('SIGHUP');
  promptProcess.once('SIGINT', onSigint);
  promptProcess.once('SIGTERM', onSigterm);
  promptProcess.once('SIGHUP', onSighup);
  return () => {
    promptProcess.off('SIGINT', onSigint);
    promptProcess.off('SIGTERM', onSigterm);
    promptProcess.off('SIGHUP', onSighup);
  };
}

export function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGHUP') return 129;
  return 143;
}
