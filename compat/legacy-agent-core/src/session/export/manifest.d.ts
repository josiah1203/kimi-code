import type { SessionWireScan } from '#/session/export/wire-scan';
import type { ExportSessionManifest, ShellEnvironment, SessionSummary } from '#/rpc/core-api';
export declare const WIRE_PROTOCOL_VERSION = "1.4";
export declare function buildExportManifest(args: {
    readonly summary: SessionSummary;
    readonly now: Date;
    readonly version: string;
    readonly wireProtocolVersion?: string | undefined;
    readonly sessionScan: SessionWireScan;
    readonly sessionLogPath?: string | undefined;
    readonly globalLogPath?: string | undefined;
    readonly installSource?: string | undefined;
    readonly shellEnv?: ShellEnvironment | undefined;
}): ExportSessionManifest;
