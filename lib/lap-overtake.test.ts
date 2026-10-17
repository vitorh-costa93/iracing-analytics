import { describe, expect, it } from "vitest";
import { lapUsedOvertake } from "./lap-overtake";

describe("lapUsedOvertake", () => {
  it("detects the Garage61 p2p flag", () => expect(lapUsedOvertake({ p2p: true })).toBe(true));
  it("detects pushToPass / p2pStatus", () => {
    expect(lapUsedOvertake({ pushToPass: true })).toBe(true);
    expect(lapUsedOvertake({ p2pStatus: 1 })).toBe(true);
  });
  it("ignores the session-cumulative p2pCount and clean laps", () => {
    expect(lapUsedOvertake({ p2p: false, pushToPass: false })).toBe(false);
    expect(lapUsedOvertake({ ...({ p2pCount: 5 } as object) })).toBe(false);
    expect(lapUsedOvertake({})).toBe(false);
  });
});
