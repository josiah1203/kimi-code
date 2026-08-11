import type { PluginCapabilityState, PluginGithubMetadata, PluginSource } from './types';
export interface InstalledRecord {
    readonly id: string;
    readonly root: string;
    readonly source: PluginSource;
    readonly enabled: boolean;
    readonly installedAt: string;
    readonly updatedAt?: string;
    readonly originalSource?: string;
    readonly capabilities?: PluginCapabilityState;
    readonly github?: PluginGithubMetadata;
}
export interface InstalledFile {
    readonly version: 1;
    readonly plugins: readonly InstalledRecord[];
}
export declare function readInstalled(kimiHomeDir: string): Promise<InstalledFile>;
export declare function writeInstalled(kimiHomeDir: string, data: InstalledFile): Promise<void>;
