# Local Coach Baselines Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/local-coach/baselines?car=<id>&track=<id>` to `iracing-analytics`, returning per-corner historical baselines (braking point, steering wasted-motion, wheelspin/RPM-surplus rate, lap-time contribution) for the `iracing-live-coach` desktop app to consume.

**Architecture:** A pure aggregation module (`lib/local-coach-baselines.ts`) computes the four per-corner baselines from a pool of parsed lap traces plus already-detected corner boundaries. The route handler (`app/api/telemetry/local-coach/baselines/route.ts`) does the I/O: auth, fetch this driver's laps for the car/track, download+parse their CSVs, detect corners, call the aggregation module, shape the JSON response. This is the same two-layer split (pure function + route I/O) already used throughout `app/api/telemetry/*`.

**Tech Stack:** Next.js 15 route handler, TypeScript, Vitest (matches `lib/traction-events.test.ts`'s existing fixture style), Supabase (`supabaseAdmin`, already-established client).

**Spec:** `docs/superpowers/specs/2026-09-12-live-coach-overlay-design.md`

## Global Constraints

- Corner names: only verified names from `lib/track-corners.ts`; an unmatched corner is a plain number. Never invent a name.
- Auth: `x-import-key` header checked against `process.env.LOCAL_COACH_SECRET` (a new env var, distinct from `GARAGE61_IMPORT_SECRET`), same 401 JSON shape as `app/api/setup/garage61-import/route.ts`.
- No corner history yet for a car/track: return `corners: []`, not an error.
- A corner with too few historical laps to trust its own baseline: omit that specific signal for that corner as `null`, never a fabricated number.

---

### Task 1: Corner baseline aggregation module

**Files:**
- Create: `lib/local-coach-baselines.ts`
- Test: `lib/local-coach-baselines.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure, self-contained module).
- Produces:
  - `type CoachSample = { distance: number; brake?: number; steeringRad?: number; rpm?: number; gear?: number; speedMs?: number }`
  - `type CoachCorner = { number: number; name: string | null; startDistance: number; endDistance: number }`
  - `type CornerBaseline = { number: number; name: string | null; startPct: number; endPct: number; brakingPointPct: number | null; brakingPointStdDev: number | null; correctionBaselineDeg: number | null; wheelspinRatePct: number | null; lapTimeContributionSeconds: number | null; lapTimeStdDev: number | null }`
  - `function computeCornerBaselines(laps: CoachSample[][], corners: CoachCorner[]): CornerBaseline[]`

- [ ] **Step 1: Write the failing test for braking-point baseline**

```typescript
// lib/local-coach-baselines.test.ts
import { describe, expect, it } from "vitest";
import { computeCornerBaselines, type CoachSample, type CoachCorner } from "./local-coach-baselines";

const CORNERS: CoachCorner[] = [{ number: 1, name: "Turn 1", startDistance: 10, endDistance: 20 }];

function makeLap(brakeOnsetPct: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    samples.push({ distance, brake: distance >= brakeOnsetPct && distance < brakeOnsetPct + 5 ? 0.8 : 0 });
  }
  return samples;
}

