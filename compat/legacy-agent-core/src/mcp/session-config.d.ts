import type { McpServerConfig } from '#/config/schema';
export interface SessionMcpConfig {
    readonly servers: Record<string, McpServerConfig>;
}
export interface ResolveSessionMcpConfigInput {
    readonly cwd: string;
    readonly homeDir?: string;
}
export declare function resolveSessionMcpConfig(input: ResolveSessionMcpConfigInput): Promise<SessionMcpConfig | undefined>;
export declare function mergeCallerMcpServers(base: SessionMcpConfig | undefined, callerServers: Readonly<Record<string, McpServerConfig>> | undefined): SessionMcpConfig | undefined;
