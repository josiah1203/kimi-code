import type { ActivatePluginCommandPayload, ActivateSkillPayload, PromptPayload } from '#/rpc';
export declare function titleFromPromptMetadataText(text: string): string;
export declare function promptMetadataTextFromPayload(payload: PromptPayload): string | undefined;
export declare function promptMetadataTextFromSkill(payload: ActivateSkillPayload): string | undefined;
export declare function promptMetadataTextFromPluginCommand(payload: ActivatePluginCommandPayload): string | undefined;
