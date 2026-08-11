export declare class FsPathEscapesError extends Error {
    readonly inputPath: string;
    readonly reason: 'empty' | 'absolute' | 'dotdot_segment' | 'resolved_outside_cwd' | 'symlink_outside_cwd';
    constructor(inputPath: string, reason: FsPathEscapesError['reason'], detail?: string);
}
export interface PathSafetyResult {
    readonly absolute: string;
    readonly relative: string;
}
export declare function resolveSafePath(cwd: string, inputPath: string): Promise<PathSafetyResult>;
