/**
 * list-directory — compact 2-level directory tree for LLM context.
 *
 * Used by GlobTool when rejecting a `**`-leading pattern: appending a
 * snapshot of the workspace root helps the LLM re-scope its pattern
 * without a second round-trip.
 *
 * Width caps keep the system-prompt token budget bounded:
 *   - Depth 0 (root):  up to LIST_DIR_ROOT_WIDTH entries
 *   - Depth 1 (children of root dirs): up to LIST_DIR_CHILD_WIDTH entries
 *   - Truncated levels show "... and N more" so the LLM knows more exists.
 */
import type { Kaos } from '@spiderbyte/kaos';
export declare const LIST_DIR_ROOT_WIDTH = 30;
export declare const LIST_DIR_CHILD_WIDTH = 10;
export interface ListDirectoryOptions {
    readonly collapseHiddenDirs?: boolean;
}
/**
 * Return a 2-level tree listing of `workDir` suitable for inclusion in a
 * tool error message. Returns `"(empty directory)"` if the directory is
 * empty, or an error marker line if the directory itself is unreadable.
 */
export declare function listDirectory(kaos: Kaos, workDir?: string, options?: ListDirectoryOptions): Promise<string>;
