/**
 * Filesystem agent-file discovery.
 *
 * Discovers and parses agent files. Invalid files are isolated from the rest
 * of the discovery pass. Failure policy: below a root, ANY readdir failure
 * (notably EACCES) skips just that directory — one unreadable subdirectory
 * must not zero the whole source, mirroring the skill discovery's
 * per-directory tolerance; at a root, a missing directory is simply "no
 * agents here", and any other failure skips just that root. Skip warnings are
 * capped (`MAX_SKIP_WARNINGS`) so a misconfigured root (e.g. an extra dir
 * pointing at a docs-heavy tree) cannot spam one line per non-agent file;
 * the returned `skipped` list keeps the full parse-failure detail regardless,
 * and the capping summary names a few suppressed paths so the rest stay
 * findable.
 *
 * Ported from the v2 engine (`packages/agent-core/src/app/agentFileCatalog/agentFileDiscovery.ts`)
 * — keep the two in sync: discovery behavior changes must land in both engines.
 */
import type { AgentFileDiscoveryResult, AgentFileRoot } from './types';
export interface DiscoverAgentFilesWarn {
    (message: string, error?: unknown): void;
}
export declare function discoverAgentFiles(roots: readonly AgentFileRoot[], warn?: DiscoverAgentFilesWarn): Promise<AgentFileDiscoveryResult>;
