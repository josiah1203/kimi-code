import { type PathClass } from '../policies/path-access';
export interface PermissionPathMatchOptions {
    readonly cwd?: string;
    readonly pathClass?: PathClass;
    readonly homeDir?: string;
    readonly caseInsensitivePaths?: boolean;
}
/**
 * Match ordinary string fields, like command text or search patterns.
 * `*` and `**` work as wildcards, but the value is not treated as a file path.
 */
export declare function globMatch(value: string, pattern: string, options?: {
    nocase?: boolean;
}): boolean;
/**
 * Match file path fields, like Read/Write/Edit `path`.
 * Also compares normalized forms, so `./a`, `dir/../a`, and Windows
 * separator or case variants can match the same rule.
 */
export declare function pathGlobMatch(value: string, pattern: string, pathOptions?: PermissionPathMatchOptions): boolean;
