/**
 * `SYSTEM.md` global main-agent prompt override.
 *
 * `<brandHome>/SYSTEM.md` (default `~/.kimi-code/SYSTEM.md`, moves with
 * `KIMI_CODE_HOME`) permanently replaces the builtin default profile's system
 * prompt while the file exists and is non-empty. Only the prompt is replaced
 * — every other profile capability comes from the builtin default — and
 * explicit intent still wins: higher-priority sources (project `agent.md`,
 * `--agent-file`) override it, and binding a different profile ignores it.
 * The body is a prompt template rendered against the agent-file variable
 * table: `${var}` placeholders substitute live context, and `${base_prompt}`
 * embeds the builtin default prompt. A missing or empty file yields no
 * definition; a read failure degrades to `warn` instead of rejecting,
 * matching the directory-source policy that a transient fs error must never
 * poison a session.
 *
 * Ported from the v2 engine (`packages/agent-core/src/app/agentFileCatalog/systemFile.ts`)
 * — keep the two in sync: SYSTEM.md semantics must land in both engines.
 */
import type { ResolvedAgentProfile } from '../types';
import type { AgentFileDefinition } from './types';
export declare const SYSTEM_MD_FILENAME = "SYSTEM.md";
/**
 * Loads `<brandHome>/SYSTEM.md` as a synthetic agent-file definition for the
 * default profile, or `undefined` when the file is absent or empty.
 */
export declare function loadSystemMdDefinition(brandHome: string, warn: (message: string) => void): Promise<AgentFileDefinition | undefined>;
/**
 * Builds the SYSTEM.md profile variant: the builtin default with its system
 * prompt replaced by the file body. Every other capability comes from the
 * builtin default.
 */
export declare function systemMdProfile(definition: AgentFileDefinition, builtinDefault: ResolvedAgentProfile): ResolvedAgentProfile;
