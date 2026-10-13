import { describe, expect, it } from "vitest";
import {
  biggestExitLeak, buildTrainingPlan, carMatchesKind, earlyExitBySubsession, gapEvolution, gapPercent, idealLap, recommend,
  summarizeHistory, trackMatches, type CleanLap, type FieldRow, type RaceRow, type SeasonInfo,
} from "./telemetry-plan";

const field = (subsession: number, classId: number, laps: number, opts: Partial<FieldRow> = {}): FieldRow =>
  ({ subsession_id: subsession, car_class_id: classId, laps_complete: laps, finish_position_in_class: 1, is_me: false, ...opts });

describe("earlyExitBySubsession", () => {
  it("marca saída quando as voltas do piloto são menos de 90% das da classe, e permanência acima", () => {
    const exits = earlyExitBySubsession([
      field(1, 10, 20, { finish_position_in_class: 0 }), field(1, 10, 17, { is_me: true }),
      field(2, 10, 20, { finish_position_in_class: 0 }), field(2, 10, 18, { is_me: true }),
    ]);
    expect(exits.get(1)).toBe(true); // 17 < 18
    expect(exits.get(2)).toBe(false); // 18 = 90%, não é saída
  });

  it("usa só a mesma classe na mesma subsessão e ignora corridas sem dado", () => {
    const exits = earlyExitBySubsession([
      field(1, 10, 40, { finish_position_in_class: 0 }), // outra classe, mais voltas
      field(1, 20, 20, { finish_position_in_class: 0 }), field(1, 20, 19, { is_me: true, car_class_id: 20 }),
      field(2, 10, 20, { is_me: true, laps_complete: null }),
      field(3, 10, 0, { finish_position_in_class: 0 }), field(3, 10, 0, { is_me: true }),
    ]);
    expect(exits.get(1)).toBe(false);
    expect(exits.has(2)).toBe(false);
    expect(exits.has(3)).toBe(false); // classe sem voltas: indeterminado
  });
});

const seasons: SeasonInfo[] = [
  { id: "35", name: "2026 Season 4", start: "2026-09-15T00:00:00.000Z" },
  { id: "34", name: "2026 Season 3", start: "2026-06-16T00:00:00.000Z" },
  { id: "33", name: "2026 Season 2", start: "2026-03-17T00:00:00.000Z" },
];
let nextId = 1;
const race = (iso: string, car: string, delta: number, extra: Partial<RaceRow> = {}): RaceRow => ({
  irstats_race_id: nextId++, raced_at: iso, series_name: "x", track_name: "Pista", car_name: car, car_id: [...car].reduce((sum, char) => sum + char.charCodeAt(0), 0), track_id: 1,
  season_week: null, irating_delta: delta, fastest_lap_time: null, race_fastest_lap_time: null, class_fastest_lap_time: null, ...extra,
});

describe("biggestExitLeak", () => {
  it("soma o iR das saídas em S4 e em S3 só até a mesma semana, e escolhe o carro que mais perdeu", () => {
    nextId = 1;
    const rows = [
      race("2026-09-20T12:00:00Z", "Ferrari 499P", -100), // S4 w1, saída
      race("2026-10-02T12:00:00Z", "Ferrari 499P", -50), // S4 w3, saída
      race("2026-10-03T12:00:00Z", "Ferrari 499P", +40), // S4, permanência (não entra na soma)
      race("2026-06-23T12:00:00Z", "Ferrari 499P", -300), // S3 w2, saída, dentro da janela
      race("2026-08-20T12:00:00Z", "Ferrari 499P", -999), // S3 w10, depois da semana atual -> fora
      race("2026-09-21T12:00:00Z", "McLaren 720S", -80), // S4 saída, outro carro
      race("2026-03-20T12:00:00Z", "McLaren 720S", -999), // S2: fora
    ];
    const exits = new Map<number, boolean>([[1, true], [2, true], [3, false], [4, true], [5, true], [6, true], [7, true]]);
    const leak = biggestExitLeak(rows, exits, seasons, "35", 5)!;
    expect(leak.carName).toBe("Ferrari 499P");
    expect(leak.leakIrating).toBe(-450);
    expect(leak.exits).toBe(3);
    expect(leak.races).toBe(4);
    expect(leak.exitRate).toBeCloseTo(0.75);
  });

  it("não conta corrida sem campo conhecido e devolve null sem perda líquida", () => {
    nextId = 1;
    const rows = [race("2026-09-20T12:00:00Z", "A", -100), race("2026-09-21T12:00:00Z", "A", +30)];
    expect(biggestExitLeak(rows, new Map(), seasons, "35", 5)).toBeNull();
    expect(biggestExitLeak(rows, new Map([[1, false], [2, true]]), seasons, "35", 5)).toBeNull();
  });
});

