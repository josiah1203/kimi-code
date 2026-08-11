import type { PluginCommandDef } from './types';
export declare function parseCommandText(input: {
    readonly text: string;
    readonly commandPath: string;
    readonly pluginId: string;
    readonly fallbackName?: string;
}): PluginCommandDef;
export declare function loadPluginCommand(input: {
    readonly commandPath: string;
    readonly pluginId: string;
    readonly fallbackName?: string;
}): Promise<PluginCommandDef | undefined>;
/**
 * Expand `$ARGUMENTS` placeholders in a plugin command body with the typed args.
 * If the body has no placeholder but args are present, append them so nothing
 * is silently dropped.
 */
export declare function expandCommandArguments(body: string, args: string): string;
