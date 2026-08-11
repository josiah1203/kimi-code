import type { RawAgentProfile, ResolvedAgentProfile } from './types';
/**
 * Resolve agent profiles with extends inheritance.
 *
 * Each resolved profile exposes its `systemPrompt` as a renderer that
 * closes over the merged template and prompt vars. The renderer is
 * invoked later with a {@link SystemPromptContext} to produce the
 * concrete prompt — this lets context that only exists at runtime
 * (cwd listing, AGENTS.md, skills) flow through without re-loading
 * profiles.
 */
export declare function resolveAgentProfiles(raw: readonly RawAgentProfile[]): Record<string, ResolvedAgentProfile>;