const lap = (id: string, time: number, sectors: number[]): CleanLap => ({ id, lapTime: time, sectors });

describe("idealLap", () => {
  const laps = [
    lap("a", 60.0, [20.0, 20.0, 20.0]),
    lap("b", 60.2, [19.8, 20.2, 20.2]),
    lap("c", 60.4, [20.2, 19.7, 20.5]),
    lap("d", 60.6, [20.4, 20.4, 19.8]),
    lap("e", 60.8, [20.6, 20.1, 20.1]),
    lap("f", 99.9, [30, 30]), // número de setores diferente: descartada
  ];

  it("soma os melhores setores e compara com a melhor volta", () => {
    const ideal = idealLap(laps)!;
    expect(ideal.lapsUsed).toBe(5);
    expect(ideal.idealTime).toBeCloseTo(19.8 + 19.7 + 19.8);
    expect(ideal.ownSectorSum).toBeCloseTo(60);
    expect(ideal.gap).toBeCloseTo(0.7);
    expect(ideal.sectors.map((s) => +s.lost.toFixed(2))).toEqual([0.2, 0.3, 0.2]);
    expect(ideal.sectors[0].best).toBeCloseTo(19.8);
  });

  it("calcula o desvio padrão amostral por setor", () => {
    const ideal = idealLap(laps)!;
    // setor 1: 20.0, 19.8, 20.2, 20.4, 20.6 -> média 20.2, desvio amostral sqrt(0.4/4)
    expect(ideal.sectors[0].sigma).toBeCloseTo(Math.sqrt(0.1), 6);
  });

  it("usa só as 12 voltas mais rápidas e exige o mínimo de 5", () => {
    expect(idealLap(laps.slice(0, 4))).toBeNull();
    const many = Array.from({ length: 20 }, (_, index) => lap("l" + index, 60 + index, [20 + index, 20, 20 - index / 100]));
    expect(idealLap(many)!.lapsUsed).toBe(12);
  });

  it("descarta voltas com setor inválido", () => {
    const withBad = [...laps, lap("g", 59, [0, 20, 20])];
    expect(idealLap(withBad)!.bestLapTime).toBe(60.0);
  });
});

describe("buildTrainingPlan", () => {
  const ideal = idealLap([
    lap("a", 60.0, [20.0, 20.0, 20.0]), lap("b", 60.2, [19.5, 20.5, 20.2]), lap("c", 60.4, [20.5, 19.7, 20.2]),
    lap("d", 60.6, [20.1, 20.4, 20.1]), lap("e", 60.8, [20.6, 20.1, 20.1]),
  ])!;
  const leak = { carKey: "id:1", carName: "Ferrari 499P", carId: 1, leakIrating: -432, races: 14, exits: 7, exitRate: 0.5 };

  it("coloca o vazamento de iRating primeiro, depois os setores pela fração do tempo em jogo, no máximo 3", () => {
    const plan = buildTrainingPlan({ leak, shortCar: "Ferrari", weekTrack: "Red Bull Ring", contextLabel: "Motegi · Porsche", ideal, classLeaderLap: 108.448 });
    expect(plan.length).toBe(3);
    expect(plan[0].kind).toBe("start");
    expect(plan[0].chip).toBe("−432 iR no Ferrari");
    expect(plan[0].text).toContain("7 saídas antecipadas (50%)");
    expect(plan[0].text).toContain("Red Bull Ring");
    expect(plan[0].goal).toContain("25%");
    const rest = plan.slice(1);
    expect(rest.map((card) => card.kind).sort()).toEqual(["ideal", "repeatability"]);
    expect(rest[0].weight).toBeGreaterThanOrEqual(rest[1].weight);
  });

  it("sem vazamento mostra só os exercícios de setor e sem dados de volta devolve vazio", () => {
    const only = buildTrainingPlan({ leak: null, shortCar: "", weekTrack: null, contextLabel: null, ideal, classLeaderLap: null });
    expect(only.every((card) => card.kind !== "start")).toBe(true);
    expect(buildTrainingPlan({ leak: null, shortCar: "", weekTrack: null, contextLabel: null, ideal: null, classLeaderLap: null })).toEqual([]);
  });

  it("cita o líder da classe só quando existe", () => {
    const withLeader = buildTrainingPlan({ leak: null, shortCar: "", weekTrack: null, contextLabel: null, ideal, classLeaderLap: 108.448 });
    expect(withLeader.find((card) => card.kind === "ideal")!.text).toContain("1:48,448");
  });
});

