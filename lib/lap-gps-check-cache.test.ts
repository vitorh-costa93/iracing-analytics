import { describe, expect, it, vi } from "vitest";
import { checkLapsGps, type LapGpsCheck } from "./lap-gps-check-cache";

const check = (coveragePct: number, gpsDistanceMeters = 4000): LapGpsCheck => ({ coveragePct, gpsDistanceMeters });

describe("checkLapsGps", () => {
  it("only computes (downloads) laps missing from the cache, and saves them", async () => {
    const compute = vi.fn(async (id: string) => (id === "b" ? check(92) : check(40)));
    const save = vi.fn(async () => {});
    const result = await checkLapsGps(["a", "b", "c", "a"], {
      load: async () => new Map([["a", check(99)]]),
      compute,
      save,
    });
    expect(compute.mock.calls.map(([id]) => id).sort()).toEqual(["b", "c"]);
    expect(result.get("a")).toEqual(check(99));
    expect(result.get("b")).toEqual(check(92));
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([{ lapId: "b", ...check(92) }, { lapId: "c", ...check(40) }]));
  });

  it("a fully cached request downloads nothing", async () => {
    const compute = vi.fn();
    const save = vi.fn();
    await checkLapsGps(["a", "b"], { load: async () => new Map([["a", check(99)], ["b", check(95)]]), compute, save });
    expect(compute).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not cache a failed fetch (null), so it can be retried later", async () => {
    const save = vi.fn(async () => {});
    const result = await checkLapsGps(["x"], { load: async () => new Map(), compute: async () => null, save });
    expect(result.get("x")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("a failing save does not break the request", async () => {
    const result = await checkLapsGps(["x"], {
      load: async () => new Map(),
      compute: async () => check(90),
      save: async () => { throw new Error("db down"); },
    });
    expect(result.get("x")).toEqual(check(90));
  });
});
