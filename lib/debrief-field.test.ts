import { describe, expect, it } from "vitest";
import { byCar, cascadeKey, classifyExit, raceFieldMetrics, scatterPoints, summarizeField, tallyCauses, type ExitLap, type FieldResultRow, type RaceForField } from "./debrief-field";

let custSeed = 1;
function row(sub: number, over: Partial<FieldResultRow> = {}): FieldResultRow {
  return { subsession_id: sub, cust_id: custSeed++, car_class_id: 7, laps_complete: 20, best_lap_time: 900000, oldi_rating: 3000, newi_rating: 3000, finish_position_in_class: 1, is_me: false, ...over };
}
/** Campo de 6 pilotos: o piloto (is_me) com a 4ª melhor volta e as voltas completas informadas. */
function field(sub: number, myLaps: number, myIr = 3000, newIr = 3000, myFinish = 4): FieldResultRow[] {
  const rows = [1, 2, 3, 5, 6].map((position, index) => row(sub, { finish_position_in_class: position, best_lap_time: 890000 + index * 5000 + (position > 4 ? 20000 : 0), oldi_rating: 3200 - index * 100, newi_rating: 3200 - index * 100 }));
  rows.push(row(sub, { is_me: true, laps_complete: myLaps, best_lap_time: 902000, oldi_rating: myIr, newi_rating: newIr, finish_position_in_class: myFinish }));
  return rows;
}

describe("raceFieldMetrics", () => {
  it("calcula permanência, ritmo no grid e Δ real", () => {
    const metrics = raceFieldMetrics(field(1, 20, 3000, 3040));
    const metric = metrics.get(1)!;
    expect(metric.classMaxLaps).toBe(20);
    expect(metric.lapsRatio).toBe(1);
    expect(metric.realDelta).toBe(40);
    expect(metric.pace).toBeGreaterThan(0);
    expect(metric.pace).toBeLessThan(1);
    expect(metric.residual).not.toBeNull();
  });

  it("só compara com a própria classe e ignora campo sem o piloto", () => {
    const rows = [...field(2, 20), row(2, { car_class_id: 99, laps_complete: 40 }), ...[row(3), row(3)]];
    const metrics = raceFieldMetrics(rows);
    expect(metrics.get(2)!.classMaxLaps).toBe(20);
    expect(metrics.has(3)).toBe(false);
  });

  it("sem iRating do piloto não inventa resultado esperado", () => {
    const metric = raceFieldMetrics(field(4, 20, 0, 0)).get(4)!;
    expect(metric.expectedDelta).toBeNull();
    expect(metric.residual).toBeNull();
  });
});

describe("cascata", () => {
  const metric = (lapsComplete: number, classMaxLaps = 20) => ({ subsessionId: 1, lapsComplete, classMaxLaps, lapsRatio: lapsComplete / classMaxLaps, pace: 0.5, expectedDelta: 0, realDelta: 0, residual: 0 });
  it("separa concluídas, volta 1 e faixas de progresso", () => {
    expect(cascadeKey(metric(18))).toBe("completed");
    expect(cascadeKey(metric(1))).toBe("lapOne");
    expect(cascadeKey(metric(0))).toBe("lapOne");
    expect(cascadeKey(metric(4))).toBe("under25");
    expect(cascadeKey(metric(8))).toBe("to50");
    expect(cascadeKey(metric(12))).toBe("to75");
    expect(cascadeKey(metric(16))).toBe("to90");
    expect(cascadeKey(undefined)).toBeNull();
  });
});

describe("summarizeField", () => {
  const races: RaceForField[] = [
    { subsessionId: 1, date: "2026-09-18T20:00:00Z", car: "A", track: "T", delta: 40, classFinish: 1 },
    { subsessionId: 2, date: "2026-09-19T20:00:00Z", car: "A", track: "T", delta: -80, classFinish: 9, cause: "abrupt" },
    { subsessionId: 3, date: "2026-09-20T20:00:00Z", car: "B", track: "T", delta: -90, classFinish: 20 },
    { subsessionId: null, date: "2026-09-21T20:00:00Z", car: "B", track: "T", delta: 10, classFinish: 3 },
  ];
  const metrics = new Map([...raceFieldMetrics(field(1, 20, 3000, 3040)), ...raceFieldMetrics(field(2, 10, 3000, 2920)), ...raceFieldMetrics(field(3, 0, 3000, 2910))]);

  it("soma por desfecho e fecha com o saldo", () => {
    const side = summarizeField(races, metrics);
    expect(side.races).toBe(4);
    expect(side.net).toBe(-120);
    expect(side.kept).toBe(1);
    expect(side.early).toBe(2);
    expect(side.permanencePct).toBe(33);
    expect(side.cascade.completed).toEqual({ count: 1, delta: 40 });
    expect(side.cascade.lapOne).toEqual({ count: 1, delta: -90 });
    expect(side.cascade.to75).toEqual({ count: 1, delta: -80 });
    expect(side.podiums).toBe(2);
    expect(side.wins).toBe(1);
  });

  it("classifica as causas só nas saídas e coloca 'sem dados' à parte", () => {
    const tally = tallyCauses(races, metrics);
    expect(tally.abrupt).toEqual({ count: 1, delta: -80 });
    expect(tally.lapOne).toEqual({ count: 1, delta: -90 });
    expect(tally.unknown.count).toBe(0);
  });

  it("agrupa por carro e monta os pontos da dispersão", () => {
    const rows = byCar(races, metrics);
    expect(rows.map((item) => item.car)).toEqual(["A", "B"]);
    expect(rows[0].races).toBe(2);
    const points = scatterPoints(races, metrics);
    expect(points).toHaveLength(3);
    expect(points.find((point) => point.delta === -80)?.exitLap).toBe(10);
    expect(points.find((point) => point.delta === 40)?.exitLap).toBeNull();
  });
});

describe("classifyExit", () => {
  const lap = (number: number, time: number, over: Partial<ExitLap> = {}): ExitLap => ({ lap_number: number, lap_time: time, off_track: false, pit_in: false, pit_out: false, ...over });
  const steady = [1, 2, 3, 4, 5, 6].map((number) => lap(number, 90));
  it("volta 1 por contagem de voltas", () => expect(classifyExit(1, [])).toBe("lapOne"));
  it("sem voltas não classifica", () => expect(classifyExit(10, [])).toBeNull());
  it("parada brusca com ritmo normal", () => expect(classifyExit(6, steady)).toBe("abrupt"));
  it("ritmo que cai antes de sair indica dano", () => expect(classifyExit(6, [...steady.slice(0, 3), lap(4, 120), lap(5, 118), lap(6, 90)])).toBe("damage"));
  it("última volta fora da pista", () => expect(classifyExit(6, [...steady.slice(0, 5), lap(6, 95, { off_track: true })])).toBe("offTrack"));
  it("volta de box não conta como ritmo lento", () => expect(classifyExit(6, [...steady.slice(0, 3), lap(4, 140, { pit_in: true }), lap(5, 90), lap(6, 90)])).toBe("abrupt"));
});
