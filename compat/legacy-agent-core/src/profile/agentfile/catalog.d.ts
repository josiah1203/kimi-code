/**
 * Session-level agent profile catalog.
 *
 * Merges the builtin (code-embedded) profiles with the file-backed sources
 * (plugin / user / extra / project / explicit) by priority, requiring an
 * explicit
 * opt-in (`override: true`) before a file replaces a same-name builtin. The
 * merged view always contains the builtin profiles (seeded at construction);
 * file profiles appear once `ready` resolves. A failing `explicit` source (an
 * invalid `--agent-file`) rejects `ready` so session creation surfaces the
 * error; a failing directory source degrades to warnings, so directory
 * problems never poison the session.
 *
 * After merging, the catalog links the delegation graph: a file profile's
 * `subagents` allowlist resolves against the merged set (an omitted allowlist
 * means "any type"), and the builtin default profile's subagent set extends
 * with every file-defined profile so the main agent can delegate to custom
 * agents.
 *
 * Semantics mirror the v2 engine's agentFileCatalog domain
 * (`packages/agent-core/src/app/agentFileCatalog/`, e.g. `agentProfileSource.ts`
 * and `userFileAgentSource.ts`) — keep merge/override/delegation behavior in
 * sync across both engines.
 */
import type { ResolvedAgentProfile } from '../types';
import { type AgentFileRoot, type AgentProfileCatalogSnapshot } from './types';
export interface SessionAgentCatalogOptions {
    readonly workDir: string;
    /** Brand data dir (`KIMI_CODE_HOME`, default `~/.kimi-code`). */
    readonly brandHomeDir: string;
    /** OS home dir, for `~/.agents/agents` and `~` expansion. */
    readonly osHomeDir: string;
    readonly extraDirs?: readonly string[];
    readonly explicitFiles?: readonly string[];
    /** Agent directories contributed by enabled plugins (lowest file priority). */
    readonly pluginRoots?: readonly AgentFileRoot[];
    readonly warn?: (message: string, error?: unknown) => void;
}
export declare const DEFAULT_AGENT_PROFILE_NAME = "agent";
export declare class SessionAgentProfileCatalog {
    private readonly options;
    private merged;
    private readonly readyPromise;
    private snapshotValue;
    constructor(options: SessionAgentCatalogOptions);
    get ready(): Promise<void>;
    get(name: string): ResolvedAgentProfile | undefined;
    getDefault(): ResolvedAgentProfile;
    list(): readonly ResolvedAgentProfile[];
    snapshot(): AgentProfileCatalogSnapshot | undefined;
    /** Replace live discovery with the file-backed catalog bound at creation. */
    restoreSnapshot(snapshot: AgentProfileCatalogSnapshot): void;
    /** Replace only the persisted plugin layer while keeping the session-bound local profiles. */
    restoreSnapshotRefreshingPlugins(snapshot: AgentProfileCatalogSnapshot, pluginRoots: readonly AgentFileRoot[]): Promise<void>;
    private entriesFromSnapshot;
    /**
     * The subagent types `callerProfileName` may delegate to: the caller's own
     * linked set, falling back to the default profile's set when the caller
     * declares none (mirroring the historical lookup against the builtin
     * `agent` profile).
     */
    delegatableSubagents(callerProfileName?: string): Record<string, ResolvedAgentProfile>;
    private load;
    /**
     * Surface dead tool patterns (bare wildcards, incomplete `mcp__` literals,
     * unknown tool names) at load time, so a typo in a hand-written agent file
     * warns instead of silently shrinking the profile's tool set.
     */
    private warnInactivePatterns;
    private systemMdEntry;
    private entryFromDefinition;
    private applyFileEntries;
    private snapshotFromEntries;
    private snapshotSystemDefinition;
    private linkSubagentAllowlist;
    private get warn();
}
