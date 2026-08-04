/**
 * Retry-with-backoff for transient LLM API failures. Provider-agnostic -
 * doesn't assume Anthropic specifically, just duck-types on a `.status`
 * property and an optional `.headers` object, since that's the stable shape
 * most REST-wrapping SDKs (Anthropic, OpenAI, etc.) throw on non-2xx
 * responses.
 */

export interface RetryOptions {
    /** Maximum number of retry attempts after the first try. Default 3. */
    maxRetries?: number;
    /** Base delay before the first retry, in ms. Default 1000. */
    initialDelayMs?: number;
    /** Ceiling on computed backoff delay, in ms. Default 20000. */
    maxDelayMs?: number;
}

// Status codes worth retrying: rate limits, and Anthropic/most providers'
// transient server-side failure codes. Deliberately NOT retrying other 4xx
// (400, 401, 403, 404, etc.) - those are client errors that will fail
// identically on every attempt, so retrying just wastes time and money.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

export function isRetryableStatus(status: number | undefined): boolean {
    return status !== undefined && RETRYABLE_STATUS_CODES.has(status);
}

/**
 * Reads a Retry-After header off an error object, if present, in either the
 * fetch-style Headers object shape (`.get()`) or a plain object shape
 * (`error.headers["retry-after"]`) - different SDKs expose this differently.
 * Returns null if absent or unparseable, so the caller falls back to
 * computed exponential backoff instead.
 */
export function getRetryAfterMs(error: unknown): number | null {
    const err = error as { headers?: { get?: (name: string) => string | null } & Record<string, unknown> };
    const raw =
        typeof err?.headers?.get === "function"
            ? err.headers.get("retry-after")
            : (err?.headers?.["retry-after"] as string | undefined);

    if (!raw) return null;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs fn(), retrying on transient failures with exponential backoff plus
 * jitter (to avoid a thundering-herd of retries all landing on the same
 * millisecond if multiple callers hit a rate limit at once). Honors a
 * Retry-After header when the error provides one, since that's an explicit
 * instruction from the server about exactly how long to wait - more
 * reliable than guessing via backoff math.
 *
 * Non-retryable errors (a bad request, an auth failure, etc.) are thrown
 * immediately on the first attempt - retrying those would just fail the
 * same way every time.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const initialDelayMs = options.initialDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 20000;

    let attempt = 0;

    while (true) {
        try {
            return await fn();
        } catch (error: unknown) {
            const status = (error as { status?: number })?.status;

            if (!isRetryableStatus(status) || attempt >= maxRetries) {
                throw error;
            }

            const retryAfterMs = getRetryAfterMs(error);
            const computedBackoffMs = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
            const baseDelayMs = retryAfterMs ?? computedBackoffMs;

            // +/- 25% jitter, applied even to a server-specified retry-after,
            // so many simultaneous callers don't all retry in lockstep.
            const jitteredMs = baseDelayMs * (0.75 + Math.random() * 0.5);

            await sleep(jitteredMs);
            attempt++;
        }
    }
}