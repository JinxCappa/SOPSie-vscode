/**
 * Utility functions for error handling
 */

import { SopsError, SopsErrorType } from '../types';

/**
 * Narrow an unknown value to a {@link SopsError}. Rejected promises from
 * `SopsRunner` are plain objects, not `Error` instances, so structural
 * checks are the only safe discriminator.
 */
export function isSopsError(error: unknown): error is SopsError {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const candidate = error as Partial<SopsError>;
    return (
        typeof candidate.message === 'string' &&
        typeof candidate.type === 'string' &&
        (Object.values(SopsErrorType) as string[]).includes(candidate.type)
    );
}

/**
 * Extract a message string from an unknown error type.
 * Handles Error objects, strings, and other types safely.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
        const msg = (error as { message: unknown }).message;
        if (typeof msg === 'string') {
            return msg;
        }
    }
    return String(error);
}
