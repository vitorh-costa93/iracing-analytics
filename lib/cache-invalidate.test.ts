import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@vercel/functions", () => ({ invalidateByTag: vi.fn(async () => {}), waitUntil: vi.fn() }));

describe("content-aware invalidate", () => {
  beforeEach(() => { rpc.mockReset(); revalidateTag.mockReset(); });

  it("does nothing when no source data changed", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { invalidate, CACHE_TAGS } = await import("./cache");
    await invalidate(CACHE_TAGS.results, CACHE_TAGS.laps);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("invalidate_analytics_cache_if_changed", { p_tags: ["results", "laps"] });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates only the tags reported as changed", async () => {
    rpc.mockResolvedValue({ data: ["laps"], error: null });
    const { invalidate, CACHE_TAGS } = await import("./cache");
    await invalidate(CACHE_TAGS.results, CACHE_TAGS.laps);
    expect(revalidateTag.mock.calls.map((call) => call[0])).toEqual(["laps"]);
  });

  it("falls back to unconditional invalidation if the RPC is unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42883" } }).mockResolvedValueOnce({ data: null, error: null });
    const { invalidate, CACHE_TAGS } = await import("./cache");
    await invalidate(CACHE_TAGS.results);
    expect(rpc).toHaveBeenLastCalledWith("invalidate_analytics_cache", { p_tags: ["results"] });
    expect(revalidateTag).toHaveBeenCalledWith("results");
  });
});
