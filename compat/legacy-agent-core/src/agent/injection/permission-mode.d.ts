import { DynamicInjector } from './injector';
export declare class PermissionModeInjector extends DynamicInjector {
    protected readonly injectionVariant = "permission_mode";
    private lastMode;
    private refreshAfterCompaction;
    onContextCompacted(): void;
    getInjection(): string | undefined;
}
