import { describe, expect, it } from "vitest";
import {
  buildRaceFieldView, iratingContext, paceVsGrid, qualiVsRace, raceCharacter, raceClassRows, recurringRivals, trackHistory, weatherSummary,
  type FieldEvent, type FieldRow, type RivalRow,
} from "./race-field";

const T = 10000;
function row(cust: number, over: Partial<FieldRow> = {}): FieldRow {
  return {
    sim_session_type: "race", cust_id: cust, display_name: `P${cust}`, country_code: "BR", car_class_id: 1, car_class_name: "GT3",
    starting_position_in_class: cust - 1, finish_position_in_class: cust - 1, laps_complete: 20, laps_lead: 0, incidents: 2,
    best_lap_time: (90 + cust) * T, average_lap: (92 + cust) * T, qual_lap_time: (89 + cust) * T, oldi_rating: 3000, newi_rating: 3000,
    reason_out: "Running", is_me: false, ...over,
  };
}
const field = (n = 10, me = 3) => Array.from({ length: n }, (_, i) => row(i + 1, { is_me: i + 1 === me }));
const event: FieldEvent = { subsession_id: 9, sof: 2800, num_drivers: 10, num_cautions: 0, num_caution_laps: 0, num_lead_changes: 1, weather: { skies: 1, temp_value: 24, temp_units: 1, rel_humidity: 40, precip_time_pct: 0 }, session_splits: [{ subsession_id: 8 }, { subsession_id: 9 }] };

