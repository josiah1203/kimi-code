/**
 * Loop-local error helpers.
 */
import { KimiError } from '#/errors';
export declare function createMaxStepsExceededError(maxSteps: number, message?: string): KimiError;
export declare function isMaxStepsExceededError(error: unknown): boolean;
export declare function isAbortError(err: unknown): boolean;
export declare function errorMessage(err: unknown): string;
