import { type McpServerConfig } from '#/config/schema';
export type GlobalMcpServerConfig = McpServerConfig & {
    readonly name: string;
};
export declare class GlobalMcpConfigStore {
    readonly path: string;
    constructor(homeDir?: string);
    list(): Promise<readonly GlobalMcpServerConfig[]>;
    get(name: string): Promise<GlobalMcpServerConfig>;
    add(server: GlobalMcpServerConfig): Promise<readonly GlobalMcpServerConfig[]>;
    update(server: GlobalMcpServerConfig): Promise<readonly GlobalMcpServerConfig[]>;
    remove(name: string): Promise<readonly GlobalMcpServerConfig[]>;
    private read;
    private write;
}