describe("paceVsGrid", () => {
  it("ranqueia melhor volta e média e lista o top-5 com a diferença", () => {
    const pace = paceVsGrid(raceClassRows(field()).classRows)!;
    expect(pace.best).toMatchObject({ rank: 3, of: 10, gap: 2, percentile: 78 });
    expect(pace.average).toMatchObject({ rank: 3, gap: 2 });
    expect(pace.spread).toEqual({ mine: 2, median: 2 });
    expect(pace.top5.map((t) => t.name)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(pace.top5.map((t) => t.diff)).toEqual([2, 1, 0, -1, -2]);
    expect(pace.top5[2].me).toBe(true);
  });
  it("ignora volta média de quem fez menos da metade das voltas", () => {
    const rows = field(); rows[9] = row(10, { laps_complete: 3, average_lap: 70 * T });
    const pace = paceVsGrid(rows)!;
    expect(pace.average!.of).toBe(9);
  });
  it("sem a melhor volta do piloto devolve null", () => {
    const rows = field(); rows[2].best_lap_time = null;
    expect(paceVsGrid(rows)).toBeNull();
  });
});

describe("qualiVsRace", () => {
  it("calcula posições ganhas, gaps e retenção de ritmo", () => {
    const rows = field();
    rows[2] = row(3, { is_me: true, starting_position_in_class: 5, finish_position_in_class: 1, qual_lap_time: 95 * T });
    const q = qualiVsRace(rows)!;
    expect(q.mine!.gained).toBeGreaterThan(0);
    expect(q.mine!.qualGap).toBe(5);
    expect(q.mine!.raceGap).toBe(2);
    expect(q.mine!.retention).toBe(-3);
    expect(q.field.gainers + q.field.losers + q.field.same).toBe(10);
  });
  it("usa o tempo da sessão de classificação quando a linha da corrida não tem qual_lap_time", () => {
    const rows = field().map((r) => ({ ...r, qual_lap_time: null }));
    const qual = field().map((r) => ({ ...r, sim_session_type: "qualify" as const, best_lap_time: (80 + r.cust_id) * T }));
    expect(qualiVsRace(rows, qual)!.mine!.qualGap).toBe(2);
  });
  it("sem campo classificado devolve null", () => {
    expect(qualiVsRace([row(1, { starting_position_in_class: null })])).toBeNull();
  });
});

describe("iratingContext", () => {
  it("compara posição esperada (ordem de iRating) com a real e usa o Elo existente", () => {
    const rows = field(6, 2).map((r, i) => ({ ...r, oldi_rating: 5000 - i * 400, newi_rating: 5000 - i * 400 }));
    rows[1].newi_rating = rows[1].oldi_rating! + 74;
    const ctx = iratingContext(rows, 2800)!;
    expect(ctx.expectedPosition).toBe(2);
    expect(ctx.actualPosition).toBe(2);
    expect(ctx.realDelta).toBe(74);
    expect(ctx.modelAtActual).toBe(ctx.expectedDelta);
    expect(ctx.scenarios.find((s) => s.tag === "actual")!.position).toBe(2);
    expect(ctx.scenarios[0].delta).toBeGreaterThan(ctx.scenarios[ctx.scenarios.length - 1].delta);
    expect(ctx.rows.some((r) => r.me)).toBe(true);
  });
  it("mostra ganho acima do esperado quando termina à frente do iRating", () => {
    const rows = field(6, 6).map((r, i) => ({ ...r, oldi_rating: 5000 - i * 300, newi_rating: 5000 - i * 300 }));
    rows[5].finish_position_in_class = 0; rows[0].finish_position_in_class = 5;
    const ctx = iratingContext(rows, null)!;
    expect(ctx.expectedPosition).toBe(6);
    expect(ctx.actualPosition).toBe(1);
    expect(ctx.modelAtActual!).toBeGreaterThan(ctx.expectedDelta!);
  });
  it("sem iRating do piloto devolve null", () => {
    const rows = field(); rows[2].oldi_rating = 0;
    expect(iratingContext(rows, null)).toBeNull();
  });
});

describe("raceCharacter", () => {
  it("classifica corrida limpa e resume o clima", () => {
    const c = raceCharacter(event, field());
    expect(c.verdict.tone).toBe("clean");
    expect(c.weather).toEqual({ skies: "parcialmente nublado", temperature: "24 °C", humidity: "40%", rain: null });
    expect(c.incidents).toMatchObject({ median: 2, mine: 2, highCount: 0 });
  });
  it("classifica corrida bagunçada por bandeiras ou abandonos e agrupa os motivos", () => {
    const rows = field().map((r, i) => (i < 3 ? { ...r, reason_out: i === 0 ? "Contact" : "Disconnected", incidents: 9 } : r));
    const c = raceCharacter({ ...event, num_cautions: 1 }, rows);
    expect(c.verdict.tone).toBe("messy");
    expect(c.retired).toBe(3);
    expect(c.retiredReasons[0]).toEqual({ reason: "Disconnected", count: 2 });
    expect(c.incidents.highCount).toBe(3);
  });
  it("não exibe temperatura sem unidade conhecida", () => {
    expect(weatherSummary({ temp_value: 80 }).temperature).toBeNull();
  });
});

describe("recurringRivals", () => {
  const events = [1, 2, 3, 4].map((id) => ({ subsession_id: id, start_time: `2026-10-0${id}T10:00:00Z`, track_name: id % 2 ? "Motegi" : "Zandvoort" }));
  const mk = (sub: number, cust: number, finish: number, best: number, over: Partial<RivalRow> = {}): RivalRow => ({
    subsession_id: sub, cust_id: cust, display_name: `N${cust}`, country_code: "BR", car_class_id: 1, starting_position_in_class: finish, finish_position_in_class: finish,
    laps_complete: 20, incidents: 2, best_lap_time: best * T, oldi_rating: 3000, newi_rating: 3010, is_me: cust === 1, ...over,
  });
  it("conta placar direto, ritmo e exige o mínimo de encontros", () => {
    const mine = [1, 2, 3, 4].map((s) => mk(s, 1, 2, 100));
    const others = [
      ...[1, 2, 3].map((s) => mk(s, 7, s === 1 ? 5 : 0, 99)),
      ...[1, 2].map((s) => mk(s, 8, 5, 101)),
      ...[1, 2, 3, 4].map((s) => mk(s, 9, 5, 102, { car_class_id: s === 4 ? 2 : 1 })),
    ];
    const r = recurringRivals(events, mine, others);
    expect(r.rivals.map((x) => x.custId).sort()).toEqual([7, 9]);
    const seven = r.rivals.find((x) => x.custId === 7)!;
    expect(seven).toMatchObject({ encounters: 3, ahead: 1, behind: 2, paceDiff: 1, name: "N7" });
    expect(seven.recent.map((x) => x.ahead)).toEqual([true, false, false]);
    expect(r.hardest!.custId).toBe(7);
    expect(r.mostFrequent!.encounters).toBe(3);
    expect(r.opponentsTotal).toBe(3);
  });
  it("ignora quem não largou", () => {
    const mine = [1, 2, 3].map((s) => mk(s, 1, 2, 100));
    const others = [1, 2, 3].map((s) => mk(s, 7, 5, 99, { laps_complete: 0 }));
    expect(recurringRivals(events, mine, others).rivals).toEqual([]);
  });
});

describe("trackHistory", () => {
  const ev = [1, 2, 3, 4].map((id) => ({ subsession_id: id, start_time: `2026-09-0${id}T10:00:00Z`, race_week: id }));
  it("compara cada corrida com o top-5 e acusa tendência de aproximação", () => {
    const rows = ev.flatMap((e) => Array.from({ length: 6 }, (_, i) => ({
      subsession_id: e.subsession_id, cust_id: i + 1, car_class_id: 1, is_me: i === 5, best_lap_time: ((i === 5 ? 100 + (5 - e.subsession_id) * 0.5 : 90 + i)) * T,
    })));
    const h = trackHistory(ev, rows, 1);
    expect(h.points).toHaveLength(4);
    expect(h.points[0]).toMatchObject({ rank: 6, of: 6, gapTop1: 12, top5Mean: 92 });
    expect(h.points[3].gapTop5).toBeLessThan(h.points[0].gapTop5!);
    expect(h.trend!.label).toBe("melhorando");
  });
  it("ignora outras classes e corridas sem o piloto; menos de 3 pontos não tem tendência", () => {
    const rows = [
      { subsession_id: 1, cust_id: 1, car_class_id: 1, is_me: true, best_lap_time: 100 * T }, { subsession_id: 1, cust_id: 2, car_class_id: 1, is_me: false, best_lap_time: 99 * T },
      { subsession_id: 2, cust_id: 2, car_class_id: 1, is_me: false, best_lap_time: 99 * T },
    ];
    const h = trackHistory(ev, rows, 1);
    expect(h.points).toHaveLength(1);
    expect(h.trend).toBeNull();
    expect(trackHistory(ev, rows, 2).points).toHaveLength(0);
  });
});

describe("buildRaceFieldView", () => {
  it("monta as quatro seções e o split", () => {
    const view = buildRaceFieldView(event, field());
    expect(view.split).toEqual({ index: 2, total: 2 });
    expect(view.classLabel).toBe("GT3");
    expect(view.pace?.best?.rank).toBe(3);
    expect(view.quali?.size).toBe(10);
    expect(view.character.drivers).toBe(10);
  });
});
