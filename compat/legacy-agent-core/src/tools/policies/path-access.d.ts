/**
 * Path safety guards used by Read/Write/Edit/Grep/Glob.
 *
 * Canonicalization is **lexical** only (no `realpath` / symlink following).
 * Mirrors `KaosPath.canonical()` and keeps the guard backend-aware:
 * callers should pass the active Kaos path class so SSH paths stay POSIX
 * even when the host Node process is running on Windows.
 *
 * Shared-prefix escapes (a path like `/workspace-evil` passing a naive
 * `startswith('/workspace')` check) are blocked by requiring a path
 * separator (or exact equality) after the base prefix in
 * `isWithinDirectory`.
 */
import type { Kaos } from '@spiderbyte/kaos';
import type { WorkspaceConfig } from '../support/workspace';
export type PathClass = 'posix' | 'win32';
export type PathSecurityCode = 'PATH_OUTSIDE_WORKSPACE' | 'PATH_SENSITIVE' | 'PATH_INVALID';
export type PathAccessOperation = 'read' | 'write' | 'search';
export type WorkspaceGuardMode = 'absolute-outside-allowed' | 'disabled';
export interface WorkspaceAccessPolicy {
    readonly guardMode: WorkspaceGuardMode;
    readonly checkSensitive: boolean;
}
export declare const DEFAULT_WORKSPACE_ACCESS_POLICY: WorkspaceAccessPolicy;
export interface PathAccess {
    readonly path: string;
    readonly outsideWorkspace: boolean;
}
export declare class PathSecurityError extends Error {
    readonly code: PathSecurityCode;
    readonly rawPath: string;
    readonly canonicalPath: string;
    constructor(code: PathSecurityCode, rawPath: string, canonicalPath: string, message: string);
}
export declare function normalizeUserPath(path: string, pathClass?: PathClass): string;
/**
 * Lexical canonicalization: resolve relative → absolute against `cwd`,
 * then normalize `..` / `.` segments. No filesystem I/O.
 */
export declare function canonicalizePath(path: string, cwd: string, pathClass?: PathClass): string;
/**
 * True iff `candidate` is `base` itself or a descendant of it, compared
 * on path-component boundaries. Both arguments must already be canonical.
 */
export declare function isWithinDirectory(candidate: string, base: string, pathClass?: PathClass): boolean;
/**
 * True iff `candidate` (already canonical) sits inside any of the workspace
 * roots listed in `config` (primary `workspaceDir` or any `additionalDirs`).
 */
export declare function isWithinWorkspace(candidate: string, config: WorkspaceConfig, pathClass?: PathClass): boolean;
export interface AssertPathOptions {
    readonly mode: PathAccessOperation;
    /** When true (default), also reject paths matching a sensitive-file pattern. */
    readonly checkSensitive?: boolean | undefined;
    readonly pathClass?: PathClass | undefined;
}
export interface ResolvePathAccessOptions {
    readonly operation: PathAccessOperation;
    readonly policy?: WorkspaceAccessPolicy | undefined;
    readonly pathClass?: PathClass | undefined;
    readonly homeDir?: string;
}
export interface ResolvePathAccessPathOptions {
    readonly kaos: Pick<Kaos, 'pathClass' | 'gethome'>;
    readonly workspace: WorkspaceConfig;
    readonly operation: PathAccessOperation;
    readonly policy?: WorkspaceAccessPolicy;
    readonly expandHome?: boolean;
}
export declare function resolvePathAccess(path: string, cwd: string, config: WorkspaceConfig, options: ResolvePathAccessOptions): PathAccess;
export declare function resolvePathAccessPath(path: string, options: ResolvePathAccessPathOptions): string;
/**
 * Throw `PathSecurityError` if `path` escapes the workspace through a relative
 * path, matches a known sensitive file, or is empty. Returns the canonical
 * absolute path when the check passes.
 *
 * Note: this is purely lexical. It does NOT protect against symlink
 * targets that point outside the workspace — that would require kaos-layer
 * realpath support, which is not currently available.
 */
export declare function assertPathAllowed(path: string, cwd: string, config: WorkspaceConfig, options: AssertPathOptions): string;
