// lib/garage61.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("garage61Get", () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GARAGE61_API_TOKEN;

  beforeEach(() => {
    process.env.GARAGE61_API_TOKEN = "test-token";
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GARAGE61_API_TOKEN = originalToken;
    vi.useRealTimers();
  });

  it("retries once after a 429 with Retry-After, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, { message: "Rate limit exceeded. Retry later.", code: "rate_limited", details: { retryAfterSeconds: 5 } }, { "retry-after": "5" }))
      .mockResolvedValueOnce(mockResponse(200, { items: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { garage61Get } = await import("./garage61");
    const promise = garage61Get("/laps");
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;

    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exceeding the retry budget on repeated 429s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(429, { message: "Rate limit exceeded. Retry later.", code: "rate_limited", details: { retryAfterSeconds: 1 } }, { "retry-after": "1" })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { garage61Get } = await import("./garage61");
    const promise = garage61Get("/laps").catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("429");
    // 1 initial attempt + up to 2 retries = 3 calls, not an unbounded loop.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("proactively pauses on a successful response when capacity is nearly exhausted", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { items: [] }, { "x-ratelimit-global-remaining": "1", "retry-after": "3" }))
      .mockResolvedValueOnce(mockResponse(200, { items: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { garage61Get } = await import("./garage61");
    let firstResolved = false;
    const first = garage61Get("/laps").then((value) => { firstResolved = true; return value; });

    // Right after the response lands, the pacing sleep should still be pending.
    await vi.advanceTimersByTimeAsync(10);
    expect(firstResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(4000);
    await first;
    expect(firstResolved).toBe(true);
  });

  it("does not pause on a successful response when capacity is healthy", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse(200, { items: [] }, { "x-ratelimit-global-remaining": "50" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { garage61Get } = await import("./garage61");
    const result = await garage61Get("/laps"); // should resolve without needing to advance fake timers at all
    expect(result).toEqual({ items: [] });
  });
});
