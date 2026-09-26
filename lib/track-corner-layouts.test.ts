import { describe, expect, it } from "vitest";
import { lookupCornerLayout, pickCanonicalLayout, trackLayoutKey, type LayoutCorner } from "./track-corner-layouts";

const layout = (peaks: number[]): LayoutCorner[] => peaks.map((peak) => ({ startDistance: peak - 1, endDistance: peak + 1, distance: peak }));

describe("trackLayoutKey", () => {
  it("ignora acento, caixa e pontuação", () => {
    expect(trackLayoutKey("Autódromo José Carlos Pace", "Grand Prix")).toBe(trackLayoutKey("autodromo jose carlos pace", "grand-prix"));
  });
});

describe("pickCanonicalLayout", () => {
  it("escolhe a contagem de curvas que mais aparece", () => {
    const lists = [layout([10, 20, 30, 40]), layout([10, 20, 30, 40]), layout([10, 20, 30, 40]), layout([10, 25, 40]), layout([10, 15, 20, 30, 40, 50])];
    const picked = pickCanonicalLayout(lists);
    expect(picked?.corners).toHaveLength(4);
    expect(picked?.votes).toEqual({ "4": 3, "3": 1, "6": 1 });
  });
  it("entre as voltas com a contagem vencedora, fica com a mais central", () => {
    const lists = [layout([9, 19, 29]), layout([10, 20, 30]), layout([11, 21, 31])];
    expect(pickCanonicalLayout(lists)?.corners.map((corner) => corner.distance)).toEqual([10, 20, 30]);
  });
  it("empate: prefere a contagem mais próxima da esperada e, sem ela, a maior", () => {
    const lists = [layout([10, 20, 30]), layout([10, 20, 30, 40]), layout([10, 20, 30, 40, 50])];
    expect(pickCanonicalLayout(lists, 5)?.corners).toHaveLength(5);
    expect(pickCanonicalLayout(lists)?.corners).toHaveLength(5);
    expect(pickCanonicalLayout([layout([10, 20, 30]), layout([10, 20, 30, 40])], 3)?.corners).toHaveLength(3);
  });
  it("ignora voltas com menos de 3 curvas e devolve null sem dados", () => {
    expect(pickCanonicalLayout([layout([10, 20])])).toBeNull();
    expect(pickCanonicalLayout([])).toBeNull();
  });
});

describe("lookupCornerLayout", () => {
  it("devolve null para pista desconhecida", () => {
    expect(lookupCornerLayout("Pista Que Nao Existe", "GP")).toBeNull();
  });
});

describe("traçados canônicos gerados das voltas reais", () => {
  it("Road Atlanta tem o traçado que mais se repetiu (13 curvas) e detectLapCorners devolve sempre esses números", async () => {
    const layout = lookupCornerLayout("Road Atlanta", "Full Course");
    expect(layout?.corners).toHaveLength(13);
    expect(layout?.votes["13"]).toBeGreaterThan(layout?.votes["14"] ?? 0);
    const { detectLapCorners } = await import("./lap-corners");
    const corners = detectLapCorners([], "Road Atlanta", "Full Course"); // sem GPS: só o traçado canônico
    expect(corners.map((corner) => corner.number)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
  });
  it("Interlagos: mantém as 11 curvas dos nomes verificados (Senna S e Curva do Sol nas curvas 1 a 3, subida na última)", async () => {
    const { detectLapCorners } = await import("./lap-corners");
    const corners = detectLapCorners([], "Autódromo José Carlos Pace", "Grand Prix");
    expect(corners).toHaveLength(11);
    expect(corners[0].name).toBe("Senna S");
    expect(corners[1].name).toBeNull();
    expect(corners[2].name).toBe("Curva do Sol");
    expect(corners[10].name).toBe("Subida dos Boxes");
    expect(corners[10].distance).toBeGreaterThan(80);
  });
  it("pistas com nomes verificados só ganham traçado fixo com a contagem exata dos nomes", async () => {
    const { verifiedCornerNameCount } = await import("./track-corners");
    for (const [name, variant] of [["Autódromo José Carlos Pace", "Grand Prix"], ["Circuit Zandvoort", "Grand Prix"], ["Silverstone Circuit", "Grand Prix"], ["Watkins Glen International", "Boot"]]) {
      expect(lookupCornerLayout(name, variant)?.corners).toHaveLength(verifiedCornerNameCount(name, variant) as number);
    }
    // Le Mans e Algarve não têm volta compatível: seguem com a detecção revisada
    expect(lookupCornerLayout("Circuit des 24 Heures du Mans", "24 Heures du Mans")).toBeNull();
    expect(lookupCornerLayout("Algarve International Circuit", "Grand Prix")).toBeNull();
  });
  it("pista sem traçado canônico segue com a detecção da volta", async () => {
    const { detectLapCorners } = await import("./lap-corners");
    expect(detectLapCorners([], "Pista Que Nao Existe", "GP")).toEqual([]);
  });
});
