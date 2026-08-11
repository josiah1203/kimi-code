import type { CompactionSource } from './types';
export interface CompactionConfig {
    /** Fraction of the model context window that triggers auto-compaction. */
    triggerRatio: number;
    /** Fraction of the model context window that blocks the turn on compaction. */
    blockRatio: number;
    /** Reserved output budget; compaction triggers early to leave this much room. */
    reservedContextSize: number;
    /** Maximum number of auto-compactions allowed in a single turn. */
    maxCompactionPerTurn: number;
    /**
     * Consecutive provider-overflow recoveries (overflow -> compact -> overflow
     * again) allowed in a single turn before giving up. Caps the loop when
     * compaction can no longer shrink the request below the model window.
     */
    maxOverflowCompactionAttempts: number;
}
/**
 * Auto-compact at 85% of the resolved context window. `blockRatio` matches
 * `triggerRatio` so compaction runs synchronously with no background
 * compaction.
 */
export declare const DEFAULT_COMPACTION_CONFIG: CompactionConfig;
export interface CompactionStrategy {
    shouldCompact(usedSize: number): boolean;
    shouldBlock(usedSize: number): boolean;
    readonly checkAfterStep: boolean;
    readonly maxCompactionPerTurn: number;
    readonly maxOverflowCompactionAttempts: number;
}
export declare class DefaultCompactionStrategy implements CompactionStrategy {
    protected readonly maxSizeProvider: () => number;
    protected readonly config: CompactionConfig;
    constructor(maxSizeProvider: () => number, config?: CompactionConfig);
    protected get maxSize(): number;
    shouldCompact(usedSize: number): boolean;
    shouldBlock(usedSize: number): boolean;
    private shouldUseReservedContext;
    get checkAfterStep(): boolean;
    get maxCompactionPerTurn(): number;
    get maxOverflowCompactionAttempts(): number;
}
export type { CompactionSource };
