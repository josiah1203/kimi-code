import { type ChatProvider, type ModelCapability, type ProviderConfig } from '@spiderbyte/kosong';
import type { Agent } from '..';
import type { AgentConfigData, AgentConfigUpdateData } from './types';
import { type ThinkingEffort } from './thinking';
export * from './types';
export { resolveThinkingEffort, type ThinkingEffort } from './thinking';
export declare class ConfigState {
    protected readonly agent: Agent;
    private _cwd;
    private _modelAlias;
    private _profileName;
    private _subagentNames;
    private _unforcedThinkingEffort;
    private _thinkingEffort;
    private _systemPrompt;
    constructor(agent: Agent);
    update(changed: AgentConfigUpdateData): void;
    /**
     * Restore config state without synthesizing a v1 replay record. This is
     * used when a v2-only wire record is projected onto v1 state: the state
     * should be available to the resumed agent, but the v2 record must not
     * appear as a `config_updated` event in the replay surface.
     */
    restore(changed: AgentConfigUpdateData): void;
    private applyUpdate;
    setThinkingEffort(effort: ThinkingEffort): void;
    data(): AgentConfigData;
    get cwd(): string;
    get hasModel(): boolean;
    get hasProvider(): boolean;
    get providerConfig(): ProviderConfig;
    /**
     * Memo of the base provider built by {@link provider}, keyed by config
     * content. The morphs applied per access (withThinking, sampling,
     * thinking.keep) clone the base, and the clones share provider-level state
     * — the OpenAI client and the reasoning-field dialect detected from inbound
     * responses. Rebuilding the base per access would silently reset that
     * dialect on every turn; a config change (model switch, credential refresh)
     * changes the key and rebuilds cleanly.
     */
    private providerMemo;
    get provider(): ChatProvider;
    get model(): string;
    get modelAlias(): string | undefined;
    get thinkingEffort(): ThinkingEffort;
    private get currentModel();
    private modelForThinking;
    get profileName(): string | undefined;
    get subagentNames(): readonly string[] | undefined;
    get systemPrompt(): string;
    get modelCapabilities(): ModelCapability;
    get maxOutputSize(): number | undefined;
    private get resolvedProviderConfig();
    private tryResolvedProviderConfig;
    private tryResolvedProviderConfigFor;
}