describe("gap e recomendação", () => {
  it("calcula o gap percentual contra a classe", () => {
    const gap = gapPercent("1:48.880", "1:48.448")!;
    expect(gap.seconds).toBeCloseTo(0.432, 3);
    expect(gap.pct).toBeCloseTo(0.3986, 3);
    expect(gapPercent(null, "1:48.448")).toBeNull();
  });

  it("monta a evolução em ordem cronológica, só com corridas que têm os dois tempos", () => {
    nextId = 1;
    const rows = [
      race("2026-10-09T10:00:00Z", "A", 0, { fastest_lap_time: "1:49.000", class_fastest_lap_time: "1:48.000" }),
      race("2026-10-07T10:00:00Z", "A", 0, { fastest_lap_time: "1:49.500", race_fastest_lap_time: "1:48.000" }),
      race("2026-10-08T10:00:00Z", "A", 0, { fastest_lap_time: "1:49.000" }),
    ];
    const evolution = gapEvolution(rows);
    expect(evolution.map((point) => point.date.slice(8, 10))).toEqual(["07", "09"]);
    expect(evolution[0].pct).toBeGreaterThan(evolution[1].pct);
  });

  it("aplica as regras de recomendação", () => {
    const base = { races: 10, avgDelta: 15, recentAvgDelta: 0, measured: 8, exits: 1, exitRate: 0.125 };
    expect(recommend(base, 10, 2).label).toBe("Correr");
    expect(recommend({ ...base, avgDelta: -20, exitRate: 0.4, recentAvgDelta: 20 }, 10, 2).label).toBe("Preparar");
    expect(recommend({ ...base, avgDelta: -20, recentAvgDelta: -5 }, 10, 2).label).toBe("Cautela");
    expect(recommend({ ...base, avgDelta: 2, exitRate: 0.1 }, 10, 2).label).toBe("Neutro");
    expect(recommend({ ...base, races: 3 }, 10, 2).label).toBe("Sem base");
    expect(recommend({ ...base, races: 0, avgDelta: null }, 0, 0)).toMatchObject({ label: "Pista nova", hints: ["sem treino", "sem setup"] });
  });

  it("resume histórico com saídas só nas corridas medidas", () => {
    nextId = 1;
    const rows = [race("2026-01-01T00:00:00Z", "A", 10), race("2026-01-02T00:00:00Z", "A", -30), race("2026-01-03T00:00:00Z", "A", 20)];
    const summary = summarizeHistory(rows, new Map([[1, true], [2, false]]));
    expect(summary).toMatchObject({ races: 3, avgDelta: 0, measured: 2, exits: 1, exitRate: 0.5 });
  });
});

describe("casamento calendário", () => {
  it("casa pista por termo sem acento e carro por tipo de contexto", () => {
    expect(trackMatches("Autódromo José Carlos Pace", ["Interlagos", "Autodromo Jose Carlos Pace"])).toBe(true);
    expect(trackMatches("Road Atlanta", ["Red Bull Ring"])).toBe(false);
    expect(carMatchesKind("imsa", "Ferrari 499P", "GTP")).toBe(true);
    expect(carMatchesKind("imsa", "Porsche 911 GT3 R", "GT3")).toBe(false);
    expect(carMatchesKind("gt3", "Porsche 911 GT3 R", "GT3")).toBe(true);
    expect(carMatchesKind("sf23", "Super Formula SF23 - Honda", null)).toBe(true);
    expect(carMatchesKind("sf23", "Super Formula Lights", null)).toBe(false);
  });
});
