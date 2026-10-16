import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  reads: [] as string[], writes: [] as Record<string, unknown>[],
  pending: [] as Promise<unknown>[], claim: true, failRead: false, failWrite: false, rejectStore: false,
  rpc: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: {
  from: () => ({
    select: () => ({ eq: (_column: string, key: string) => ({ maybeSingle: async () => {
      state.reads.push(key);
      return { data: state.rows.get(key) ?? null, error: state.failRead ? new Error("missing table") : null };
    } }) }),
  }),
  rpc: (name: string, args: Record<string, unknown>) => {
    state.rpc(name, args);
    if (name === "store_analytics_cache") {
      if (state.rejectStore) return Promise.resolve({ data: false, error: null });
      const row = { key: args.p_key, route: args.p_route, tags: args.p_tags, payload: args.p_payload,
        version: args.p_version, generated_at: args.p_started_at,
        refresh_after: new Date(Date.parse(args.p_started_at as string) + Number(args.p_ttl_seconds) * 1000).toISOString() };
      state.writes.push(row);
      if (!state.failWrite) state.rows.set(row.key as string, row);
      return Promise.resolve({ data: !state.failWrite, error: state.failWrite ? new Error("write failed") : null });
    }
    return Promise.resolve({ data: state.claim, error: null });
  },
} }));
vi.mock("@vercel/functions", () => ({ waitUntil: (promise: Promise<unknown>) => { state.pending.push(promise); } }));

import { withDurableCache } from "./durable-cache";
const options = { version: "v1", tags: ["results"], ttlSeconds: 60 };
const request = (suffix = "", headers?: HeadersInit) => new Request(`https://example.test/api/report${suffix}`, { headers });
const good = (value = 1) => Response.json({ status: "ok", value });

beforeEach(() => {
  state.rows.clear(); state.reads = []; state.writes = []; state.pending = [];
  state.claim = true; state.failRead = false; state.failWrite = false; state.rejectStore = false; state.rpc.mockClear();
  vi.unstubAllEnvs();
});

