/**
 * JSON canonicalization used by tool-call telemetry and dedup.
 * Recursively sorts object keys so semantically-equal args produce identical keys.
 */
export declare function canonicalTelemetryArgs(args: unknown): string;
export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
