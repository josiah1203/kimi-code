import { type SpawnOptionsWithoutStdio } from 'node:child_process';
import type { HookResult } from './types';
export interface RunHookOptions {
    readonly timeout: number;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
}
export declare function buildHookSpawnOptions(options: {
    cwd?: string;
    env?: Readonly<Record<string, string>>;
}): SpawnOptionsWithoutStdio;
export declare function runHook(command: string, input: Record<string, unknown>, options: RunHookOptions): Promise<HookResult>;
