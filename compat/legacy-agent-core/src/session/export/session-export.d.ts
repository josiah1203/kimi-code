import type { ExportSessionPayload, ExportSessionResult, SessionSummary } from '#/rpc/core-api';
export declare function exportSessionDirectory(input: {
    readonly request: ExportSessionPayload;
    readonly summary: SessionSummary;
    readonly homeDir?: string | undefined;
    readonly globalLogPath?: string | undefined;
}): Promise<ExportSessionResult>;
