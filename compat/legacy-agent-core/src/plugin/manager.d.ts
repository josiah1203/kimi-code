import type { McpServerConfig } from '../config/schema';
import type { AgentFileRoot } from '../profile/agentfile/types';
import { type SkillRoot } from '../skill';
import type { HookDef } from '../session/hooks';
import { type EnabledPluginSessionStart, type EnabledPluginSystemPrompt, type PluginCommandDef, type PluginInfo, type PluginRecord, type PluginSummary, type ReloadSummary } from './types';
export interface PluginManagerOptions {
    readonly kimiHomeDir: string;
}
export declare class PluginManager {
    private readonly kimiHomeDir;
    private records;
    constructor(options: PluginManagerOptions);
    load(): Promise<void>;
    list(): readonly PluginRecord[];
    get(id: string): PluginRecord | undefined;
    install(source: string): Promise<PluginRecord>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    setMcpServerEnabled(id: string, server: string, enabled: boolean): Promise<void>;
    remove(id: string): Promise<void>;
    reload(): Promise<ReloadSummary>;
    pluginSkillRoots(): readonly SkillRoot[];
    pluginAgentRoots(): readonly AgentFileRoot[];
    enabledSessionStarts(): readonly EnabledPluginSessionStart[];
    enabledSystemPrompts(): readonly EnabledPluginSystemPrompt[];
    enabledMcpServers(): Record<string, McpServerConfig>;
    enabledHooks(): readonly HookDef[];
    enabledCommands(): Promise<readonly PluginCommandDef[]>;
    summaries(): readonly PluginSummary[];
    info(id: string): PluginInfo | undefined;
    private persist;
    private materialize;
}
