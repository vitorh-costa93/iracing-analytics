import { describe, expect, it } from "vitest";
import { initials, relativeAge } from "./freshness";

const now = Date.parse("2026-09-25T12:00:00Z");

describe("header freshness", () => {
  it("formats relative ages in pt-BR short form", () => {
    expect(relativeAge(null, now)).toBe("sem registro");
    expect(relativeAge("2026-09-25T11:59:40Z", now)).toBe("agora");
    expect(relativeAge("2026-09-25T11:45:00Z", now)).toBe("há 15 min");
    expect(relativeAge("2026-09-25T10:00:00Z", now)).toBe("há 2 h");
    expect(relativeAge("2026-09-22T12:00:00Z", now)).toBe("há 3 d");
  });

  it("builds avatar initials", () => {
    expect(initials("Vitor Costa")).toBe("VC");
    expect(initials("Vitor Henrique Costa")).toBe("VC");
    expect(initials("Vitor")).toBe("V");
  });
});
