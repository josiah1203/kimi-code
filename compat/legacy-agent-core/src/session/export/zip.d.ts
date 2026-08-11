import type { ExportSessionManifest } from '#/rpc/core-api';
export declare function collectFilesRecursive(root: string): Promise<string[]>;
export type ExtraZipEntry = {
    /** Absolute path on disk. */
    readonly source: string;
    /** zip-relative target path. */
    readonly target: string;
} | {
    readonly data: Buffer;
    /** zip-relative target path. */
    readonly target: string;
};
export declare function writeExportZip(args: {
    readonly outputPath: string;
    readonly manifest: ExportSessionManifest;
    readonly sessionDir: string;
    readonly sessionFiles: readonly string[];
    readonly extraEntries?: readonly ExtraZipEntry[];
}): Promise<readonly string[]>;
