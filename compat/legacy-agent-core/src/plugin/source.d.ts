export interface GithubRef {
    readonly kind: 'branch' | 'tag' | 'sha';
    readonly value: string;
}
export type ResolvedSource = {
    kind: 'local-path';
    path: string;
} | {
    kind: 'zip-url';
    path: string;
} | {
    kind: 'github';
    owner: string;
    repo: string;
    ref?: GithubRef;
};
export type InstallSource = ResolvedSource;
export declare function resolveInstallSource(source: string): ResolvedSource;
