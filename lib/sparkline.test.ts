import { describe, expect, it } from "vitest";
import { linePoints, sparkBars, sparkRange, stepPath } from "./sparkline";

describe("sparkline geometry (mockup B.dc.html)", () => {
  it("maps min/max to the 3px padded band of a 34px box", () => {
    expect(linePoints([10, 20], 10, 20)).toBe("0.0,31.0 200.0,3.0");
  });

  it("skips null weeks but keeps the fixed x axis", () => {
    expect(linePoints([10, null, 20], 10, 20)).toBe("0.0,31.0 200.0,3.0");
    expect(linePoints([10], 10, 20, 12)).toBe("0.0,31.0");
  });

  it("computes a shared range ignoring nulls", () => {
    expect(sparkRange([[5, null, 9], [2]])).toEqual([2, 9]);
    expect(sparkRange([[null]])).toEqual([0, 1]);
  });

  it("draws cumulative steps", () => {
    expect(stepPath([0, 1])).toBe("M0.0,31.0L200.0,31.0L200.0,3.0");
  });

  it("clamps bar heights to 2..15px around the y=17 axis", () => {
    const [up, down, tiny] = sparkBars([90, -30, 1]);
    expect(up).toEqual({ x: 2, y: 2, h: 15, positive: true });
    expect(down).toEqual({ x: 18.6, y: 17, h: 10, positive: false });
    expect(tiny.h).toBe(2);
  });
});
