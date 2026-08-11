import type { GithubRef } from './source';
import type { PluginGithubRef } from './types';
export interface GithubSourceInput {
    readonly kind: 'github';
    readonly owner: string;
    readonly repo: string;
    readonly ref?: GithubRef;
}
export interface GithubSourceResolution {
    readonly tarballUrl: string;
    readonly displayVersion: string;
    readonly ref: PluginGithubRef;
}
/**
 * Resolve a `github` source descriptor to a downloadable zip URL.
 *
 * Hot path is the bare-URL case (no explicit ref). We deliberately avoid
 * `api.github.com` because its anonymous quota (60/hour per egress IP) is
 * shared with the user's browser, gh CLI, IDE integrations, etc., and
 * first-time install failing because some other tool burned the budget is
 * unacceptable for our UX.
 *
 * Strategy:
 *   1. Explicit ref → straight to codeload, zero network calls beforehand.
 *   2. Bare URL:
 *      a. GET `github.com/{owner}/{repo}/releases/latest` with manual
 *         redirect. 302 → extract tag from `Location` header. This is a
 *         documented-by-behavior GitHub UI route used by Homebrew, gh, etc.
 *         It is *not* part of the API quota.
 *      b. 404 or 302 to `/releases` (fork without own releases) → fall back
 *         to `codeload.github.com/{o}/{r}/zip/HEAD`, which streams the
 *         default branch tip without us needing to know its name.
 *      c. codeload 404 on HEAD → the repo itself does not exist.
 */
export declare function resolveGithubSource(input: GithubSourceInput): Promise<GithubSourceResolution>;
