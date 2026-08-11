import type { Agent } from '..';
export declare class InjectionManager {
    protected readonly agent: Agent;
    private readonly injectors;
    private readonly goalInjector;
    private readonly toolsDiffInjector;
    constructor(agent: Agent);
    inject(): Promise<void>;
    /**
     * Appends a fresh goal-context reminder at a continuation boundary. Append-only
     * (never mutates the prefix) so prompt caching is preserved; no-ops when goal
     * mode is off, the agent is not the main agent, or there is nothing to inject.
     */
    injectGoal(): Promise<void>;
    /**
     * Appends a loadable-tools diff announcement when the loadable set changed.
     * Boundary cadence (turn start + post-compaction); no-op when the disclosure
     * gate is closed or nothing changed.
     */
    injectToolsDiff(): void;
    injectAfterCompaction(): Promise<void>;
    /**
     * Post-compaction only: re-surface still-running background tasks. Folding the
     * live context to [recent user prompts, summary] drops the messages that
     * started them and their status updates, so without this the model can forget
     * a task is running and spawn a duplicate. Appended as an `injection`-origin
     * reminder, so the next compaction drops and rebuilds it — kept fresh, never
     * stacked. Runs only on the live path: restore replays the persisted reminder
     * and `FullCompaction.begin` short-circuits before compaction there.
     */
    private injectActiveBackgroundTasks;
    onContextClear(): void;
    onContextCompacted(): void;
    onContextMessageRemoved(index: number): void;
    /** Per-step injectors plus the boundary goal injector, for lifecycle events. */
    private lifecycleInjectors;
    private activeGoalInjector;
}
