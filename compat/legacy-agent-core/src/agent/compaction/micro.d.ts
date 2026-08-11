import type { Agent } from '..';
import type { ContextMessage } from '../context';
export interface MicroCompactionConfig {
    keepRecentMessages: number;
    minContentTokens: number;
    cacheMissedThresholdMs: number;
    truncatedMarker: string;
    minContextUsageRatio: number;
}
export declare class MicroCompaction {
    readonly agent: Agent;
    private cutoff;
    readonly config: MicroCompactionConfig;
    constructor(agent: Agent, config?: Partial<MicroCompactionConfig>);
    reset(maxCutoff?: number): void;
    apply(cutoff: number): void;
    detect(): void;
    compact(messages: readonly ContextMessage[]): readonly ContextMessage[];
    private measureEffect;
}
