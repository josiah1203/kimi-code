export type TimeoutOutcomePromise<Outcome> = Promise<Outcome> & {
    clear(): void;
};
export declare function timeoutOutcome<Outcome>(timeoutMs: number | undefined, outcome: Outcome): TimeoutOutcomePromise<Outcome>;
export type ResettableTimeoutPromise<Outcome> = Promise<Outcome> & {
    /** Restart the timer from now with a new duration; the same promise resolves when it fires. */
    reset(timeoutMs: number | undefined): void;
    clear(): void;
};
/**
 * Like `timeoutOutcome`, but the timer can be restarted via `reset()` while the
 * returned promise stays the same — so a `Promise.race` that already captured it
 * observes the new deadline. Used to extend a task's timeout (e.g. when a
 * foreground command is detached to the background).
 */
export declare function resettableTimeoutOutcome<Outcome>(initialMs: number | undefined, outcome: Outcome): ResettableTimeoutPromise<Outcome>;
