/**
 * Agent-root resolution primitives: user, project, and configured discovery
 * roots, mirroring the skill scanner's directory conventions
 * (`skills` ↔ `agents`, `.kimi-code` ↔ `.agents`).
 *
 * Ported from the v2 engine (`packages/agent-core/src/app/agentFileCatalog/agentRoots.ts`)
 * — keep the two in sync: discovery-root conventions must land in both engines.
 */
import type { AgentFileRoot, AgentFileSource } from './types';
export interface AgentRootWarn {
    (message: string, error?: unknown): void;
}
export declare function userAgentRoots(brandHomeDir: string, osHomeDir: string, warn?: AgentRootWarn): Promise<readonly AgentFileRoot[]>;
export declare function projectAgentRoots(workDir: string, warn?: AgentRootWarn): Promise<readonly AgentFileRoot[]>;
export declare function configuredAgentRoots(dirs: readonly string[], workDir: string, osHomeDir: string, source: AgentFileSource, warn?: AgentRootWarn): Promise<readonly AgentFileRoot[]>;
