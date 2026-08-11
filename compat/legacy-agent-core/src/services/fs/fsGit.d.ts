import type { IDisposable } from '../../di';
import type { FsDiffRequest, FsDiffResponse, FsGitStatusRequest, FsGitStatusResponse } from '@spiderbyte/protocol';
export declare class FsGitUnavailableError extends Error {
    readonly cwd: string;
    readonly detail: string;
    constructor(cwd: string, detail: string);
}
export interface IFsGitService extends IDisposable {
    readonly _serviceBrand: undefined;
    status(sessionId: string, req: FsGitStatusRequest): Promise<FsGitStatusResponse>;
    diff(sessionId: string, req: FsDiffRequest): Promise<FsDiffResponse>;
}
export declare const IFsGitService: import("../..").ServiceIdentifier<IFsGitService>;
export declare function parsePorcelain(stdout: string, filter: Set<string> | undefined): FsGitStatusResponse;
/**
 * Sum added/deleted line counts from `git diff --numstat` output. Each line is
 * `<added>\t<deleted>\t<path>`; a binary file reports `-` for both counts, which
 * we treat as 0. Returns the aggregate across all files.
 */
export declare function parseNumstat(stdout: string): {
    additions: number;
    deletions: number;
};
