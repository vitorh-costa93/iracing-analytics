import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// TEMPORARY debug route -- grid-searches corner-detection constants against a real stored lap's GPS
// trace so they can be tuned without a deploy per attempt. Delete once corner-detection.ts's real
// constants are finalized (see the 29/08/2026 Algarve corner-count fix).

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

function normalizedHeader(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function parseLapCsv(csv: string): { distance: number; lat: number | null; lon: number | null }[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizedHeader);
  const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const distanceIndex = find("lapdistpct", "lapdistancepct", "distancepct", "lapdist", "distance");
  const latIndex = find("lat", "latitude");
  const lonIndex = find("lon", "longitude");
  if (distanceIndex < 0 || latIndex < 0 || lonIndex < 0) return [];
  const raw = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  const points = raw.map((cells) => {
    const distance = Number(cells[distanceIndex]);
    const lat = Number(cells[latIndex]), lon = Number(cells[lonIndex]);
    return { distance, lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null };
  }).filter((point) => Number.isFinite(point.distance)).sort((a, b) => a.distance - b.distance);
  if (!points.length) return [];
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
  return points;
}

function splitByProminence(segment: { distance: number; value: number }[], splitRatio: number) {
  const n = segment.length;
  if (n === 0) return [];
  if (n < 3) {
    let peakIdx = 0;
    for (let i = 1; i < n; i++) if (segment[i].value > segment[peakIdx].value) peakIdx = i;
    return [{ start: segment[0].distance, end: segment[n - 1].distance, peakDistance: segment[peakIdx].distance, peak: segment[peakIdx].value }];
  }
  type Extremum = { index: number; value: number };
  const peaks: Extremum[] = [];
  for (let i = 0; i < n; i++) {
    const value = segment[i].value;
    const prev = i > 0 ? segment[i - 1].value : -Infinity;
    const next = i < n - 1 ? segment[i + 1].value : -Infinity;
    if (value >= prev && value > next) peaks.push({ index: i, value });
  }
  if (peaks.length === 0) peaks.push({ index: n - 1, value: segment[n - 1].value });
  const valleyBetween = (a: number, b: number) => { let min = Infinity; for (let i = a; i <= b; i++) min = Math.min(min, segment[i].value); return min; };
  const kept = peaks.slice();
  while (kept.length > 1) {
    let weakestPos = -1, weakestRatio = -Infinity;
    for (let i = 0; i < kept.length - 1; i++) {
      const ratio = valleyBetween(kept[i].index, kept[i + 1].index) / Math.min(kept[i].value, kept[i + 1].value);
      if (ratio > weakestRatio) { weakestRatio = ratio; weakestPos = i; }
    }
    if (weakestRatio < splitRatio) break;
    const a = kept[weakestPos], b = kept[weakestPos + 1];
    kept.splice(weakestPos, 2, a.value >= b.value ? a : b);
  }
  return kept.map((peak, i) => {
    let startIdx = 0;
    if (i > 0) { let minIdx = kept[i - 1].index, minVal = Infinity; for (let j = kept[i - 1].index; j <= peak.index; j++) if (segment[j].value < minVal) { minVal = segment[j].value; minIdx = j; } startIdx = minIdx; }
    let endIdx = n - 1;
    if (i < kept.length - 1) { let minIdx = peak.index, minVal = Infinity; for (let j = peak.index; j <= kept[i + 1].index; j++) if (segment[j].value < minVal) { minVal = segment[j].value; minIdx = j; } endIdx = minIdx; }
    return { start: segment[startIdx].distance, end: segment[endIdx].distance, peakDistance: segment[peak.index].distance, peak: peak.value };
  });
}

