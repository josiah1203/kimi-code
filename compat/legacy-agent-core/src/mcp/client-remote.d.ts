import type { McpRemoteServerConfig, McpServerConfig } from '#/config/schema';
export declare function buildMcpRemoteHeaders(config: McpRemoteServerConfig, envLookup: (name: string) => string | undefined): Record<string, string> | undefined;
export declare function isRemoteMcpConfig(config: McpServerConfig): config is McpRemoteServerConfig;
