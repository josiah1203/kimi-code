import type { Agent } from '..';
export declare abstract class DynamicInjector {
    protected readonly agent: Agent;
    protected injectedAt: number | null;
    constructor(agent: Agent);
    onContextClear(): void;
    onContextCompacted(): void;
    onContextMessageRemoved(index: number): void;
    inject(): Promise<void>;
    protected abstract readonly injectionVariant: string;
    protected abstract getInjection(): string | Promise<string | undefined> | undefined;
}
