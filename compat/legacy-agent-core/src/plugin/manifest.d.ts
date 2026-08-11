import { type PluginDiagnostic, type PluginManifest, type PluginManifestKind } from './types';
export declare const PLUGIN_SYSTEM_PROMPT_MAX_BYTES: number;
export interface ParsedManifestResult {
    readonly manifest?: PluginManifest;
    readonly manifestKind?: PluginManifestKind;
    readonly manifestPath?: string;
    readonly shadowedManifestPath?: string;
    readonly diagnostics: readonly PluginDiagnostic[];
}
export declare function parseManifest(pluginRoot: string): Promise<ParsedManifestResult>;
