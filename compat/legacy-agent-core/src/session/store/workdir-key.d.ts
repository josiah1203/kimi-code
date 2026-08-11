export declare function normalizeWorkDir(workDir: string): string;
export declare function encodeWorkDirKey(workDir: string): string;
/**
 * Identity key for "same workspace directory?" comparisons: slash-normalize,
 * strip trailing separators, case-fold Windows-shaped paths (NTFS lookups are
 * case-insensitive by default). Pure string ops — deliberately NOT
 * normalizeWorkDir/pathe.resolve, which join the process cwd into
 * Windows-shaped strings on POSIX hosts. Comparison only; stored/displayed
 * paths are never rewritten. Per-directory case sensitivity (fsutil) / WSL
 * paths are a documented non-goal; POSIX paths never fold.
 */
export declare function workspaceRootKey(root: string): string;
