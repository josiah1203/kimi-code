import type { Kaos } from '@spiderbyte/kaos';
export interface WorkspaceAdditionalDirsLoadResult {
    readonly projectRoot: string;
    readonly configPath: string;
    readonly additionalDirs: readonly string[];
    readonly warning?: string;
}
export type WorkspaceLocalConfig = WorkspaceAdditionalDirsLoadResult;
export declare function loadWorkspaceLocalConfig(kaos: Kaos, workDir: string): Promise<WorkspaceLocalConfig>;
export declare function readWorkspaceAdditionalDirs(kaos: Kaos, workDir: string): Promise<WorkspaceAdditionalDirsLoadResult>;
export declare function resolveWorkspaceAdditionalDirs(kaos: Kaos, projectRoot: string, additionalDirs: readonly string[]): Promise<string[]>;
export declare function appendWorkspaceAdditionalDir(kaos: Kaos, workDir: string, inputPath: string, _currentAdditionalDirs: readonly string[]): Promise<WorkspaceAdditionalDirsLoadResult>;
export declare function normalizeAdditionalDirs(additionalDirs: readonly string[]): string[];
