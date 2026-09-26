import { describe, expect, it } from "vitest";
import { consistencyLabel, consistencyTone, type SectorConsistency } from "./sector-consistency";

describe("consistência por setor, critério relativo de 94c4d8d (0,3% / 0,8% / 1,6%)", () => {
  it("usa desvio ÷ média, não segundos absolutos", () => {
    // setor de 30 s: até 0,09 s é muito consistente; setor de 60 s: até 0,18 s
    expect(consistencyLabel(0.089, 30)).toBe("muito consistente");
    expect(consistencyLabel(0.17, 60)).toBe("muito consistente");
    // o mesmo desvio de 0,17 s num setor de 30 s já é só "consistente"
    expect(consistencyLabel(0.17, 30)).toBe("consistente");
  });

  it("faixas nos limites", () => {
    expect(consistencyLabel(0.29, 100)).toBe("muito consistente");
    expect(consistencyLabel(0.3, 100)).toBe("consistente");
    expect(consistencyLabel(0.79, 100)).toBe("consistente");
    expect(consistencyLabel(0.8, 100)).toBe("variável");
    expect(consistencyLabel(1.59, 100)).toBe("variável");
    expect(consistencyLabel(1.6, 100)).toBe("muito inconsistente");
    expect(consistencyLabel(0.5, 0)).toBe("muito consistente");
  });

  it("tons da barra", () => {
    const labels: SectorConsistency[] = ["muito consistente", "consistente", "variável", "muito inconsistente"];
    expect(labels.map(consistencyTone)).toEqual(["ok", "ok", "warn", "bad"]);
  });
});
