export declare function resolveKimiHome(homeDir?: string | undefined): string;
export declare function resolveConfigPath(input: {
    readonly homeDir?: string | undefined;
    readonly configPath?: string | undefined;
}): string;
export declare function ensureKimiHome(homeDir: string): void;
