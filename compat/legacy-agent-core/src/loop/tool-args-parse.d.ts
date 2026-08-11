export type ParseToolArgsResult = {
    readonly success: true;
    readonly data: unknown;
    readonly parseFailed: boolean;
    readonly error?: string;
};
export declare function parseToolCallArguments(raw: string | null): ParseToolArgsResult;
