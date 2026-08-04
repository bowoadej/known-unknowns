import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isRetryableStatus, getRetryAfterMs } from "../retry.js";

function fakeError(status: number, headers?: Record<string, string>) {
    const err: any = new Error(`fake ${status} error`);
    err.status = status;
    if (headers) err.headers = headers;
    return err;
}

test("isRetryableStatus: retryable codes", () => {
    for (const code of [429, 500, 502, 503, 504, 529]) {
        assert.equal(isRetryableStatus(code), true, `expected ${code} to be retryable`);
    }
});

test("isRetryableStatus: non-retryable codes and undefined", () => {
    for (const code of [400, 401, 403, 404, 413, undefined]) {
        assert.equal(isRetryableStatus(code), false, `expected ${code} to NOT be retryable`);
    }
});

test("getRetryAfterMs: reads a plain-object header", () => {
    const err = fakeError(429, { "retry-after": "2" });
    assert.equal(getRetryAfterMs(err), 2000);
});

test("getRetryAfterMs: returns null when header is absent", () => {
    const err = fakeError(429);
    assert.equal(getRetryAfterMs(err), null);
});

test("getRetryAfterMs: returns null for an unparseable header", () => {
    const err = fakeError(429, { "retry-after": "not-a-number" });
    assert.equal(getRetryAfterMs(err), null);
});

test("withRetry: succeeds immediately with no retries needed", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
        calls++;
        return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
});

test("withRetry: retries a 429 and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
        async () => {
            calls++;
            if (calls < 3) throw fakeError(429);
            return "ok after retries";
        },
        { initialDelayMs: 1, maxDelayMs: 5 } // tiny delays so the test runs fast
    );
    assert.equal(result, "ok after retries");
    assert.equal(calls, 3);
});

test("withRetry: gives up after maxRetries and throws the last error", async () => {
    let calls = 0;
    await assert.rejects(
        () =>
            withRetry(
                async () => {
                    calls++;
                    throw fakeError(500);
                },
                { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5 }
            ),
        /fake 500 error/
    );
    // 1 initial attempt + 2 retries = 3 total calls
    assert.equal(calls, 3);
});

test("withRetry: does NOT retry a non-retryable status (e.g. 400)", async () => {
    let calls = 0;
    await assert.rejects(
        () =>
            withRetry(async () => {
                calls++;
                throw fakeError(400);
            }),
        /fake 400 error/
    );
    assert.equal(calls, 1, "a 400 should fail on the first attempt, never retried");
});

test("withRetry: respects Retry-After header over computed backoff", async () => {
    let calls = 0;
    const start = Date.now();
    await withRetry(
        async () => {
            calls++;
            if (calls === 1) throw fakeError(429, { "retry-after": "0" });
            return "ok";
        },
        { initialDelayMs: 5000, maxDelayMs: 5000 } // would be slow if retry-after wasn't honored
    );
    const elapsed = Date.now() - start;
    assert.equal(calls, 2);
    // retry-after: 0 means near-instant; if this took anywhere close to the
    // 5000ms computed backoff, the header wasn't actually being honored
    assert.ok(elapsed < 2000, `expected fast retry via retry-after, took ${elapsed}ms`);
});