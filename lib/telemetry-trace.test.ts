import { describe, expect, it } from "vitest";
import { hasCompleteGps, parseTelemetryCsv, traceUsesOvertake } from "./telemetry-trace";

function csv(rows: number, options: { gpsFrom?: number; gpsTo?: number; p2pCountStep?: boolean } = {}) {
  const lines = ["LapDistPct,Speed,Throttle,Brake,Gear,Lat,Lon,P2P_Count"];
  for (let i = 0; i <= rows; i += 1) {
    const pct = i / rows;
    const hasGps = pct * 100 >= (options.gpsFrom ?? 0) && pct * 100 <= (options.gpsTo ?? 100);
    const lat = hasGps ? (50 + Math.sin(pct * Math.PI * 2) * 0.01).toFixed(6) : "";
    const lon = hasGps ? (5 + Math.cos(pct * Math.PI * 2) * 0.01).toFixed(6) : "";
    const count = options.p2pCountStep && pct > 0.5 ? 1 : 0;
    lines.push(`${pct.toFixed(4)},50,1,0,4,${lat},${lon},${count}`);
  }
  return lines.join("\n");
}

describe("parseTelemetryCsv", () => {
  it("lê LapDistPct 0-1 como % da volta e estima o comprimento pelo GPS", () => {
    const trace = parseTelemetryCsv(csv(200));
    expect(trace.points[0].distance).toBe(0);
    expect(trace.points[trace.points.length - 1].distance).toBeCloseTo(100, 5);
    expect(trace.trackLengthMeters).toBeGreaterThan(1000);
  });
});

describe("hasCompleteGps", () => {
  it("aceita uma volta com GPS do início ao fim", () => {
    expect(hasCompleteGps(parseTelemetryCsv(csv(200)))).toBe(true);
  });
  it("rejeita uma volta com o GPS só em parte da pista", () => {
    expect(hasCompleteGps(parseTelemetryCsv(csv(200, { gpsTo: 60 })))).toBe(false);
  });
});

describe("traceUsesOvertake", () => {
  it("detecta P2P usado durante a volta pela contagem que sobe", () => {
    expect(traceUsesOvertake(parseTelemetryCsv(csv(200, { p2pCountStep: true })))).toBe(true);
    expect(traceUsesOvertake(parseTelemetryCsv(csv(200)))).toBe(false);
  });
});
