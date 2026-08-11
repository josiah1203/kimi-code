import type { Kaos } from '@spiderbyte/kaos';
import type { SystemPromptContext } from './types';
export interface PreparedSystemPromptContext extends Pick<SystemPromptContext, 'cwdListing' | 'agentsMd' | 'additionalDirsInfo'> {
    /** Present when the combined AGENTS.md content exceeds the recommended size. */
    readonly agentsMdWarning?: string;
}
export interface PrepareSystemPromptContextOptions {
    readonly additionalDirs?: readonly string[];
}
export declare function prepareSystemPromptContext(kaos: Kaos, brandHome?: string, options?: PrepareSystemPromptContextOptions): Promise<PreparedSystemPromptContext>;
export declare function loadAgentsMd(kaos: Kaos, brandHome?: string): Promise<string>;