describe("computeCornerBaselines", () => {
  it("reports the median brake-onset point within the corner's own approach window", () => {
    const laps = [makeLap(8), makeLap(8.5), makeLap(7.5), makeLap(9)];
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.brakingPointPct).toBeCloseTo(8.25, 1);
    expect(corner.brakingPointStdDev).toBeGreaterThan(0);
  });

  it("returns null braking point for a corner nobody ever braked for", () => {
    const laps = [makeLap(50), makeLap(51), makeLap(52)]; // braking way outside corner 1's window
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.brakingPointPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: FAIL — `local-coach-baselines` module does not exist yet.

- [ ] **Step 3: Write the module (braking-point + scaffolding for the other three signals)**

```typescript
// lib/local-coach-baselines.ts
/** Per-corner historical baselines for app/api/telemetry/local-coach/baselines/route.ts, consumed by
 * the iracing-live-coach desktop app to compare THIS lap's live values against. This module only
 * computes "what's normal here" -- it never flags an anomaly itself; the live app's own LiveCoachEngine
 * does the ratio/threshold comparison at runtime, the same corner-relative-baseline philosophy already
 * validated in lib/traction-events.ts, just split so the numbers can travel over HTTP as plain JSON. */

export type CoachSample = {
  distance: number; // % of lap, 0-100
  brake?: number; // 0-1
  steeringRad?: number;
  rpm?: number;
  gear?: number;
  speedMs?: number;
};

export type CoachCorner = {
  number: number;
  name: string | null;
  startDistance: number; // % of lap
  endDistance: number; // % of lap
};

export type CornerBaseline = {
  number: number;
  name: string | null;
  startPct: number;
  endPct: number;
  brakingPointPct: number | null;
  brakingPointStdDev: number | null;
  correctionBaselineDeg: number | null;
  wheelspinRatePct: number | null;
  lapTimeContributionSeconds: number | null;
  lapTimeStdDev: number | null;
};

const BRAKE_THRESHOLD = 0.1; // matches parseLapCsv's own brake channel scale (0-1)
const APPROACH_WINDOW_PCT = 8; // how far before a corner's own start to look for the brake-onset point
const MIN_LAPS_FOR_BASELINE = 3; // mirrors traction-events.ts's own CORRECTION_MIN_LAPS -- a median across fewer laps isn't trustworthy

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[]): number {
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

/** First distance, within [corner.start - APPROACH_WINDOW_PCT, corner.end), where brake crosses above
 * BRAKE_THRESHOLD after being below it -- the same "onset" idea as a driver's own brake point, not
 * just "any sample with the pedal down" (which would also catch trail-braking deep into the corner). */
function brakeOnsetDistance(lap: CoachSample[], corner: CoachCorner): number | null {
  const windowStart = corner.startDistance - APPROACH_WINDOW_PCT;
  const inWindow = lap
    .filter((sample) => sample.distance >= windowStart && sample.distance < corner.endDistance)
    .sort((a, b) => a.distance - b.distance);
  for (let index = 1; index < inWindow.length; index += 1) {
    const previous = inWindow[index - 1], current = inWindow[index];
    if ((previous.brake ?? 0) < BRAKE_THRESHOLD && (current.brake ?? 0) >= BRAKE_THRESHOLD) return current.distance;
  }
  return null;
}

export function computeCornerBaselines(laps: CoachSample[][], corners: CoachCorner[]): CornerBaseline[] {
  return corners.map((corner) => {
    const brakingPoints = laps.map((lap) => brakeOnsetDistance(lap, corner)).filter((value): value is number => value !== null);
    const hasEnoughBraking = brakingPoints.length >= MIN_LAPS_FOR_BASELINE;
    return {
      number: corner.number, name: corner.name, startPct: corner.startDistance, endPct: corner.endDistance,
      brakingPointPct: hasEnoughBraking ? Number(median(brakingPoints).toFixed(2)) : null,
      brakingPointStdDev: hasEnoughBraking ? Number(stddev(brakingPoints).toFixed(2)) : null,
      correctionBaselineDeg: null, // Task 2
      wheelspinRatePct: null, // Task 3
      lapTimeContributionSeconds: null, lapTimeStdDev: null, // Task 4
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add lib/local-coach-baselines.ts lib/local-coach-baselines.test.ts
git commit -m "feat: braking-point baseline for local-coach endpoint"
```

---

### Task 2: Steering-correction baseline

**Files:**
- Modify: `lib/local-coach-baselines.ts`
- Modify: `lib/local-coach-baselines.test.ts`

**Interfaces:**
- Consumes: `CoachSample`, `CoachCorner`, `computeCornerBaselines` from Task 1 (same file, extended in place).
- Produces: `correctionBaselineDeg` populated (was hardcoded `null` in Task 1).

- [ ] **Step 1: Write the failing test**

```typescript
// Append to lib/local-coach-baselines.test.ts
function lapWithSteering(cornerWiggleDeg: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    const inCorner = distance >= 10 && distance < 20;
    samples.push({ distance, steeringRad: inCorner ? (cornerWiggleDeg * Math.PI) / 180 : 0 });
  }
  return samples;
}

describe("computeCornerBaselines -- steering correction", () => {
  it("reports the median wasted steering motion inside the corner's own window", () => {
    const laps = [lapWithSteering(5), lapWithSteering(6), lapWithSteering(4), lapWithSteering(5.5)];
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.correctionBaselineDeg).not.toBeNull();
    expect(corner.correctionBaselineDeg!).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: FAIL — `correctionBaselineDeg` is `null` (Task 1's hardcoded placeholder).

- [ ] **Step 3: Implement wasted-motion baseline**

```typescript
// Add to lib/local-coach-baselines.ts, above computeCornerBaselines

/** "Wasted" steering motion inside a corner's own window for one lap -- total absolute wheel movement
 * minus net displacement, same measure lib/traction-events.ts's binSteeringOscillation already
 * validated (near zero for a smooth turn-in, large when the wheel moves back and forth without
 * progressing the angle). Whole-corner window here (not per-1%-bin) since this is a single per-corner
 * baseline number for the live app, not a bin-by-bin anomaly scan. */
function wastedSteeringDeg(lap: CoachSample[], corner: CoachCorner): number | null {
  const inCorner = lap
    .filter((sample) => sample.distance >= corner.startDistance && sample.distance < corner.endDistance && sample.steeringRad !== undefined)
    .sort((a, b) => a.distance - b.distance);
  if (inCorner.length < 4) return null;
  let totalMoveDeg = 0;
  for (let index = 1; index < inCorner.length; index += 1) {
    totalMoveDeg += Math.abs((inCorner[index].steeringRad! - inCorner[index - 1].steeringRad!) * (180 / Math.PI));
  }
  const netMoveDeg = Math.abs((inCorner[inCorner.length - 1].steeringRad! - inCorner[0].steeringRad!) * (180 / Math.PI));
  return totalMoveDeg - netMoveDeg;
}
```

Then replace the `correctionBaselineDeg: null` line inside `computeCornerBaselines` with:

```typescript
      correctionBaselineDeg: (() => {
        const values = laps.map((lap) => wastedSteeringDeg(lap, corner)).filter((value): value is number => value !== null);
        return values.length >= MIN_LAPS_FOR_BASELINE ? Number(median(values).toFixed(2)) : null;
      })(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add lib/local-coach-baselines.ts lib/local-coach-baselines.test.ts
git commit -m "feat: steering-correction baseline for local-coach endpoint"
```

---

### Task 3: Wheelspin-rate baseline

**Files:**
- Modify: `lib/local-coach-baselines.ts`
- Modify: `lib/local-coach-baselines.test.ts`

**Interfaces:**
- Consumes: same as Task 2.
- Produces: `wheelspinRatePct` populated.

- [ ] **Step 1: Write the failing test**

```typescript
// Append to lib/local-coach-baselines.test.ts
function lapWithGearShift(rpmSurplusPct: number): CoachSample[] {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) {
    const inCorner = distance >= 10 && distance < 20;
    const speedMs = 30;
    const baseRpm = speedMs * 100; // arbitrary but consistent RPM-per-speed for gear 3 across every lap
    samples.push({ distance, gear: 3, speedMs, rpm: inCorner ? baseRpm * (1 + rpmSurplusPct / 100) : baseRpm });
  }
  return samples;
}

describe("computeCornerBaselines -- wheelspin rate", () => {
  it("reports how often this corner's exit shows an RPM surplus over this car's own gear model", () => {
    const laps = [lapWithGearShift(15), lapWithGearShift(0), lapWithGearShift(0), lapWithGearShift(0)];
    const [corner] = computeCornerBaselines(laps, CORNERS);
    expect(corner.wheelspinRatePct).not.toBeNull();
    expect(corner.wheelspinRatePct!).toBeCloseTo(25, 0); // 1 of 4 laps showed a surplus
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: FAIL — `wheelspinRatePct` is `null`.

- [ ] **Step 3: Implement the gear/RPM model + per-corner surplus rate**

```typescript
// Add to lib/local-coach-baselines.ts

const WHEELSPIN_RPM_SURPLUS_PCT = 8; // matches lib/traction-events.ts's own validated threshold
const WHEELSPIN_MIN_GEAR_SAMPLES = 20; // matches lib/traction-events.ts's own validated threshold

type GearModel = Record<number, { a: number; b: number } | undefined>;

/** RPM = a*speed + b per gear, pooled across every lap in the pool -- same technique as
 * lib/traction-events.ts's buildGearRpmModel, reimplemented here since this module works on
 * CoachSample (distance-keyed, no lap-index bookkeeping needed) rather than TractionSample. */
function buildGearModel(laps: CoachSample[][]): GearModel {
  const byGear = new Map<number, { speed: number; rpm: number }[]>();
  for (const lap of laps) {
    for (const sample of lap) {
      if (sample.gear === undefined || sample.rpm === undefined || sample.speedMs === undefined) continue;
      if (sample.gear < 1 || sample.speedMs <= 1) continue;
      if (!byGear.has(sample.gear)) byGear.set(sample.gear, []);
      byGear.get(sample.gear)!.push({ speed: sample.speedMs, rpm: sample.rpm });
    }
  }
  const model: GearModel = {};
  for (const [gear, points] of byGear) {
    if (points.length < WHEELSPIN_MIN_GEAR_SAMPLES) continue;
    const n = points.length;
    const sx = points.reduce((sum, point) => sum + point.speed, 0);
    const sy = points.reduce((sum, point) => sum + point.rpm, 0);
    const sxx = points.reduce((sum, point) => sum + point.speed ** 2, 0);
    const sxy = points.reduce((sum, point) => sum + point.speed * point.rpm, 0);
    const denominator = n * sxx - sx * sx;
    if (denominator === 0) continue;
    const a = (n * sxy - sx * sy) / denominator;
    model[gear] = { a, b: (sy - a * sx) / n };
  }
  return model;
}

function hasWheelspinInCorner(lap: CoachSample[], corner: CoachCorner, model: GearModel): boolean {
  return lap.some((sample) => {
    if (sample.distance < corner.startDistance || sample.distance >= corner.endDistance) return false;
    if (sample.gear === undefined || sample.rpm === undefined || sample.speedMs === undefined) return false;
    const fit = model[sample.gear];
    if (!fit) return false;
    const predicted = fit.a * sample.speedMs + fit.b;
    if (predicted <= 0) return false;
    return ((sample.rpm - predicted) / predicted) * 100 >= WHEELSPIN_RPM_SURPLUS_PCT;
  });
}
```

Then, inside `computeCornerBaselines`, build the model once before the `corners.map(...)` call:

```typescript
export function computeCornerBaselines(laps: CoachSample[][], corners: CoachCorner[]): CornerBaseline[] {
  const gearModel = buildGearModel(laps);
  return corners.map((corner) => {
```

and replace `wheelspinRatePct: null` with:

```typescript
      wheelspinRatePct: laps.length >= MIN_LAPS_FOR_BASELINE
        ? Number(((laps.filter((lap) => hasWheelspinInCorner(lap, corner, gearModel)).length / laps.length) * 100).toFixed(1))
        : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add lib/local-coach-baselines.ts lib/local-coach-baselines.test.ts
git commit -m "feat: wheelspin-rate baseline for local-coach endpoint"
```

---

### Task 4: Lap-time-contribution baseline

**Files:**
- Modify: `lib/local-coach-baselines.ts`
- Modify: `lib/local-coach-baselines.test.ts`

**Interfaces:**
- Consumes: same as Task 2/3.
- Produces: `lapTimeContributionSeconds`/`lapTimeStdDev` populated. This task also changes
  `computeCornerBaselines`'s signature to take each lap's own total time (needed to convert a
  speed-integral into real seconds) — **later tasks (route handler) must pass `lapTimeSeconds`
  alongside each lap's samples.**

- [ ] **Step 1: Write the failing test**

```typescript
// Append to lib/local-coach-baselines.test.ts
function lapWithConstantSpeed(speedMs: number): { samples: CoachSample[]; lapTimeSeconds: number } {
  const samples: CoachSample[] = [];
  for (let distance = 0; distance <= 100; distance += 0.5) samples.push({ distance, speedMs });
  return { samples, lapTimeSeconds: 1609 / speedMs }; // 1609m = arbitrary fixed lap length for this fixture
}

describe("computeCornerBaselines -- lap-time contribution", () => {
  it("reports how many seconds of the lap this corner's own window typically costs", () => {
    const laps = [lapWithConstantSpeed(40), lapWithConstantSpeed(41), lapWithConstantSpeed(39)];
    const [corner] = computeCornerBaselines(
      laps.map((lap) => lap.samples), CORNERS, laps.map((lap) => lap.lapTimeSeconds),
    );
    expect(corner.lapTimeContributionSeconds).not.toBeNull();
    expect(corner.lapTimeContributionSeconds!).toBeGreaterThan(0);
    expect(corner.lapTimeStdDev).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: FAIL — `computeCornerBaselines` doesn't accept a third argument yet, and `lapTimeContributionSeconds` is `null`.

- [ ] **Step 3: Implement the speed-integral lap-time contribution**

```typescript
// Add to lib/local-coach-baselines.ts

/** Seconds spent between two %-of-lap points, found by integrating 1/speed over distance and scaling
 * by this lap's own real total time -- same technique already validated in
 * app/api/telemetry/car-comparison/route.ts's integrateInverseSpeed/lapScale (a lap's average pace
 * isn't uniform, but 1/speed integrates real elapsed time correctly along the way). */
function cornerTimeSeconds(lap: CoachSample[], corner: CoachCorner, lapTimeSeconds: number): number | null {
  const withSpeed = lap.filter((sample) => sample.speedMs !== undefined && sample.speedMs > 1).sort((a, b) => a.distance - b.distance);
  if (withSpeed.length < 4) return null;
  const integralBetween = (start: number, end: number) => {
    let total = 0;
    for (let index = 1; index < withSpeed.length; index += 1) {
      const previous = withSpeed[index - 1], current = withSpeed[index];
      if (current.distance <= start || previous.distance >= end) continue;
      const segmentStart = Math.max(previous.distance, start), segmentEnd = Math.min(current.distance, end);
      if (segmentEnd <= segmentStart) continue;
      total += (segmentEnd - segmentStart) / current.speedMs!;
    }
    return total;
  };
  const fullLapIntegral = integralBetween(0, 100);
  if (fullLapIntegral <= 0) return null;
  const scale = lapTimeSeconds / fullLapIntegral;
  return integralBetween(corner.startDistance, corner.endDistance) * scale;
}
```

Change the function signature and the two `null` fields:

```typescript
export function computeCornerBaselines(laps: CoachSample[][], corners: CoachCorner[], lapTimesSeconds: number[]): CornerBaseline[] {
  const gearModel = buildGearModel(laps);
  return corners.map((corner) => {
    const cornerTimes = laps
      .map((lap, index) => cornerTimeSeconds(lap, corner, lapTimesSeconds[index]))
      .filter((value): value is number => value !== null);
    const hasEnoughTimes = cornerTimes.length >= MIN_LAPS_FOR_BASELINE;
    return {
      // ...existing fields unchanged...
      lapTimeContributionSeconds: hasEnoughTimes ? Number(median(cornerTimes).toFixed(3)) : null,
      lapTimeStdDev: hasEnoughTimes ? Number(stddev(cornerTimes).toFixed(3)) : null,
    };
  });
}
```

(Keep every other field from Tasks 1-3 in the returned object exactly as already written — only these
two `null` placeholders and the trailing two lines of the object change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/local-coach-baselines.test.ts`
Expected: PASS (every test in the file)

- [ ] **Step 5: Commit**

```bash
git add lib/local-coach-baselines.ts lib/local-coach-baselines.test.ts
git commit -m "feat: lap-time-contribution baseline for local-coach endpoint"
```

---

### Task 5: Route handler

**Files:**
- Create: `app/api/telemetry/local-coach/baselines/route.ts`
- Test: `app/api/telemetry/local-coach/baselines/route.test.ts`

**Interfaces:**
- Consumes: `computeCornerBaselines`, `CoachSample`, `CoachCorner` from `lib/local-coach-baselines.ts`
  (Tasks 1-4); `detectCornersFromGps`, `DetectedCorner` from `lib/corner-detection.ts` (existing,
  unchanged); `supabaseAdmin` from `lib/supabase-admin.ts` (existing, unchanged).
- Produces: the actual HTTP endpoint. No other task consumes this.

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/telemetry/local-coach/baselines/route.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("GET /api/telemetry/local-coach/baselines", () => {
  const originalSecret = process.env.LOCAL_COACH_SECRET;
  beforeEach(() => { process.env.LOCAL_COACH_SECRET = "test-secret"; });
  afterEach(() => { process.env.LOCAL_COACH_SECRET = originalSecret; });

  it("rejects a request without the correct x-import-key header", async () => {
    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/telemetry/local-coach/baselines?car=1&track=2");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("rejects a request missing car or track query params", async () => {
    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/telemetry/local-coach/baselines?car=1", {
      headers: { "x-import-key": "test-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/telemetry/local-coach/baselines/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 3: Implement the route**

```typescript
// app/api/telemetry/local-coach/baselines/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { detectCornersFromGps, type DetectedCorner } from "@/lib/corner-detection";
import { computeCornerBaselines, type CoachSample, type CoachCorner } from "@/lib/local-coach-baselines";

// 12/09/2026: feeds iracing-live-coach (separate repo, C#/.NET) -- see
// docs/superpowers/specs/2026-09-12-live-coach-overlay-design.md. Distinct secret from
// GARAGE61_IMPORT_SECRET so the two integrations can be rotated independently.
export const maxDuration = 300;

type ChannelKey = "brake" | "steering" | "speed" | "gear" | "rpm" | "lat" | "lon";
type TracePoint = { distance: number } & Partial<Record<ChannelKey, number>>;

function normalizedHeader(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}
// Same convention as app/api/telemetry/car-comparison/route.ts's own parseLapCsv -- kept local per
// this codebase's existing pattern of each telemetry route carrying its own small copy.
function parseLapCsv(csv: string): TracePoint[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizedHeader);
  const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const distanceIndex = find("lapdistpct", "lapdistancepct", "distancepct", "lapdist", "distance");
  if (distanceIndex < 0) return [];
  const indexes: Record<ChannelKey, number> = {
    brake: find("brake", "brakeraw", "brakepressure", "brakeinput"),
    steering: find("steeringwheelangle", "steeringangle"),
    speed: find("speed", "speedms", "speedkph", "carspeed"),
    gear: find("gear"), rpm: find("rpm", "enginerpm"),
    lat: find("lat", "latitude"), lon: find("lon", "longitude"),
  };
  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  return rows.map((row) => {
    const point: TracePoint = { distance: Number(row[distanceIndex]) * 100 };
    for (const [key, index] of Object.entries(indexes) as [ChannelKey, number][]) {
      if (index >= 0 && row[index] !== undefined && row[index] !== "") point[key] = Number(row[index]);
    }
    return point;
  }).filter((point) => Number.isFinite(point.distance));
}

const CANDIDATE_LAPS = 15; // recent laps to sample for this car/track -- enough for a stable median without downloading this driver's entire history every call

export async function GET(request: Request) {
  const secret = process.env.LOCAL_COACH_SECRET;
  if (!secret || request.headers.get("x-import-key") !== secret) {
    return NextResponse.json({ status: "error", message: "Chave inválida" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const carId = Number(params.get("car"));
  const trackId = Number(params.get("track"));
  if (!Number.isFinite(carId) || !Number.isFinite(trackId)) {
    return NextResponse.json({ status: "error", message: "car e track são obrigatórios" }, { status: 400 });
  }

  try {
    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    // Fetches a wider pool than CANDIDATE_LAPS and filters plausibility in application code (same
    // off_track/pit/incomplete/missing exclusion as app/api/telemetry/car-comparison/route.ts's own
    // isValidLap) BEFORE capping -- selecting exactly CANDIDATE_LAPS rows first, then filtering, could
    // leave a baseline built from only 2-3 genuinely valid laps out of 15 fetched on a session with a
    // lot of off-track excursions, the same class of bug already found and fixed in car-comparison.
    const { data: rawLapRows, error: lapsError } = await supabaseAdmin
      .from("laps")
      .select("id,lap_time,telemetry_path,off_track,pit_lane,pit_in,pit_out,missing")
      .eq("driver_id", driver.id).eq("car_id", carId).eq("track_id", trackId)
      .not("telemetry_path", "is", null).not("lap_time", "is", null)
      .order("synced_at", { ascending: false })
      .limit(CANDIDATE_LAPS * 3);
    if (lapsError) throw lapsError;
    const lapRows = (rawLapRows ?? [])
      .filter((row) => !row.off_track && !row.pit_lane && !row.pit_in && !row.pit_out && !row.missing)
      .slice(0, CANDIDATE_LAPS);
    if (!lapRows.length) return NextResponse.json({ status: "ok", trackLengthMeters: null, corners: [] });

    const traces = await Promise.all(lapRows.map(async (row) => {
      const { data: file, error } = await supabaseAdmin.storage.from("telemetry").download(row.telemetry_path!);
      if (error || !file) return null;
      return { points: parseLapCsv(await file.text()), lapTimeSeconds: Number(row.lap_time) };
    }));
    const valid = traces.filter((trace): trace is { points: TracePoint[]; lapTimeSeconds: number } => !!trace && trace.points.length > 20);
    if (!valid.length) return NextResponse.json({ status: "ok", trackLengthMeters: null, corners: [] });

    const detectedCorners: DetectedCorner[] = detectCornersFromGps(
      valid[0].points.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })),
    );
    const corners: CoachCorner[] = detectedCorners.map((corner) => ({
      number: corner.number, name: null, // corner naming (lib/track-corners.ts) wired in a follow-up task once this shape is confirmed against a real track
      startDistance: corner.startDistance, endDistance: corner.endDistance,
    }));

    const samples: CoachSample[][] = valid.map((trace) => trace.points.map((point) => ({
      distance: point.distance, brake: point.brake, steeringRad: point.steering, rpm: point.rpm, gear: point.gear, speedMs: point.speed,
    })));
    const baselines = computeCornerBaselines(samples, corners, valid.map((trace) => trace.lapTimeSeconds));

    return NextResponse.json({ status: "ok", trackLengthMeters: null, corners: baselines });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/telemetry/local-coach/baselines/route.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Full validation and commit**

```bash
npx tsc --noEmit
npx vitest run
git add app/api/telemetry/local-coach/baselines/route.ts app/api/telemetry/local-coach/baselines/route.test.ts
git commit -m "feat: GET /api/telemetry/local-coach/baselines route"
```

---

### Task 6: Corner naming + Vercel env var

**Files:**
- Modify: `app/api/telemetry/local-coach/baselines/route.ts`

**Interfaces:**
- Consumes: `lookupCornerNames(trackName: string, variant: string, detectedCount: number): (string | null)[] | null` from `lib/track-corners.ts` (existing, confirmed export — takes the track's own `name`/`variant` strings and the total number of detected corners, returns names indexed by corner position 0..detectedCount-1, or `null` if this track has no verified name list at all).
- Produces: `name` field on each corner baseline populated instead of hardcoded `null`.

- [ ] **Step 1: Fetch the track's name/variant and look up corner names**

In `app/api/telemetry/local-coach/baselines/route.ts`, add the import:

```typescript
import { lookupCornerNames } from "@/lib/track-corners";
```

Right after the `detectedCorners` line, fetch the track row and compute names:

```typescript
    const { data: trackRow } = await supabaseAdmin.from("tracks").select("name,variant").eq("id", trackId).maybeSingle();
    const cornerNames = trackRow ? lookupCornerNames(trackRow.name, trackRow.variant ?? "", detectedCorners.length) : null;
```

Then replace `name: null,` in the `corners` mapping with:

```typescript
      number: corner.number, name: cornerNames?.[corner.number - 1] ?? null,
```

- [ ] **Step 2: Run full validation**

```bash
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add app/api/telemetry/local-coach/baselines/route.ts
git commit -m "feat: real corner names for local-coach baselines"
```

- [ ] **Step 4: Add `LOCAL_COACH_SECRET` to Vercel**

```bash
npx vercel env add LOCAL_COACH_SECRET production
```
(Enter a newly-generated random secret when prompted and note it down — this is also the value `iracing-live-coach`'s own config will need later.)

- [ ] **Step 5: Deploy**

```bash
git push origin main
npx vercel --prod
```

- [ ] **Step 6: Verify live** with a real car/track this driver has laps for (use the secret entered in Step 4):

```bash
curl -s "https://iracing-analytics.vercel.app/api/telemetry/local-coach/baselines?car=<real_car_id>&track=<real_track_id>" -H "x-import-key: <secret from Step 4>"
```

Expected: `{"status":"ok","trackLengthMeters":null,"corners":[...]}` with real, non-null values for
corners this driver has 3+ laps of telemetry through.
