/**
 * Marker-based git work-tree detection. Never spawns `git`; failures return
 * null so callers can fall back to their safer path.
 */
import type { Kaos } from '@spiderbyte/kaos';
export interface GitWorkTreeMarker {
    readonly dotGitPath: string;
    readonly controlDirPath: string;
}
export declare function findGitWorkTreeMarker(kaos: Kaos, cwd: string): Promise<GitWorkTreeMarker | null>;
