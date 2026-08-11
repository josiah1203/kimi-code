export interface SessionWireScan {
    readonly firstActivityMs?: number | undefined;
    readonly lastActivityMs?: number | undefined;
    readonly lastUserMessageMs?: number | undefined;
    readonly firstUserInput?: string | undefined;
}
export declare function scanSessionWire(sessionDir: string): Promise<SessionWireScan>;
export declare function normalizeTimestampMs(value: number): number | undefined;
