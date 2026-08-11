import { type ResolvedAgentProfile } from './types';
export declare function loadAgentProfilesFromDir(paths: readonly string[]): Promise<Record<string, ResolvedAgentProfile>>;
export declare function loadAgentProfilesFromSources(paths: readonly string[], sources: Readonly<Record<string, string>>): Record<string, ResolvedAgentProfile>;
