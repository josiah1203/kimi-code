import type { EnabledPluginSessionStart } from '../../plugin/types';
import type { SkillDefinition } from '../../skill';
import { DynamicInjector } from './injector';
export interface RenderPluginSessionStartReminderInput {
    readonly sessionStarts: readonly EnabledPluginSessionStart[];
    readonly registry: {
        getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined;
        renderSkillPrompt(skill: SkillDefinition, args: string): string;
    } | undefined;
    readonly log?: {
        warn(message: string, payload?: unknown): void;
    };
}
/**
 * Renders the `<plugin_session_start>` reminder blocks for the currently enabled
 * plugin session starts. Returns `undefined` when there is nothing to render
 * (no session starts, no registry, or no resolvable skills).
 *
 * Shared by the turn-loop injector (which dedups against history) and the
 * explicit `/reload` flow (which force-appends a fresh reminder).
 */
export declare function renderPluginSessionStartReminder(input: RenderPluginSessionStartReminderInput): string | undefined;
export declare class PluginSessionStartInjector extends DynamicInjector {
    protected readonly injectionVariant = "plugin_session_start";
    protected getInjection(): Promise<string | undefined>;
}
