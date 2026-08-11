/**
 * Git repository context for explore subagents.
 *
 * `collectGitContext` produces a `<git-context>` block that is prepended to a
 * fresh explore subagent's prompt so it can orient itself in the repository
 * before searching. Every git probe is best-effort: probes fail in perfectly
 * normal states (no `origin` remote, no commits yet, detached HEAD, older
 * Git), so a failed probe is logged and its section omitted rather than
 * dropping the whole block. The block is omitted entirely only when nothing
 * useful was collected. The one explicit state surfaced to the subagent is
 * `reason="not-a-repo"`, so it doesn't waste turns probing git history in a
 * non-repo directory. Remote URLs are sanitized so internal infrastructure
 * is not surfaced to the model.
 */
import type { Kaos } from '@spiderbyte/kaos';
/**
 * Collect git context for the explore agent.
 *
 * Returns a formatted `<git-context>` block, or an empty string if the
 * directory is not a git repository or no useful information was collected.
 */
export declare function collectGitContext(kaos: Kaos, cwd: string): Promise<string>;
/**
 * Return the remote URL if it points to a well-known public host, stripping
 * credentials from HTTPS URLs. Returns `null` for unrecognized hosts.
 */
export declare function sanitizeRemoteUrl(remoteUrl: string): string | null;
/**
 * Extract the project path from a git remote URL — `owner/repo`, or the full
 * `group/subgroup/repo` for nested namespaces (e.g. GitLab subgroups).
 * Supports scp-like SSH (`git@host:path`) and URL forms (`https://`, `ssh://`).
 */
export declare function parseProjectName(remoteUrl: string): string | null;
