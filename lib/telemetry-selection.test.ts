import { describe, expect, it } from "vitest";
import { lapWhenLabel, selectionExplanation, sessionTypeLabel } from "./telemetry-selection";

describe("selectionExplanation (restaurado de 94c4d8d)", () => {
  it("diz que é a melhor volta de corrida sem P2P e lista a atividade da semana", () => {
    const text = selectionExplanation({ sessionTypes: [3, 1], bestLap: { selectionReason: "race_best_lap_without_p2p" } });
    expect(text).toBe("Esta é a sua melhor volta de corrida sem P2P/Overtake. Nesta semana você andou em: corrida e practice.");
  });

  it("não fala de P2P quando a volta é de corrida num carro sem P2P", () => {
    const text = selectionExplanation({ sessionTypes: [3], bestLap: { selectionReason: "race_best_lap" } });
    expect(text).toBe("Esta é a sua melhor volta de corrida. Nesta semana você andou em: corrida.");
    expect(text).not.toMatch(/P2P/);
  });

  it("avisa quando caiu para practice", () => {
    const text = selectionExplanation({ sessionTypes: [1, 2], bestLap: { selectionReason: "practice_best_lap" } });
    expect(text).toMatch(/^Ainda não há volta de corrida que sirva, então usei a sua melhor volta de practice/);
    expect(text).toMatch(/practice e classificação\.$/);
  });

  it("cai na melhor volta limpa e trata contexto sem volta", () => {
    expect(selectionExplanation({ sessionTypes: [], bestLap: { selectionReason: "fastest_clean_lap" } })).toBe("Esta é a sua melhor volta limpa disponível. Nesta semana você andou em: sessão registrada.");
    expect(selectionExplanation({ sessionTypes: [3], bestLap: null })).toMatch(/Ainda não há uma volta limpa/);
  });

  it("rótulos de sessão", () => {
    expect([3, 2, 1, null].map(sessionTypeLabel)).toEqual(["corrida", "classificação", "practice", "sessão registrada"]);
  });
});

describe("lapWhenLabel", () => {
  it("data e hora de Brasília", () => {
    expect(lapWhenLabel("2026-09-25T00:14:00Z")).toBe("volta de 24/09/2026 às 21:14");
    expect(lapWhenLabel(null)).toBeNull();
    expect(lapWhenLabel("xx")).toBeNull();
  });
});
