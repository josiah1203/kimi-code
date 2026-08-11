export declare function abortError(message?: string): Error;
/**
 * Marks an abort the user triggered deliberately (e.g. pressing ESC to
 * interrupt the agent), as distinct from a timeout, an internal error, or any
 * other programmatic abort. It travels as the AbortSignal's `reason`, so code
 * that settles an interrupted operation can tell a user interruption apart from
 * a failure and report it to the model accordingly instead of emitting a
 * neutral "was aborted" that the model mistakes for a system problem.
 *
 * `name` stays 'AbortError' so existing `isAbortError()` checks (and
 * `AbortSignal.throwIfAborted()`) keep treating it as an abort.
 */
export declare class UserCancellationError extends Error {
    readonly userCancelled = true;
    constructor();
}
export declare function userCancellationReason(): UserCancellationError;
export declare function isUserCancellation(value: unknown): value is UserCancellationError;
export declare function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;
export declare function linkAbortSignal(source: AbortSignal, target: AbortController): () => void;
export declare function abortReason(signal: AbortSignal): Error;
export interface DeadlineAbortSignal {
    readonly signal: AbortSignal;
    readonly timedOut: () => boolean;
    readonly clear: () => void;
}
export declare function createDeadlineAbortSignal(source: AbortSignal, timeoutMs: number): DeadlineAbortSignal;
