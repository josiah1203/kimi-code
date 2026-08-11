import type { HookResult } from './types';
export declare function renderHookResult(event: string, message: string): string;
export interface RenderedHookResult {
    readonly event: string;
    readonly message: string;
    readonly text: string;
}
export declare function renderUserPromptHookResult(results: readonly HookResult[] | undefined): RenderedHookResult | undefined;
export declare function renderUserPromptHookBlockResult(results: readonly HookResult[] | undefined): RenderedHookResult | undefined;