function detect(points: { distance: number; lat: number | null; lon: number | null }[], step: number, thresholdPercentile: number, thresholdRatio: number, splitRatio: number, mergeGapPct: number) {
  const valid = points.filter((p): p is { distance: number; lat: number; lon: number } => p.lat !== null && p.lon !== null).sort((a, b) => a.distance - b.distance);
  if (valid.length < 30) return { count: 0, corners: [] as unknown[] };
  const meanLat = valid.reduce((sum, p) => sum + p.lat, 0) / valid.length;
  const lonScale = Math.cos(meanLat * Math.PI / 180);
  const nearest = (distance: number) => valid.reduce((best, p) => Math.abs(p.distance - distance) < Math.abs(best.distance - distance) ? p : best, valid[0]);
  const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const total = Math.round(100 / step);
  const samples = Array.from({ length: total }, (_, index) => {
    const distance = index * step;
    const before = nearest((distance - 1 + 100) % 100), center = nearest(distance), after = nearest((distance + 1) % 100);
    const headingIn = Math.atan2(center.lat - before.lat, (center.lon - before.lon) * lonScale);
    const headingOut = Math.atan2(after.lat - center.lat, (after.lon - center.lon) * lonScale);
    return { distance, value: Math.abs(angleDelta(headingIn, headingOut)) };
  });
  const sorted = samples.map((s) => s.value).sort((a, b) => a - b);
  const threshold = (sorted[Math.floor(sorted.length * thresholdPercentile)] ?? 0) * thresholdRatio;
  if (threshold <= 0) return { count: 0, corners: [] };
  const runs: Array<{ startIdx: number; endIdx: number }> = [];
  let runStartIdx: number | null = null;
  for (let i = 0; i < total; i++) {
    if (samples[i].value >= threshold) { if (runStartIdx === null) runStartIdx = i; }
    else if (runStartIdx !== null) { runs.push({ startIdx: runStartIdx, endIdx: i - 1 }); runStartIdx = null; }
  }
  if (runStartIdx !== null) runs.push({ startIdx: runStartIdx, endIdx: total - 1 });
  if (runs.length >= 2) {
    const first = runs[0], last = runs[runs.length - 1];
    if (first.startIdx === 0 && last.endIdx === total - 1) { runs[0] = { startIdx: last.startIdx, endIdx: first.endIdx + total }; runs.pop(); }
  }
  const mergeGap = Math.max(1, Math.round(mergeGapPct / step));
  const merged: Array<{ startIdx: number; endIdx: number }> = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.startIdx - last.endIdx < mergeGap) last.endIdx = Math.max(last.endIdx, run.endIdx);
    else merged.push({ ...run });
  }
  const at = (idx: number) => samples[((idx % total) + total) % total];
  const corners: Array<{ start: number; end: number; peakDistance: number; peak: number }> = [];
  for (const run of merged) {
    const length = run.endIdx - run.startIdx + 1;
    const segment = Array.from({ length }, (_, k) => at(run.startIdx + k));
    corners.push(...splitByProminence(segment, splitRatio));
  }
  const filtered = corners.filter((item) => item.end - item.start >= step * 2);
  return { count: filtered.length, corners: filtered.map((c) => ({ start: Number(c.start.toFixed(1)), end: Number(c.end.toFixed(1)), peak: Number(c.peak.toFixed(3)) })) };
}

export async function GET(request: NextRequest) {
  try {
    const { data: tracks } = await supabaseAdmin.from("tracks").select("id,name,variant").ilike("name", "%algarve%");
    const trackId = Number(request.nextUrl.searchParams.get("trackId")) || tracks?.[0]?.id;
    if (!trackId) return NextResponse.json({ status: "error", message: "track not found", tracks }, { status: 404 });
    const { data: laps, error: lapsError } = await supabaseAdmin.from("laps").select("id,telemetry_path,lap_time").eq("track_id", trackId).order("id", { ascending: false }).limit(50);
    const candidates = (laps ?? []).filter((item) => item.telemetry_path);
    if (!candidates.length) return NextResponse.json({ status: "error", message: "no lap with stored telemetry", trackId, lapsError, lapsCount: laps?.length ?? null, sampleLaps: laps?.slice(0, 5) }, { status: 404 });
    let points: ReturnType<typeof parseLapCsv> = [];
    let usedLapId = "";
    for (const candidate of candidates) {
      const { data: file } = await supabaseAdmin.storage.from("telemetry").download(candidate.telemetry_path as string);
      if (!file) continue;
      const parsed = parseLapCsv(await file.text());
      const validGps = parsed.filter((p) => p.lat !== null && p.lon !== null).length;
      if (validGps > points.filter((p) => p.lat !== null && p.lon !== null).length) { points = parsed; usedLapId = candidate.id; }
      if (validGps >= 400) break; // good enough sample, stop scanning
    }
    if (!points.length) return NextResponse.json({ status: "error", message: "no candidate lap parsed", candidateCount: candidates.length }, { status: 500 });

    const grid: Array<{ step: number; thresholdPercentile: number; thresholdRatio: number; splitRatio: number; mergeGapPct: number; count: number }> = [];
    const steps = [0.15, 0.1];
    const percentiles = [0.6, 0.65, 0.7];
    const ratios = [0.45, 0.55];
    const splits = [0.6, 0.68, 0.72, 0.78, 0.85];
    const mergeGaps = [0.5, 1];
    for (const step of steps) for (const thresholdPercentile of percentiles) for (const thresholdRatio of ratios) for (const splitRatio of splits) for (const mergeGapPct of mergeGaps) {
      const result = detect(points, step, thresholdPercentile, thresholdRatio, splitRatio, mergeGapPct);
      grid.push({ step, thresholdPercentile, thresholdRatio, splitRatio, mergeGapPct, count: result.count });
    }

    const only15 = grid.filter((g) => g.count === 15);
    const detail = detect(points, 0.15, 0.7, 0.55, Number(request.nextUrl.searchParams.get("splitRatio") ?? 0.72), 1);

    const validGpsCount = points.filter((p) => p.lat !== null && p.lon !== null).length;
    return NextResponse.json({ status: "ok", pointCount: points.length, validGpsCount, candidatesScanned: candidates.length, samplePoints: points.slice(0, 3), lapId: usedLapId, gridResultsAt15: only15, allCounts: grid.map((g) => g.count), detail });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