describe("durable response cache", () => {
  it("does not collide repeated query parameters whose first values differ", async () => {
    const handler = vi.fn(async (req: Request) => good(Number(new URL(req.url).searchParams.get("n"))));
    const wrapped = withDurableCache(handler, options);
    expect(await (await wrapped(request("?n=1&n=2"))).json()).toEqual({ status: "ok", value: 1 });
    expect(await (await wrapped(request("?n=2&n=1"))).json()).toEqual({ status: "ok", value: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("never serves a changed source older than 15 minutes when refresh budget is denied", async () => {
    const wrapped = withDurableCache(async () => good(), options);
    await wrapped(request());
    const row = state.writes[0];
    row.generated_at = new Date(Date.now() - 30 * 60_000).toISOString();
    row.invalidated_at = new Date(Date.now() - 16 * 60_000).toISOString();
    state.claim = false;
    expect((await wrapped(request())).status).toBe(503);
  });
  it("keeps private persistent responses out of CDN on MISS and HIT", async () => {
    const handler = vi.fn(async () => Response.json({ status: "ok" }, { headers: {
      "Cache-Control": "public, s-maxage=600", "Vercel-Cache-Tag": "results",
      "Vercel-CDN-Cache-Control": "public, s-maxage=600", "CDN-Cache-Control": "public, s-maxage=600",
    } }));
    const wrapped = withDurableCache(handler, { ...options, visibility: "private" });
    for (const status of ["MISS", "HIT"]) {
      const response = await wrapped(request());
      expect(response.headers.get("x-analytics-cache")).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect(response.headers.has("vercel-cache-tag")).toBe(false);
      expect(response.headers.has("vercel-cdn-cache-control")).toBe(false);
      expect(response.headers.has("cdn-cache-control")).toBe(false);
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent cold requests and returns independently readable bodies", async () => {
    let finish!: (response: Response) => void;
    const handler = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const wrapped = withDurableCache(handler, options);
    const first = wrapped(request());
    const second = wrapped(request());
    await vi.waitFor(() => { expect(state.reads).toHaveLength(2); expect(handler).toHaveBeenCalledTimes(1); });
    finish(good());
    const responses = await Promise.all([first, second]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([{ status: "ok", value: 1 }, { status: "ok", value: 1 }]);
    expect(state.writes).toHaveLength(1);
  });

  it("does not republish rejected or concurrently invalidated calculations at the CDN", async () => {
    state.rejectStore = true;
    const response = await withDurableCache(async () => Response.json({ status: "ok" }, { headers: { "cache-control": "public, s-maxage=60" } }), options)(request());
    expect(response.headers.get("x-analytics-cache")).toBe("SKIP");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.rows.size).toBe(0);
  });
  it("persists cold responses and reuses the normalized route across instances and ordinary cookies", async () => {
    const handler = vi.fn(async () => good());
    const first = await withDurableCache(handler, options)(request("?b=2&a=1"));
    expect(first.headers.get("x-analytics-cache")).toBe("MISS");
    const second = await withDurableCache(handler, options)(request("?a=1&b=2", { cookie: "theme=dark" }));
    expect(second.headers.get("x-analytics-cache")).toBe("HIT");
    expect(await second.json()).toEqual({ status: "ok", value: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.writes[0].route).toBe("/api/report?a=1&b=2");
    expect(state.writes[0].key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("isolates versions and query values", async () => {
    const handler = vi.fn(async () => good());
    await withDurableCache(handler, options)(request("?a=1"));
    await withDurableCache(handler, { ...options, version: "v2" })(request("?a=1"));
    await withDurableCache(handler, options)(request("?a=2"));
    expect(new Set(state.reads).size).toBe(3);
  });

  it("limits CDN TTL to the official payload boundary and regenerates after it", async () => {
    let boundary = Date.now() + 15_000;
    const handler = vi.fn(async () => good());
    const wrapped = withDurableCache(handler, { ...options, validUntil: () => boundary });
    const cold = await wrapped(request());
    expect(cold.headers.get("cache-control")).toMatch(/s-maxage=1[45]$/);
    const hit = await wrapped(request());
    expect(hit.headers.get("cache-control")).toMatch(/s-maxage=1[45]$/);
    boundary = Date.now() - 1;
    const expired = await wrapped(request());
    expect(expired.headers.get("x-analytics-cache")).toBe("MISS");
    expect(expired.headers.get("cache-control")).toBe("no-store");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("returns stale without waiting for calculation and retains good data if refresh fails", async () => {
    const handler = vi.fn(async () => good(1));
    const wrapped = withDurableCache(handler, options);
    await wrapped(request());
    state.writes[0].refresh_after = new Date(Date.now() - 1).toISOString();
    let finish!: (response: Response) => void;
    handler.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const response = await wrapped(request());
    expect(await response.json()).toEqual({ status: "ok", value: 1 });
    expect(state.writes).toHaveLength(1);
    finish(Response.json({ status: "error" }, { status: 500 }));
    await Promise.all(state.pending);
    expect(state.writes).toHaveLength(1);
  });

  it.each([true, false])("serves stale immediately and refreshes only with the database lease (%s)", async (claim) => {
    const handler = vi.fn(async () => good(2));
    const wrapped = withDurableCache(handler, options);
    await wrapped(request());
    const row = state.writes[0];
    row.refresh_after = new Date(Date.now() - 1000).toISOString();
    state.claim = claim;
    handler.mockClear();
    const response = await wrapped(request());
    expect(response.headers.get("x-analytics-cache")).toBe("STALE");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.pending).toHaveLength(1);
    await Promise.all(state.pending);
    expect(handler).toHaveBeenCalledTimes(claim ? 1 : 0);
    expect(state.rpc).toHaveBeenCalledWith("claim_analytics_cache_refresh", { p_key: row.key, p_lease_seconds: 300 });
  });

  it("awaits regeneration beyond the hard horizon even if refresh_after is in the future", async () => {
    const wrapped = withDurableCache(async () => good(2), { ...options, maxStaleSeconds: 120 });
    await wrapped(request());
    const row = state.writes[0];
    row.generated_at = new Date(Date.now() - 121_000).toISOString();
    row.refresh_after = new Date(Date.now() + 60_000).toISOString();
    expect((await wrapped(request())).headers.get("x-analytics-cache")).toBe("MISS");
    expect(state.writes).toHaveLength(2);
    expect(state.pending).toHaveLength(0);
  });

  it("only honors a warm secret and never includes it in the stored route", async () => {
    vi.stubEnv("IMPORT_KEY", "secret-test");
    const handler = vi.fn(async () => good());
    const wrapped = withDurableCache(handler, options);
    await wrapped(request());
    expect((await wrapped(request("", { "x-analytics-warm": "arbitrary" }))).headers.get("x-analytics-cache")).toBe("HIT");
    const warm = await wrapped(request("", { "x-analytics-warm": "secret-test" }));
    expect(warm.headers.get("x-analytics-cache")).toBe("REFRESH");
    expect(warm.headers.get("cache-control")).toBe("no-store");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(state.writes)).not.toContain("secret-test");
  });

  it("respects warm refresh leases and never serves beyond the hard horizon when denied", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test");
    const handler = vi.fn(async () => good());
    const wrapped = withDurableCache(handler, options);
    await wrapped(request());
    state.claim = false;
    expect((await wrapped(request("", { "x-analytics-warm": "cron-test" }))).headers.get("x-analytics-cache")).toBe("HIT");
    state.writes[0].generated_at = new Date(Date.now() - 8 * 86400_000).toISOString();
    expect((await wrapped(request("", { "x-analytics-warm": "cron-test" }))).status).toBe(503);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.pending).toHaveLength(0);
  });

  it("bypasses refresh, authorization and non-GET requests without database access", async () => {
    const wrapped = withDurableCache(async () => good(), options);
    for (const req of [request("?refresh=0"), request("", { authorization: "Bearer token" }), new Request("https://example.test/api/report", { method: "POST" })]) {
      expect((await wrapped(req)).headers.get("x-analytics-cache")).toBe("BYPASS");
    }
    expect(state.reads).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
  });

  it.each([
    () => Response.json({ status: "error" }, { status: 500 }),
    () => Response.json({ status: "missing" }),
    () => Response.json({ status: "unavailable" }),
    () => Response.json({ status: "ok" }, { headers: { "set-cookie": "session=private" } }),
    () => new Response("not json"),
    () => Response.json({ status: "ok", value: "a".repeat(200) }),
  ])("does not persist unsafe or oversized responses", async (factory) => {
    const response = await withDurableCache(async () => factory(), { ...options, maxBytes: 100 })(request());
    expect(response.headers.get("x-analytics-cache")).toBe("SKIP");
    expect(state.writes).toHaveLength(0);
  });

  it.each(["read", "write"])("returns handler output when the database %s fails", async (failure) => {
    state.failRead = failure === "read"; state.failWrite = failure === "write";
    const response = await withDurableCache(async () => good(), options)(request());
    expect(response.headers.get("x-analytics-cache")).toBe("UNAVAILABLE");
    expect(await response.json()).toEqual({ status: "ok", value: 1 });
  });
});
