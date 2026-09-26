import { describe, expect, it } from "vitest";
import { classifyRaceLaps, lapSetKey, parseLapTimeText, type RaceLapRow } from "./race-debrief-laps";

const row = (lap_number: number, lap_time: number, extra: Partial<RaceLapRow> = {}): RaceLapRow => ({
  id: `l${lap_number}-${lap_time}`, lap_number, lap_time, clean: true, off_track: false, pit_in: false, pit_out: false, pit_lane: false,
  incomplete: false, missing: false, telemetry_path: null, ...extra,
});

describe("classifyRaceLaps", () => {
  it("separa largada, box, saída de pista, incidente e voltas fora do ritmo", () => {
    const rows = [
      row(0, 82.5), row(1, 77.7), row(2, 70.1), row(3, 70.4, { off_track: true }), row(4, 69.9), row(5, 70.0),
      row(6, 70.2), row(7, 101.0), row(8, 70.3), row(9, 72.0, { pit_in: true }), row(10, 70.1, { clean: false }),
      row(11, 7.8, { incomplete: true }), row(12, 69.8), row(13, 60.1),
    ];
    const { kept, discarded } = classifyRaceLaps(rows);
    expect(kept.map((lap) => lap.lapNumber)).toEqual([2, 4, 5, 6, 8, 12]);
    expect(discarded.map((lap) => [lap.lapNumber, lap.reason])).toEqual([
      [1, "largada"],
      [3, "saída de pista"],
      [7, "volta lenta: tráfego, toque ou erro"],
      [9, "entrada ou saída dos boxes"],
      [10, "incidente registrado"],
      [13, "rápida demais para o seu ritmo (provável vácuo ou P2P)"],
    ]);
  });

  it("com poucas voltas não descarta por estatística", () => {
    const { kept } = classifyRaceLaps([row(2, 70), row(3, 90), row(4, 70.2)]);
    expect(kept).toHaveLength(3);
  });
});

describe("parseLapTimeText", () => {
  it("lê mm:ss.mmm e ss.mmm", () => {
    expect(parseLapTimeText("1:18.395")).toBeCloseTo(78.395, 5);
    expect(parseLapTimeText("58.2")).toBeCloseTo(58.2, 5);
    expect(parseLapTimeText(null)).toBeNull();
    expect(parseLapTimeText("abc")).toBeNull();
  });
});

describe("lapSetKey", () => {
  it("muda quando chega telemetria e não depende da ordem", () => {
    const a = [row(2, 70), row(3, 71, { telemetry_path: "x" })];
    const b = [row(3, 71, { telemetry_path: "x" }), row(2, 70)];
    const c = [row(2, 70, { telemetry_path: "y" }), row(3, 71, { telemetry_path: "x" })];
    expect(lapSetKey(a)).toBe(lapSetKey(b));
    expect(lapSetKey(a)).not.toBe(lapSetKey(c));
  });
});
