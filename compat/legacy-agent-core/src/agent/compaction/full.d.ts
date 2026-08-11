import type { Agent } from '..';
import type { CompactionBeginData } from './types';
import { type CompactionStrategy } from './strategy';
export declare const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
export declare class FullCompaction {
    protected readonly agent: Agent;
    protected compactionCountInTurn: number;
    protected compacting: {
        abortController: AbortController;
        promise: Promise<void>;
        blockedByTurn: boolean;
    } | null;
    private readonly observedMaxContextTokensByModel;
    private lastCompactedTokenCount;
    private consecutiveOverflowCompactions;
    private lastSummarizerTraceId;
    private activeSummarizerTrace;
    protected readonly strategy: CompactionStrategy;
    constructor(agent: Agent, strategy?: CompactionStrategy);
    get isCompacting(): boolean;
    /** Trace id (`x-trace-id`, Kimi/KFC only) of the latest summarizer request. */
    get lastTraceId(): string | undefined;
    getEffectiveMaxContextTokens(): number;
    estimateCurrentRequestTokens(): number;
    shouldRecoverFromContextOverflow(error: unknown, estimatedRequestTokens?: number): boolean;
    observeContextOverflow(estimatedRequestTokens: number): void;
    begin(data: Readonly<CompactionBeginData>): void;
    cancel(): void;
    markCompleted(): void;
    private get tokenCountWithPending();
    private estimateRequestTokens;
    resetForTurn(): void;
    handleOverflowError(signal: AbortSignal, error: unknown): Promise<void>;
    beforeStep(signal: AbortSignal): Promise<void>;
    afterStep(): Promise<void>;
    private checkAutoCompaction;
    private beginAutoCompaction;
    private block;
    private compactionWorker;
    private buildInstruction;
    private postProcessSummary;
    private compactionRound;
    private triggerPreCompactHook;
    private triggerPostCompactHook;
}
