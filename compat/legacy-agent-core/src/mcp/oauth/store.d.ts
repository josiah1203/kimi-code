/**
 * Small atomic JSON file store used by the MCP OAuth provider to persist
 * tokens, registered client info, and discovery state under
 * `<KIMI_CODE_HOME>/credentials/mcp/` (default
 * `~/.kimi-code/credentials/mcp/`).
 *
 * Write semantics: write to `<file>.tmp.<pid>.<rand>` → fsync → rename.
 * Atomic on POSIX; best-effort on Windows. Files land at mode 0600 (parent
 * dir 0700) so other local users cannot read tokens.
 *
 * Read semantics: missing file → undefined. Corrupt JSON / wrong shape →
 * undefined (never throws). The provider treats undefined as "not stored".
 */
export declare function mcpCredentialsDir(kimiHomeDir: string): string;
export declare function defaultMcpCredentialsDir(): string;
export declare function sanitizeStoreKey(name: string): string;
export declare function canonicalMcpOAuthResource(serverUrl: string | URL): string;
export declare function mcpOAuthStoreKey(serverName: string, serverUrl: string | URL): string;
export declare class JsonFileStore {
    private readonly dir;
    constructor(dir?: string);
    read<T>(file: string): T | undefined;
    write(file: string, data: unknown): void;
    remove(file: string): void;
}
