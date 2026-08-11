/**
 * `AgentFileDefinition` → `ResolvedAgentProfile` adapter.
 *
 * The file body is a prompt template rendered against the agent-file variable
 * table: `${var}` placeholders substitute live context, and `${base_prompt}`
 * embeds the builtin default profile's prompt so a file can wrap the builtin
 * behavior instead of replacing it. The variable names and semantics match
 * the v2 engine (and the user docs), so the same agent file works on both
 * engines. The renderer is a plain `${var}` substitution — NOT the nunjucks
 * renderer the builtin YAML profiles use — so a literal `{{...}}` or an
 * unknown `${...}` in a user template can never crash rendering.
 *
 * `tools` resolves to the effective allowlist here: an omitted `tools` means
 * the default profile's tool set (v1 profiles have no "every tool" sentinel).
 * `disallowedTools` passes through to the profile verbatim and is evaluated
 * by the tool manager on top of the allowlist — exact builtin/user names and
 * `mcp__…` glob patterns both work, including partial server denies such as
 * `mcp__github__*` under an `mcp__*` allow. `subagents` stays an allowlist
 * of names on the definition; the catalog links it into the resolved record
 * after merging.
 *
 * Ported from the v2 engine (`packages/agent-core/src/app/agentFileCatalog/agentProfileFromFile.ts`)
 * — keep the two in sync: template variables and profile-mapping semantics
 * must land in both engines.
 */
import type { ResolvedAgentProfile, SystemPromptContext } from '../types';
import type { AgentFileDefinition } from './types';
export declare function agentFilePromptVars(context: SystemPromptContext, options: {
    readonly skillActive: boolean;
}): Record<string, string>;
export declare function renderAgentFileTemplate(template: string, context: SystemPromptContext, options: {
    readonly skillActive: boolean;
}, basePrompt?: (context: SystemPromptContext) => string): string;
export declare function skillActiveForAgentFile(definition: AgentFileDefinition): boolean;
/**
 * The effective tool allowlist for a file-defined profile: the file's own
 * `tools`, or the default profile's set when unrestricted. The denylist is
 * NOT folded in here — it rides the profile's `disallowedTools` so the tool
 * manager can evaluate glob patterns against resolved MCP tool names.
 */
export declare function agentFileTools(definition: AgentFileDefinition, defaultTools: readonly string[]): string[];
export declare function agentProfileFromFile(definition: AgentFileDefinition, defaultTools: readonly string[], basePrompt: (context: SystemPromptContext) => string): ResolvedAgentProfile;
