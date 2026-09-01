"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectCorners as detectCornersFromLatAccel, detectCornersFromGps } from "@/lib/corner-detection";
import { lookupCornerNames } from "@/lib/track-corners";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";
import FocusedGaugeChart, { type FocusedSide } from "@/components/FocusedGaugeChart";

type Combination = {
  key: string;
  label: string;
  car: { id: number; name: string };
  track: { id: number; name: string; variant: string | null };
  sessions: number;
  sessionTypes: number[];
  lapsFound: number;
  bestLap: null | { id: string; lapTime: number; startTime: string; sessionType: number | null; selectionReason: string; telemetryUrl: string };
};

type ActiveWeekData = {
  status: string;
  week: null | { seasonName: string; number: number; start: string; end: string };
  combinations: Combination[];
};

type ChannelKey = "speed" | "throttle" | "brake" | "steering" | "rpm" | "gear" | "clutch" | "latAccel" | "longAccel" | "yaw" | "yawRate" | "abs" | "drs" | "pushToPass" | "p2pStatus" | "p2pCount" | "lat" | "lon";
type TracePoint = { distance: number } & Record<ChannelKey, number | null>;
type Trace = { points: TracePoint[]; channels: string[]; trackLengthMeters: number | null };
type Reference = { filename: string; uploadedAt: string; csv: string };

type Comparison = {
  estimatedReferenceTime: number;
  estimatedGap: number;
  averageSpeedDifference: number;
  opportunities: { title: string; detail: string; gain: number; metrics: string[]; start: number; end: number; kind: "corner" | "straight"; cornerNumber: number | null; cornerLabel: string | null; primaryType: string }[];
  channelInsights: string[];
  lineDistance: { distance: number; meters: number }[];
};

type IbtVariable = { type: number; offset: number };

function formatLapTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Median-of-N despike for a discrete channel (31/08/2026: "há algum ruído nas minhas marchas... diz
 * que eu estou usando a primeira marcha, mas eu tenho certeza que não usei" -- confirmed this is a
 * real hazard of the stride-decimation a few lines down: at 900 points max for a whole lap, a single
 * one-frame glitch in the raw ~60Hz gear channel (iRacing's own gear signal occasionally reports a
 * spurious value for one sample during a hard multi-downshift) has a real chance of being the ONE
 * sample that survives decimation, making a real, sustained gear look like it briefly dropped to 1st
 * at 200+ km/h. A genuine gear stays constant for many consecutive raw samples; a real shift persists
 * too, just starting a few samples later -- a median filter over a small window keeps both while
 * dropping an outlier that only one sample agrees with. Runs on the full raw-resolution channel,
 * before decimation, so it has enough neighbors to work with. */
function despikeChannel(points: TracePoint[], field: ChannelKey, window = 5) {
  const half = Math.floor(window / 2);
  const original = points.map((point) => point[field]);
  return points.map((point, index) => {
    const windowValues: number[] = [];
    for (let offset = -half; offset <= half; offset += 1) {
      const value = original[index + offset];
      if (value !== null && value !== undefined) windowValues.push(value);
    }
    if (windowValues.length < 3) return point;
    const sorted = [...windowValues].sort((a, b) => a - b);
    return { ...point, [field]: sorted[Math.floor(sorted.length / 2)] };
  });
}

function parseTelemetryCsv(csv: string): Trace {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV de telemetria vazio ou incompleto");
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim());
  const keys = headers.map(normalized);
  const find = (...aliases: string[]) => keys.findIndex((key) => aliases.includes(key));
  const distanceIndex = find("lapdistpct", "lapdistancepct", "distancepct", "lapdist", "distance");
  const indexes: Record<ChannelKey, number> = {
    speed: find("speed", "gpsspeed", "velocity"), throttle: find("throttle", "throttleraw", "throttleposition", "throttleinput"),
    brake: find("brake", "brakeraw", "brakepressure", "brakeinput"), steering: find("steeringwheelangle", "steeringangle"),
    rpm: find("rpm", "engine0rpm"), gear: find("gear"), clutch: find("clutch", "clutchraw"),
    latAccel: find("lataccel", "lateralacceleration"), longAccel: find("longaccel", "longitudinalacceleration"),
    yaw: find("yaw"), yawRate: find("yawrate"), abs: find("absactive", "brakeabsactive"), drs: find("drsactive", "drsstatus"),
    pushToPass: find("pushtopass"), p2pStatus: find("p2pstatus"), p2pCount: find("p2pcount"),
    lat: find("lat", "latitude"), lon: find("lon", "longitude"),
  };
  if (distanceIndex < 0) throw new Error("O Garage61 não retornou um canal de distância reconhecido");

  const raw = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  // Kept in FILE order here (not sorted yet) -- lap-boundary detection below needs to see the real
  // chronological sequence, since sorting by distance across a multi-lap file interleaves samples
  // from different laps into one meaningless Frankenstein trace (e.g. a P2P burst near the end of
  // lap 2 could sort right next to the start of lap 1, and the "track shape" stops being any real
  // lap's actual path).
  const chronological = raw.map((cells) => {
    const point = { distance: Number(cells[distanceIndex]) } as TracePoint;
    for (const key of Object.keys(indexes) as ChannelKey[]) {
      const index = indexes[key];
      const parsed = index >= 0 ? Number(cells[index]) : Number.NaN;
      point[key] = Number.isFinite(parsed) ? parsed : null;
    }
    return point;
  }).filter((point) => Number.isFinite(point.distance));
  if (!chronological.length) throw new Error("A telemetria não contém amostras válidas");
  const maxRawDistance = Math.max(...chronological.map((point) => point.distance));
  if (maxRawDistance > 0 && maxRawDistance <= 1.01) chronological.forEach((point) => { point.distance *= 100; });
  // Despiked in chronological (time) order, before lap-splitting/decimation -- see despikeChannel's
  // own comment for why a single-frame gear glitch is otherwise likely to survive as the one sample
  // shown after decimation to ~900 points.
  const despikedGear = despikeChannel(chronological, "gear");
  despikedGear.forEach((point, index) => { chronological[index].gear = point.gear; });

  // Split into individual laps wherever distance drops sharply (lap wrap, ~100% -> ~0%) -- a
  // reference file exported "for the session" rather than "for one lap" is common (this is exactly
  // what a Garage61/iRStats driver uploading their own .csv is likely to do), and the file's byte
  // size alone is often the tell (a single lap is rarely more than a few hundred KB).
  const lapSegments: TracePoint[][] = [];
  let currentLap: TracePoint[] = [];
  for (const point of chronological) {
    if (currentLap.length && point.distance < currentLap[currentLap.length - 1].distance - 50) {
      lapSegments.push(currentLap);
      currentLap = [];
    }
    currentLap.push(point);
  }
  if (currentLap.length) lapSegments.push(currentLap);

  const completeLaps = lapSegments
    .map((segment) => [...segment].sort((a, b) => a.distance - b.distance))
    .filter((segment) => segment.length >= 50 && segment[0].distance <= 3 && segment[segment.length - 1].distance >= 97);
  // Sample count is a proxy for lap duration (roughly constant capture rate) -- CSV exports don't
  // reliably carry a time/session-time column to measure duration directly, unlike the IBT path.
  const cleanLaps = completeLaps.filter((segment) => !segment.some((point) =>
    Number(point.pushToPass ?? 0) > 0 || Number(point.p2pStatus ?? 0) > 0 || Number(point.p2pCount ?? 0) > 0));
  const pool = cleanLaps.length ? cleanLaps : completeLaps;
  const bestLap = pool.length ? pool.reduce((fastest, segment) => segment.length < fastest.length ? segment : fastest) : null;
  // Fall back to the whole file as one trace only when no segment reached a recognizable full lap
  // span (e.g. a file that's already a single, slightly-trimmed lap) -- same result as before this
  // fix for the common single-lap case, just routed through the same lap-detection path.
  const points = bestLap ?? [...chronological].sort((a, b) => a.distance - b.distance);
  const stride = Math.max(1, Math.ceil(points.length / 900));
  let trackLengthMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index];
    if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) continue;
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    trackLengthMeters += 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return {
    points: points.filter((_, index) => index % stride === 0),
    channels: headers,
    trackLengthMeters: trackLengthMeters > 1000 && trackLengthMeters < 30000 ? trackLengthMeters : null,
  };
}

function traceUsesOvertake(trace: Trace) {
  // p2pCount reads as a session-cumulative total, not a per-lap value -- a lap recorded after P2P
  // was used earlier in the same session/file still carries that nonzero count throughout, even if
  // P2P was never engaged DURING this specific lap. Checking that the count actually rose across
  // this trace's own points (not just that it's nonzero) is what tells "used here" apart from
  // "carried over from earlier". PushToPass/p2pStatus are per-instant flags, checked as before.
  const instantUsed = trace.points.some((point) => Number(point.pushToPass ?? 0) > 0 || Number(point.p2pStatus ?? 0) > 0);
  const counts = trace.points.map((point) => point.p2pCount).filter((value): value is number => value !== null);
  const countUsed = counts.length >= 2 && counts[counts.length - 1] > counts[0];
  return instantUsed || countUsed;
}

function readIbtValue(view: DataView, offset: number, type: number) {
  if (type === 0) return view.getInt8(offset);
  if (type === 1) return view.getUint8(offset);
  if (type === 2) return view.getInt32(offset, true);
  if (type === 3) return view.getUint32(offset, true);
  if (type === 4) return view.getFloat32(offset, true);
  if (type === 5) return view.getFloat64(offset, true);
  return Number.NaN;
}

function ibtToBestLapCsv(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 1024) throw new Error("Arquivo IBT vazio ou inválido");
  const version = view.getInt32(0, true);
  const variableCount = view.getInt32(24, true);
  const variableHeaderOffset = view.getInt32(28, true);
  const recordLength = view.getInt32(36, true);
  const recordOffset = view.getInt32(52, true);
  const recordCount = view.getInt32(140, true);
  if (version < 1 || variableCount <= 0 || variableCount > 2000 || recordLength <= 0 || recordCount <= 0 || recordOffset <= 0) {
    throw new Error("Cabeçalho IBT não reconhecido");
  }
  if (recordOffset + recordLength * recordCount > buffer.byteLength) throw new Error("Arquivo IBT truncado");

  const decoder = new TextDecoder("ascii");
  const variables = new Map<string, IbtVariable>();
  for (let index = 0; index < variableCount; index += 1) {
    const offset = variableHeaderOffset + index * 144;
    if (offset + 144 > buffer.byteLength) throw new Error("Tabela de canais IBT inválida");
    const rawName = new Uint8Array(buffer, offset + 16, 32);
    const zero = rawName.indexOf(0);
    const name = decoder.decode(zero >= 0 ? rawName.slice(0, zero) : rawName).trim();
    variables.set(name, { type: view.getInt32(offset, true), offset: view.getInt32(offset + 4, true) });
  }
  const required = ["SessionTime", "Lap", "LapDistPct", "Speed", "Brake", "Throttle"];
  for (const name of required) if (!variables.has(name)) throw new Error(`O IBT não contém o canal obrigatório ${name}`);
  const exported = ["Speed", "Brake", "Throttle", "RPM", "SteeringWheelAngle", "Gear", "Clutch", "LatAccel", "LongAccel", "Yaw", "YawRate", "BrakeABSactive", "DRS_Status", "PushToPass", "P2P_Status", "P2P_Count", "Lat", "Lon"];
  const value = (record: number, name: string) => {
    const variable = variables.get(name);
    if (!variable) return Number.NaN;
    return readIbtValue(view, recordOffset + record * recordLength + variable.offset, variable.type);
  };

  type LapPoint = { time: number; distance: number; values: number[] };
  let currentLap = Number.NaN;
  let points: LapPoint[] = [];
  let touchedPit = false;
  let best: { duration: number; points: LapPoint[] } | null = null;
  // PushToPass/P2P_Status are per-instant flags (checking "was it ever 1 during this lap" is
  // correct as-is), but P2P_Count reads as a SESSION-CUMULATIVE total, not a per-lap value — a
  // driver who engaged P2P even once anywhere in the recording would otherwise have every lap
  // AFTER that point permanently read count > 0, excluding every real lap that came after (the
  // exact failure reported: "a referência usa P2P" on a file where most laps never touched it).
  // Comparing the count at lap-start vs lap-end instead detects USE DURING THIS LAP specifically,
  // independent of how many times it was used earlier in the session.
  const instantIndexes = ["PushToPass", "P2P_Status"].map((name) => exported.indexOf(name)).filter((index) => index >= 0);
  const countIndex = exported.indexOf("P2P_Count");
  const finishLap = () => {
    if (points.length < 100 || touchedPit) return;
    const ordered = [...points].sort((a, b) => a.distance - b.distance);
    const minDistance = ordered[0].distance;
    const maxDistance = ordered[ordered.length - 1].distance;
    const duration = points[points.length - 1].time - points[0].time;
    if (minDistance > 0.03 || maxDistance < 0.97 || duration <= 10) return;
    const usedInstant = instantIndexes.some((index) => points.some((point) => Number(point.values[index] ?? 0) > 0));
    const usedCount = countIndex >= 0 && Number(ordered[ordered.length - 1].values[countIndex] ?? 0) > Number(ordered[0].values[countIndex] ?? 0);
    if (usedInstant || usedCount) return;
    if (!best || duration < best.duration) best = { duration, points: ordered };
  };

  for (let record = 0; record < recordCount; record += 1) {
    const lap = value(record, "Lap");
    const distance = value(record, "LapDistPct");
    if (!Number.isFinite(lap) || lap <= 0 || !Number.isFinite(distance) || distance < 0 || distance > 1.01) continue;
    if (lap !== currentLap) {
      finishLap();
      currentLap = lap;
      points = [];
      touchedPit = false;
    }
    touchedPit ||= value(record, "OnPitRoad") === 1;
    points.push({
      time: value(record, "SessionTime"), distance,
      values: exported.map((name) => value(record, name)),
    });
  }
  finishLap();
  const bestLap = best as { duration: number; points: LapPoint[] } | null;
  if (!bestLap) throw new Error("Nenhuma volta completa fora dos boxes foi encontrada no IBT");
  const stride = Math.max(1, Math.ceil(bestLap.points.length / 1800));
  const headers = ["LapDistPct", ...exported];
  const rows = bestLap.points.filter((_, index) => index % stride === 0).map((point) =>
    [point.distance, ...point.values].map((item) => Number.isFinite(item) ? item : "").join(",")
  );
  return { csv: [headers.join(","), ...rows].join("\n"), duration: bestLap.duration, samples: rows.length };
}

function polyline(points: TracePoint[], field: ChannelKey, top: number, height: number, scalePoints = points) {
  const values = scalePoints.map((point) => point[field]).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return "";
  // Steering and yaw rate are signed (left/right), not a 0-based pedal input — same fix as the
  // popup's line() below, so full left-steering traces stop getting clipped off the row.
  const min = field === "speed" || field === "steering" || field === "yaw" || field === "yawRate" ? Math.min(...values) : 0;
  const max = Math.max(...values);
  const span = Math.max(0.0001, max - min);
  return points.filter((point) => point[field] !== null && Number.isFinite(point[field])).map((point) => {
    const x = Math.max(0, Math.min(100, point.distance)) * 10;
    const y = top + height - ((Number(point[field]) - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function interpolate(points: TracePoint[], distance: number, field: ChannelKey) {
  let previous = points[0];
  for (const point of points) {
    if (point.distance >= distance) {
      const left = previous[field];
      const right = point[field];
      if (left === null || right === null) return null;
      const span = point.distance - previous.distance;
      const ratio = span > 0 ? (distance - previous.distance) / span : 0;
      return left + (right - left) * ratio;
    }
    previous = point;
  }
  return previous[field];
}

type Corner = { number: number; distance: number; name: string | null };

/** Detects every real corner (any part of the track that isn't a straight), then attaches a researched
 * name when the number of corners we detect on this lap plausibly matches the track's known corner
 * count. GPS heading-change is tried first -- it caught Algarve's flat-out/high-speed corners (Curva
 * Grande-style bends with little lateral-accel signal, or ones close enough together that the
 * lat-accel threshold merged them into one run) that lateral acceleration alone under-counted (11
 * detected vs the real 15, confirmed 29/08/2026), matching the debrief route's own GPS-first fallback
 * order. Falls back to lateral acceleration only when GPS is too sparse to trust. */
function detectCorners(points: TracePoint[], trackName: string, trackVariant: string): Corner[] {
  const gpsDetected = detectCornersFromGps(points.map((point) => ({ distance: point.distance, lat: point.lat ?? null, lon: point.lon ?? null })));
  const raw = gpsDetected.length >= 3 ? gpsDetected : detectCornersFromLatAccel(points.map((point) => ({ distance: point.distance, lateralAccel: point.latAccel })));
  const names = lookupCornerNames(trackName, trackVariant, raw.length);
  return raw.map((corner, index) => ({ number: corner.number, distance: corner.distance, name: names?.[index] ?? null }));
}

function nearestCorner(corners: Corner[], start: number, end: number): Corner | null {
  const center = (start + end) / 2;
  let best: Corner | null = null;
  let bestDist = Infinity;
  for (const corner of corners) {
    const d = Math.min(Math.abs(corner.distance - center), 100 - Math.abs(corner.distance - center));
    if (d < bestDist) { bestDist = d; best = corner; }
  }
  return best && bestDist <= 8 ? best : null;
}

function compareTraces(own: Trace, reference: Trace, ownLapTime: number, corners: Corner[]): Comparison | null {
  const bins = Array.from({ length: 401 }, (_, index) => index / 4);
  const fields: ChannelKey[] = ["speed", "throttle", "brake", "steering", "rpm", "gear", "clutch", "latAccel", "longAccel", "yawRate", "abs", "drs", "pushToPass", "p2pStatus", "p2pCount", "lat", "lon"];
  const samples = bins.map((distance) => {
    const values: Record<string, number | null> = { distance };
    for (const field of fields) { values[`own_${field}`] = interpolate(own.points, distance, field); values[`ref_${field}`] = interpolate(reference.points, distance, field); }
    return values;
  }).filter((item) => item.own_speed && item.ref_speed && item.own_speed > 1 && item.ref_speed > 1);
  if (samples.length < 100) return null;
  // Signed lateral offset (meters) between your GPS point and the reference's, at each sampled
  // distance — a flat-earth local projection (fine at track scale) using your OWN heading as the
  // tangent, so the sign reads as "the reference is to your left/right" at that instant. This is
  // the closest thing to Garage61's "line distance" chart the recorded GPS supports: not real
  // track-edge geometry, just how far apart the two driven paths are and which side.
  for (let index = 1; index < samples.length - 1; index += 1) {
    const cur = samples[index];
    const prevLat = samples[index - 1].own_lat, prevLon = samples[index - 1].own_lon;
    const nextLat = samples[index + 1].own_lat, nextLon = samples[index + 1].own_lon;
    const ownLat = cur.own_lat, ownLon = cur.own_lon, refLat = cur.ref_lat, refLon = cur.ref_lon;
    if (prevLat == null || prevLon == null || nextLat == null || nextLon == null || ownLat == null || ownLon == null || refLat == null || refLon == null) continue;
    const latRad = (Number(prevLat) + Number(nextLat)) / 2 * Math.PI / 180;
    const tx = (Number(nextLon) - Number(prevLon)) * 111320 * Math.cos(latRad);
    const ty = (Number(nextLat) - Number(prevLat)) * 110540;
    const tlen = Math.hypot(tx, ty) || 1;
    const ux = tx / tlen, uy = ty / tlen;
    const rx = (Number(refLon) - Number(ownLon)) * 111320 * Math.cos(latRad);
    const ry = (Number(refLat) - Number(ownLat)) * 110540;
    cur.lateral = ux * ry - uy * rx;
  }
  const ownIntegral = samples.reduce((sum, item) => sum + 1 / Number(item.own_speed), 0);
  const refIntegral = samples.reduce((sum, item) => sum + 1 / Number(item.ref_speed), 0);
  const scale = ownLapTime / ownIntegral;
  const estimatedReferenceTime = refIntegral * scale;
  const averageSpeedDifference = samples.reduce((sum, item) => sum + Number(item.ref_speed) - Number(item.own_speed), 0) / samples.length;
  const trackLength = own.trackLengthMeters ?? reference.trackLengthMeters;
  const brakeOnsets = (prefix: "own" | "ref") => samples.filter((item, index) => index > 0 && Number(samples[index - 1][`${prefix}_brake`] ?? 0) < .08 && Number(item[`${prefix}_brake`] ?? 0) >= .08).map((item) => Number(item.distance));
  const ownBrakes = brakeOnsets("own"), refBrakes = brakeOnsets("ref");
  const brakingDeltas = ownBrakes.map((position) => {
    const referencePosition = refBrakes.reduce((best, candidate) => Math.abs(candidate - position) < Math.abs(best - position) ? candidate : best, refBrakes[0] ?? position);
    return { position, deltaMeters: trackLength ? (position - referencePosition) / 100 * trackLength : null };
  }).filter((item) => item.deltaMeters !== null && Math.abs(item.deltaMeters) > 8);
  const segments = Array.from({ length: 20 }, (_, index) => {
    const rows = samples.filter((item) => Number(item.distance) >= index * 5 && Number(item.distance) < (index + 1) * 5);
    const avg = (key: string) => rows.reduce((sum, item) => sum + Number(item[key] ?? 0), 0) / Math.max(1, rows.length);
    const ownTime = rows.reduce((sum, item) => sum + 1 / Number(item.own_speed), 0) * scale;
    const refTime = rows.reduce((sum, item) => sum + 1 / Number(item.ref_speed), 0) * scale;
    return { index, gain: ownTime - refTime, speedGap: (avg("ref_speed") - avg("own_speed")) * 3.6, throttleGap: avg("ref_throttle") - avg("own_throttle"), brakeGap: avg("own_brake") - avg("ref_brake"), steeringGap: Math.abs(avg("own_steering")) - Math.abs(avg("ref_steering")), rpmGap: avg("ref_rpm") - avg("own_rpm"), gearGap: avg("ref_gear") - avg("own_gear"), latAccelGap: Math.abs(avg("ref_latAccel")) - Math.abs(avg("own_latAccel")), lateralOffsetMeters: avg("lateral") };
  }).filter((item) => item.gain > 0.008).sort((a, b) => b.gain - a.gain).slice(0, 6);
  const opportunities = segments.map((item, rankIndex) => {
    const start = item.index * 5, end = (item.index + 1) * 5;
    const braking = brakingDeltas.find((event) => event.position >= start - 2 && event.position <= end + 2);
    const corner = nearestCorner(corners, start, end);
    const kind: "corner" | "straight" = corner ? "corner" : "straight";
    const cornerLabel = corner ? corner.name ?? `Curva ${corner.number}` : null;
    const place = cornerLabel ? `na ${cornerLabel}` : "neste trecho";

    type Finding = { type: string; weight: number; clause: string; instruction: string };
    const findings: Finding[] = [];
    if (braking?.deltaMeters) {
      const early = braking.deltaMeters < 0;
      findings.push({
        type: early ? "braking-early" : "braking-late", weight: Math.abs(braking.deltaMeters) * 1.5,
        clause: early ? `você está freando ${Math.abs(braking.deltaMeters).toFixed(0)} m antes da referência` : `você está freando ${Math.abs(braking.deltaMeters).toFixed(0)} m depois da referência`,
        instruction: early ? `se a velocidade mínima e a saída continuarem boas, vá freando um pouco mais tarde a cada tentativa` : `veja no gráfico se isso está custando velocidade mínima ou atrasando o acelerador — pode ser espaço pra melhorar, ou pode ser o seu limite mesmo`,
      });
    }
    if (item.throttleGap > .06) findings.push({
      type: "throttle", weight: item.throttleGap * 200,
      clause: `a referência já está com ${(item.throttleGap * 100).toFixed(0)} pontos percentuais a mais de acelerador aqui`,
      instruction: "solte o freio e já comece a acelerar assim que o carro apontar pra saída, sem esperar ele estabilizar de vez",
    });
    if (item.brakeGap > .06) findings.push({
      type: "brake-pressure", weight: item.brakeGap * 180,
      clause: `você está aplicando ${(item.brakeGap * 100).toFixed(0)} pontos percentuais a mais de freio que a referência`,
      instruction: "tente pisar um pouco mais leve no freio, ou soltar ele de forma mais suave — isso ajuda a manter velocidade sem perder segurança",
    });
    if (Math.abs(item.steeringGap) > .03) findings.push({
      type: "steering", weight: Math.abs(item.steeringGap) * 300,
      clause: item.steeringGap > 0 ? "você está usando mais volante que a referência" : "a referência usa mais volante que você aqui, provavelmente rotacionando o carro mais cedo",
      instruction: item.steeringGap > 0 ? "tente virar uma vez só, sem corrigir — cada correção a mais cansa o pneu da frente e custa tempo" : "tente começar a virar um pouco antes, num movimento só",
    });
    if (Math.abs(item.gearGap) >= .45) findings.push({
      type: "gear", weight: Math.abs(item.gearGap) * 20,
      clause: `a referência usa marcha ${item.gearGap > 0 ? "mais alta" : "mais baixa"} nesse trecho`,
      instruction: "teste essa marcha no treino e veja se dá mais tração e estabilidade antes de usar na corrida",
    });
    if (item.latAccelGap > .5) findings.push({
      type: "rotation", weight: item.latAccelGap * 20,
      clause: "a referência mantém mais velocidade no ponto mais fechado da curva",
      instruction: "tente entrar mais rápido na curva e soltar o freio aos poucos até o ponto mais lento, sem mexer no volante no meio do caminho",
    });
    if (item.rpmGap > 300) findings.push({
      type: "rpm", weight: item.rpmGap / 30,
      clause: `a referência mantém cerca de ${item.rpmGap.toFixed(0)} RPM a mais`,
      instruction: "pode ser marcha diferente ou troca mais tarde — confira a marcha antes de mudar isso",
    });
    // Best-effort: sign is derived from your own heading as the tangent, so "esquerda"/"direita" is
    // internally consistent but not independently verified against a known-good reference — treat
    // the direction as a strong hint to check on the map, not gospel, if it ever reads backwards.
    if (Math.abs(item.lateralOffsetMeters) > .3) {
      const refToRight = item.lateralOffsetMeters > 0;
      findings.push({
        type: "line", weight: Math.abs(item.lateralOffsetMeters) * 40,
        clause: `a referência passa ${Math.abs(item.lateralOffsetMeters).toFixed(1)} m mais à ${refToRight ? "direita" : "esquerda"} que você aqui`,
        instruction: `tente passar um pouco mais pra ${refToRight ? "direita" : "esquerda"} aqui, sem sair da pista`,
      });
    }
    findings.sort((a, b) => b.weight - a.weight);
    const primaryType = (findings[0]?.type ?? "speed") as "braking-early" | "braking-late" | "throttle" | "brake-pressure" | "steering" | "gear" | "rotation" | "speed" | "line";

    const tenths = item.gain * 10;
    const magnitude = rankIndex === 0 && tenths >= 0.15 ? "Essa é a maior oportunidade da volta: " : tenths >= 0.12 ? "Ganho relevante aqui: " : "";
    let narrative: string;
    if (findings.length === 0) {
      narrative = `${magnitude}você está ${(item.speedGap).toFixed(1)} km/h mais lento que a referência ${place}, sem um motivo claro de freio, acelerador ou volante — pode ser confiança ou o caminho que você faz na curva. Compare seu traçado com o da referência no mapa ao lado e veja se você passa pelo mesmo ponto mais fechado da curva.`;
    } else {
      const primary = findings[0];
      const secondary = findings.slice(1, 3);
      const secondaryText = secondary.length
        ? ` Também reparei que ${secondary.map((finding) => finding.clause).join(" e ")}${secondary.length === 1 ? `; ${secondary[0].instruction}.` : "."}`
        : "";
      const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
      narrative = `${magnitude}${cap(primary.clause)} ${place}. ${cap(primary.instruction)}.${secondaryText}`;
    }

    return {
      title: `${cornerLabel ?? "Reta / transição"} • ${start}%–${end}%${trackLength ? ` • ${(start / 100 * trackLength).toFixed(0)}–${(end / 100 * trackLength).toFixed(0)} m` : ""}`,
      detail: `Você perde cerca de ${tenths.toFixed(1)} décimos aqui. ${narrative}`,
      gain: item.gain,
      metrics: [`Δ velocidade ${item.speedGap >= 0 ? "+" : ""}${item.speedGap.toFixed(1)} km/h`, `Δ acelerador ${(item.throttleGap * 100).toFixed(0)} p.p.`, `Δ freio ${(item.brakeGap * 100).toFixed(0)} p.p.`],
      start,
      end,
      kind,
      cornerNumber: corner?.number ?? null,
      cornerLabel,
      primaryType,
    };
  }).sort((a, b) => a.start - b.start);
  const avgAbs = (field: ChannelKey, source: Trace) => source.points.reduce((sum, point) => sum + Math.abs(point[field] ?? 0), 0) / source.points.length;
  const channelInsights = [
    `Volante: média absoluta ${(avgAbs("steering", own) * 180 / Math.PI).toFixed(1)}° contra ${(avgAbs("steering", reference) * 180 / Math.PI).toFixed(1)}° na referência.`,
    `RPM: média ${avgAbs("rpm", own).toFixed(0)} contra ${avgAbs("rpm", reference).toFixed(0)}; diferenças podem indicar marcha ou ponto de troca distintos.`,
    `Inputs: acelerador médio ${(avgAbs("throttle", own) * 100).toFixed(0)}% e freio médio ${(avgAbs("brake", own) * 100).toFixed(0)}%, contra ${(avgAbs("throttle", reference) * 100).toFixed(0)}% / ${(avgAbs("brake", reference) * 100).toFixed(0)}%.`,
    ...(reference.channels.some((channel) => /PushToPass|P2P_/i.test(channel))
      ? [`Push-to-pass: a referência IBT contém os canais de acionamento, estado e contagem. Use o tooltip para separar ganho de potência de ganho de pilotagem.`]
      : []),
  ];
  // Full-lap line-distance series (Garage61's own "line distance" chart) -- the same signed lateral
  // metric already used for the per-opportunity insight text above, just exposed point-by-point
  // instead of averaged into 5% buckets, so it can be drawn as an actual chart instead of only read
  // as a sentence. This is the honest, data-backed way to show "how far apart the two lines are" —
  // the track map's ribbon can't (see TrackMap's own comments on why).
  const lineDistance = samples.filter((item) => item.lateral !== undefined).map((item) => ({ distance: Number(item.distance), meters: Number(item.lateral) }));
  return { estimatedReferenceTime, estimatedGap: ownLapTime - estimatedReferenceTime, averageSpeedDifference, opportunities, channelInsights, lineDistance };
}

function nearestGpsPoint(points: TracePoint[], distance: number) {
  let best: TracePoint | null = null, bestDelta = Infinity;
  for (const point of points) {
    const delta = Math.min(Math.abs(point.distance - distance), 100 - Math.abs(point.distance - distance));
    if (delta < bestDelta) { bestDelta = delta; best = point; }
  }
  return best;
}

/** Linear-interpolates the signed lateral offset (meters) at an arbitrary distance from the
 * compareTraces-computed series (see compareTraces' own comment for the sign convention). */
function interpolateLineDistance(lineDistance: { distance: number; meters: number }[], distance: number) {
  if (!lineDistance.length) return null;
  let prev = lineDistance[0], next = lineDistance[lineDistance.length - 1];
  for (const point of lineDistance) {
    if (point.distance >= distance) { next = point; break; }
    prev = point;
  }
  const span = next.distance - prev.distance;
  const ratio = span > 0 ? (distance - prev.distance) / span : 0;
  return prev.meters + (next.meters - prev.meters) * ratio;
}

/** Reconstructs where the reference car was, in lat/lon, from YOUR own GPS point plus the already
 * -computed lateral offset at that same distance — the exact inverse of the math compareTraces used
 * to derive that offset in the first place. This is used instead of the reference's raw GPS trace
 * for the ON-MAP line: raw GPS noise (this environment has no way to compare against Garage61's own
 * likely-smoothed/filtered internal telemetry) was swallowing real, small divergence at map scale,
 * while the offset series itself is already a clean, meter-accurate, non-noisy signal. */
function offsetGpsPoint(prevLat: number, prevLon: number, curLat: number, curLon: number, nextLat: number, nextLon: number, offsetMeters: number) {
  const latRad = (prevLat + nextLat) / 2 * Math.PI / 180;
  const tx = (nextLon - prevLon) * 111320 * Math.cos(latRad);
  const ty = (nextLat - prevLat) * 110540;
  const tlen = Math.hypot(tx, ty) || 1;
  const ux = tx / tlen, uy = ty / tlen;
  // Perpendicular consistent with compareTraces' `lateral = ux*ry - uy*rx`: solving for the
  // perpendicular unit vector p such that ux*p.y - uy*p.x = 1 gives p = (-uy, ux).
  const dxMeters = -uy * offsetMeters, dyMeters = ux * offsetMeters;
  return { lat: curLat + dyMeters / 110540, lon: curLon + dxMeters / (111320 * Math.cos(latRad)) };
}

function TrackMap({ trace, referenceTrace, range, hoverDistance, zoom, lineDistance, trackId, focusRequest }: { trace: Trace; referenceTrace?: Trace | null; range: [number, number] | null; hoverDistance?: number | null; zoom?: boolean; lineDistance?: { distance: number; meters: number }[]; trackId?: number | null; focusRequest?: { distance: number; nonce: number } | null }) {
  // Own zoom state per map instance (sticky map, hover panel map, and popup map each zoom
  // independently) -- must be declared before the early return below, ahead of any other hook.
  // zoomCenter is in viewBox units (0-300, 0-200): where the zoom is anchored. Garage61 lets you
  // zoom into any part of the track, not just the center -- clicking the map moves this anchor to
  // that point before zooming, instead of always scaling around the fixed (150,100) middle.
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomCenter, setZoomCenter] = useState({ x: 150, y: 100 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Tracks the last focusRequest.nonce actually applied, so the render-time zoomCenter/zoomLevel
  // adjustment below (see its own comment) fires once per click on the input chart, not every render.
  const appliedFocusNonce = useRef<number | null>(null);
  // Scroll-to-zoom-at-cursor (31/08/2026: "quando o mouse estiver em cima do mapa, eu possa usar o
  // scroll para aproximar em um trecho específico") -- React's onWheel is passive by default, so
  // preventDefault() inside it is silently ignored (and warns); a native listener with passive:false
  // is the only way to actually stop the page from scrolling while zooming the map under the cursor.
  // Only wired for the full/manual-zoom map (zoom prop falsy), same gate as click-to-recenter below --
  // the hover-panel and popup maps already auto-fit their own narrow window.
  useEffect(() => {
    if (zoom) return;
    const svg = svgRef.current;
    if (!svg) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const ctm = svg!.getScreenCTM();
      if (!ctm) return;
      const point = svg!.createSVGPoint();
      point.x = event.clientX; point.y = event.clientY;
      const local = point.matrixTransform(ctm.inverse());
      setZoomCenter({ x: local.x, y: local.y });
      const factor = event.deltaY < 0 ? 1.25 : 1 / 1.25;
      setZoomLevel((level) => {
        const next = Math.max(1, Math.min(6, level * factor));
        if (next === 1) setZoomCenter({ x: 150, y: 100 });
        return next;
      });
    }
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [zoom]);
  // Fetched once per trackId (see lib/track-boundaries.ts for why this is a runtime fetch, not a
  // bundled import) and shared across all three TrackMap instances on the page via that module's own
  // cache -- only the first one triggers a network request, the rest resolve from the same promise.
  const [boundary, setBoundary] = useState<TrackBoundary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBoundary(null);
    getTrackBoundary(trackId).then((result) => { if (!cancelled) setBoundary(result); });
    return () => { cancelled = true; };
  }, [trackId]);
  const gps = trace.points.filter((point) => point.lat !== null && point.lon !== null);
  if (gps.length < 20) return <div className="track-map-empty">Mapa GPS indisponível nesta volta.</div>;
  const rawRefGps = referenceTrace ? referenceTrace.points.filter((point) => point.lat !== null && point.lon !== null) : [];
  // Reconstructed (own point + the already-computed lateral offset) instead of the reference's raw
  // GPS trace, when available — see offsetGpsPoint's comment for why. Falls back to raw GPS when no
  // lineDistance was passed in (e.g. no reference loaded at all yet).
  const refGps: TracePoint[] = lineDistance && lineDistance.length > 10 && rawRefGps.length
    ? gps.map((point, index) => {
      const prevPoint = gps[Math.max(0, index - 1)], nextPoint = gps[Math.min(gps.length - 1, index + 1)];
      const offsetMeters = interpolateLineDistance(lineDistance, point.distance);
      if (offsetMeters === null || prevPoint.lat === null || nextPoint.lat === null || point.lat === null) return null;
      const reconstructed = offsetGpsPoint(Number(prevPoint.lat), Number(prevPoint.lon), Number(point.lat), Number(point.lon), Number(nextPoint.lat), Number(nextPoint.lon), offsetMeters);
      return { ...point, lat: reconstructed.lat, lon: reconstructed.lon } as TracePoint;
    }).filter((point): point is TracePoint => point !== null)
    : rawRefGps;
  // Keep the map window slightly wider than the input window: a hover must always have visible
  // approach and exit context on the linked trajectory.
  const mapRange = range ? [Math.max(0, range[0] - 3), Math.min(100, range[1] + 3)] as [number, number] : null;
  const selected = mapRange ? gps.filter((point) => point.distance >= mapRange[0] && point.distance <= mapRange[1]) : [];
  const refSelected = mapRange && refGps.length ? refGps.filter((point) => point.distance >= mapRange[0] && point.distance <= mapRange[1]) : [];

  // Real track-edge geometry (OSM `highway=raceway`, see lib/track-boundaries.ts) when we have it for
  // this track -- replaces the old synthetic ribbon, which was just a thick stroke drawn around
  // whichever GPS trace was being compared. That construction could never show real track position:
  // with two similar-pace drivers' lines nearly coincident, the "ribbon" was in effect just a tube
  // around one path, so both lines always looked centered in it no matter where they really were on
  // the physical track. A real boundary gives the thin lines something true to sit inside.
  const boundaryPoints = boundary ? boundary.segments.flatMap((segment) => segment.pts.map(([lat, lon]) => ({ lat, lon }))) : [];

  let boundsPoints = gps;
  if (zoom && (selected.length >= 2 || refSelected.length >= 2)) {
    boundsPoints = [...selected, ...refSelected];
  } else if (zoom && range) {
    const center = (range[0] + range[1]) / 2;
    boundsPoints = [...gps, ...refGps].sort((a, b) => Math.abs(a.distance - center) - Math.abs(b.distance - center)).slice(0, 16);
  } else if (!zoom && boundaryPoints.length) {
    // Full-track view: fit the REAL track outline, not just wherever this one lap happened to drive --
    // a lap that cuts a corner or misses part of the track shouldn't shrink/skew the whole map.
    boundsPoints = boundaryPoints.map((point) => ({ distance: 0, lat: point.lat, lon: point.lon } as TracePoint));
  }
  // Never stretch X and Y independently: it made real corners look physically impossible.
  const projectGps = createTrackProjector(boundsPoints.map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) })), 300, 200, 18, false);
  const project = (point: TracePoint) => projectGps({ lat: Number(point.lat), lon: Number(point.lon) });
  // In the hover card, render only the local section. Drawing the entire lap against local bounds
  // compressed the useful traces into an unreadable line at the edge of the map.
  const mapGps = zoom && selected.length >= 2 ? selected : gps;
  const mapReference = zoom && refSelected.length >= 2 ? refSelected : refGps;
  // 12m is a plain approximation (typical road-circuit width) used only when there's no real
  // boundary for this track -- calibrating it in real meters at least makes the synthetic ribbon's
  // width and the own/reference lines' real GPS separation share one consistent scale. Clamped so it
  // stays legible at both a full-lap zoomed-out view and a single-corner close-up.
  const trackWidthPx = Math.max(6, Math.min(40, projectGps.metersToPixels(12)));
  const hoverOwn = hoverDistance !== null && hoverDistance !== undefined ? nearestGpsPoint(gps, hoverDistance) : null;
  const hoverRef = hoverDistance !== null && hoverDistance !== undefined && refGps.length ? nearestGpsPoint(refGps, hoverDistance) : null;
  // Click-on-input-chart-to-zoom-the-map (31/08/2026: "eu possa clicar nos gráficos de inputs em uma
  // seção específica e o mapa dá zoom naquela região") -- adjusting state during render, guarded by
  // the nonce ref above, is React's own supported pattern for "derive state from a prop that just
  // changed" without an extra effect/render round-trip. project() is only available here (after the
  // early-return above), which is why this can't live in the wheel-zoom useEffect near the top.
  if (!zoom && focusRequest && focusRequest.nonce !== appliedFocusNonce.current) {
    appliedFocusNonce.current = focusRequest.nonce;
    const target = nearestGpsPoint(gps, focusRequest.distance);
    if (target) {
      const [x, y] = project(target).split(",").map(Number);
      setZoomCenter({ x, y });
      setZoomLevel(3);
    }
  }
  return <div className="track-map-zoom-wrap">
    <svg ref={svgRef} className="track-map" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa GPS da pista com o traçado da sua volta e da referência no trecho selecionado"
      onClick={!zoom ? (event) => {
        // Click-to-recenter: like Garage61, zoom anchors wherever you click, not just the map's
        // fixed center. getScreenCTM().inverse() converts the click's screen position into viewBox
        // units correctly regardless of how the SVG is scaled/letterboxed on the page.
        const svg = event.currentTarget;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const point = svg.createSVGPoint();
        point.x = event.clientX; point.y = event.clientY;
        const local = point.matrixTransform(ctm.inverse());
        setZoomCenter({ x: local.x, y: local.y });
        setZoomLevel((level) => (level === 1 ? 2 : level));
      } : undefined}>
      {/* Zoom, like Garage61's own map, lets you anchor anywhere on the track (click to recenter),
       * not just the fixed middle — no new bounds are computed, it just magnifies/clips the same
       * projected points around wherever zoomCenter currently is. */}
      <g style={{ transform: `translate(${zoomCenter.x}px,${zoomCenter.y}px) scale(${zoomLevel}) translate(${-zoomCenter.x}px,${-zoomCenter.y}px)` }}>
        {/* Real track edges (OSM) when we have them for this track — each way segment drawn separately
         * at its own real-meters width; see lib/track-boundaries.ts for why they're deliberately not
         * stitched into one ordered polyline. Falls back to the old synthetic per-lap ribbon (thick
         * stroke drawn around whichever GPS trace is on screen) for a track we haven't sourced yet. */}
        {boundary
          ? boundary.segments.map((segment, index) => (
            <polyline key={index} points={segment.pts.map(([lat, lon]) => project({ lat, lon } as unknown as TracePoint)).join(" ")} className="track-outline" style={{ strokeWidth: Math.max(2, projectGps.metersToPixels(segment.width)) }} />
          ))
          : <>
            <polyline points={mapGps.map(project).join(" ")} className="track-outline" style={{ strokeWidth: trackWidthPx }} />
            {mapReference.length > 1 && <polyline points={mapReference.map(project).join(" ")} className="track-outline" style={{ strokeWidth: trackWidthPx }} />}
          </>}
        <polyline points={mapGps.map(project).join(" ")} className="track-own-line" />
        {mapReference.length > 1 && <polyline points={mapReference.map(project).join(" ")} className="track-reference" />}
        {/* r and strokeWidth divided by zoomLevel (31/08/2026: "a bolinha está muito grande") --
         * these circles sit inside the same scaled <g> as everything else, so without this they
         * visually balloon in lockstep with the zoom (a r=5 marker at zoomLevel=6 renders 6x too
         * big on screen); dividing by zoomLevel keeps their SCREEN size constant at any zoom. */}
        {!hoverOwn && selected[0] && <circle cx={project(selected[0]).split(",")[0]} cy={project(selected[0]).split(",")[1]} r={3 / zoomLevel} style={{ strokeWidth: 3 / zoomLevel }} className="track-marker" />}
        {hoverRef && <circle cx={project(hoverRef).split(",")[0]} cy={project(hoverRef).split(",")[1]} r={3.5 / zoomLevel} style={{ strokeWidth: 3 / zoomLevel }} className="track-marker-ref" />}
        {hoverOwn && <circle cx={project(hoverOwn).split(",")[0]} cy={project(hoverOwn).split(",")[1]} r={3.5 / zoomLevel} style={{ strokeWidth: 3 / zoomLevel }} className="track-marker" />}
      </g>
    </svg>
    {/* Manual zoom only makes sense on the FULL-track map (zoom prop falsy). The hover-panel and
     * insight-popup maps already auto-fit to a narrow local window — adding +/- there on top of
     * that auto-zoom was redundant and, worse, ate into their already-small footprint. */}
    {!zoom && (
      <div className="track-map-zoom-controls">
        <button type="button" onClick={(event) => { event.stopPropagation(); setZoomLevel((level) => Math.min(6, level * 1.5)); }} aria-label="Aproximar mapa">+</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); setZoomLevel((level) => { const next = Math.max(1, level / 1.5); if (next === 1) setZoomCenter({ x: 150, y: 100 }); return next; }); }} aria-label="Afastar mapa">–</button>
      </div>
    )}
  </div>;
}

// The own/reference gauge+chart widget below (SteeringWheel/GearCluster/FocusedChart) was replaced
// 31/08/2026 by the shared components/FocusedGaugeChart.tsx ("Eu quero, inclusive, que use o mesmo
// objeto" -- one widget now, matching CarComparison.tsx's own popup exactly instead of two
// independently-drifting near-copies). See that file's own top comment for the column order/coloring
// this now follows.

export default function ActiveWeekTelemetry() {
  const [data, setData] = useState<ActiveWeekData | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [traceLoading, setTraceLoading] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [referenceTrace, setReferenceTrace] = useState<Trace | null>(null);
  const [uploading, setUploading] = useState(false);
  const [referenceMessage, setReferenceMessage] = useState<string | null>(null);
  const [hoveredDistance, setHoveredDistance] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
  const [focusedInsight, setFocusedInsight] = useState<Comparison["opportunities"][number] | null>(null);
  const [popupHoverDistance, setPopupHoverDistance] = useState<number | null>(null);
  // Click-on-input-chart-to-zoom-the-sticky-map (31/08/2026): a nonce alongside the distance so
  // clicking the exact same spot twice in a row still re-triggers TrackMap's focus effect.
  const [chartFocus, setChartFocus] = useState<{ distance: number; nonce: number } | null>(null);
  const insightsRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (insightsRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setFocusedInsight(null);
      setSelectedRange(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // Esc closes the insight popup — the only way out was previously a mouse click on the ✕ or
  // outside the card, which stalls a keyboard-driven flow entirely.
  useEffect(() => {
    setPopupHoverDistance(null);
    if (!focusedInsight) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setFocusedInsight(null); setSelectedRange(null); }
    }
    document.addEventListener("keydown", handleKeyDown);
    popupRef.current?.querySelector<HTMLButtonElement>(".insight-popup-close")?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedInsight]);

  const [retryCount, setRetryCount] = useState(0);
  const retry = () => setRetryCount((count) => count + 1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/telemetry/active-week", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Erro ao carregar telemetria");
        if (!active) return;
        setData(result);
        setSelectedKey(result.combinations?.[0]?.key ?? "");
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  const selected = useMemo(() => data?.combinations.find((item) => item.key === selectedKey) ?? null, [data, selectedKey]);

  useEffect(() => {
    let active = true;
    setTrace(null);
    setError(null);
    setSelectedRange(null);
    if (!selected?.bestLap) return () => { active = false; };
    setTraceLoading(true);
    fetch(selected.bestLap.telemetryUrl, { cache: "no-store" })
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) throw new Error("Não foi possível baixar a telemetria da melhor volta");
        if (active) setTrace(parseTelemetryCsv(text));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setTraceLoading(false));
    return () => { active = false; };
  }, [selected, retryCount]);

  useEffect(() => {
    let active = true;
    setReference(null);
    setReferenceTrace(null);
    setReferenceMessage(null);
    if (!selected) return () => { active = false; };
    fetch(`/api/telemetry/reference?carId=${selected.car.id}&trackId=${selected.track.id}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Erro ao carregar referência");
        if (active && result.reference) {
          const parsed = parseTelemetryCsv(result.reference.csv);
          if (/super formula sf23/i.test(selected.car.name) && traceUsesOvertake(parsed)) throw new Error("A referência ativa usa P2P/Overtake. Envie ou mantenha uma volta sem esse recurso.");
          setReference(result.reference);
          setReferenceTrace(parsed);
        }
      })
      .catch((reason) => active && setReferenceMessage(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [selected]);

  const corners = useMemo(() => trace && selected ? detectCorners(trace.points, selected.track.name, selected.track.variant ?? "") : [], [trace, selected]);

  const comparison = useMemo(() => {
    if (!trace || !referenceTrace || !selected?.bestLap) return null;
    return compareTraces(trace, referenceTrace, selected.bestLap.lapTime, corners);
  }, [trace, referenceTrace, selected, corners]);

  async function uploadReference(file: File) {
    if (!selected) return;
    setUploading(true);
    setReferenceMessage("Validando e armazenando referência...");
    try {
      let uploadFile = file;
      if (file.name.toLowerCase().endsWith(".ibt")) {
        setReferenceMessage("Lendo o IBT localmente e procurando a volta completa mais rápida...");
        const converted = ibtToBestLapCsv(await file.arrayBuffer());
        const name = `${file.name.replace(/\.ibt$/i, "")}-best-lap.csv`;
        uploadFile = new File([converted.csv], name, { type: "text/csv" });
        setReferenceMessage(`Volta de ${formatLapTime(converted.duration)} extraída com ${converted.samples.toLocaleString("pt-BR")} amostras. Enviando referência normalizada...`);
      }
      const parsedUpload = parseTelemetryCsv(await uploadFile.text());
      if (/super formula sf23/i.test(selected.car.name) && traceUsesOvertake(parsedUpload)) throw new Error("A referência usa P2P/Overtake. Escolha uma volta sem esse recurso.");
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("carId", String(selected.car.id));
      form.set("trackId", String(selected.track.id));
      const response = await fetch("/api/telemetry/reference", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro no upload da referência");
      const parsedReference = parseTelemetryCsv(result.reference.csv);
      if (/super formula sf23/i.test(selected.car.name) && traceUsesOvertake(parsedReference)) throw new Error("A referência armazenada usa P2P/Overtake. Escolha uma volta sem esse recurso.");
      setReference(result.reference);
      setReferenceTrace(parsedReference);
      setReferenceMessage("Referência ativa atualizada.");
    } catch (reason) {
      setReferenceMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel telemetry-panel">
      <div className="telemetry-heading">
        <div>
          <span className="section-kicker">ACTIVE WEEK TELEMETRY</span>
          <h2>Telemetria da semana ativa</h2>
          <p>{data?.week ? `${data.week.seasonName} • Week ${data.week.number}` : "Atividade da semana vigente"}</p>
        </div>
        {data && data.combinations.length > 0 && (
          <label className="telemetry-selector">
            <span>CARRO — PISTA</span>
            <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} disabled={data.combinations.length === 1}>
              {data.combinations.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
            </select>
          </label>
        )}
      </div>

      {loading && <div className="telemetry-state">Identificando carro e pista da semana...</div>}
      {!loading && error && !selected && <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={retry}>Tentar novamente</button></div>}
      {!loading && !error && !data?.combinations.length && <div className="telemetry-state">Nenhuma atividade encontrada na semana vigente.</div>}
      {selected && (
        <div className="telemetry-content">
          <div className="telemetry-meta">
            <div><span>{selected.bestLap?.selectionReason === "race_best_lap" || selected.bestLap?.selectionReason === "race_best_lap_without_p2p" ? "MELHOR VOLTA DE CORRIDA" : selected.bestLap?.selectionReason === "practice_best_lap" ? "MELHOR VOLTA DE PRACTICE" : "MELHOR VOLTA LIMPA"}</span><strong>{selected.bestLap ? formatLapTime(selected.bestLap.lapTime) : "Indisponível"}</strong></div>
            <div><span>ATIVIDADE</span><strong>{selected.sessions} sessões • {selected.lapsFound} voltas</strong></div>
            <div><span>FONTE</span><strong>{selected.bestLap?.selectionReason === "race_best_lap_without_p2p" ? "Garage61 • corrida sem P2P" : selected.bestLap?.selectionReason === "race_best_lap" ? "Garage61 • corrida" : selected.bestLap?.selectionReason === "practice_best_lap" ? "Garage61 • practice, pois ainda não há corrida" : "Garage61 • pré-carregada"}</strong></div>
          </div>
          <div className="reference-bar">
            <div>
              <span className="section-kicker">REFERENCE LAP</span>
              <strong>{reference ? reference.filename : "Nenhuma referência ativa"}</strong>
              <p>{reference ? `Salva em ${new Date(reference.uploadedAt).toLocaleString("pt-BR")}` : "Envie um CSV ou IBT do iRacing para este carro e pista."}</p>
            </div>
            <label className={`reference-upload ${uploading ? "disabled" : ""}`}>
              {uploading ? "Enviando..." : reference ? "Substituir referência" : "Enviar telemetria de referência"}
              <input type="file" accept=".csv,.ibt,text/csv,application/octet-stream" disabled={uploading} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadReference(file);
                event.target.value = "";
              }} />
            </label>
          </div>
          {referenceMessage && <div className="reference-message">{referenceMessage}</div>}
          {traceLoading && <div className="telemetry-state">Pré-carregando canais do Garage61...</div>}
          {error && <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={retry}>Tentar novamente</button></div>}
          {!traceLoading && !error && !selected.bestLap && <div className="telemetry-state">Ainda não há uma volta limpa com telemetria disponível para esta combinação.</div>}
          {referenceTrace && !comparison && <div className="telemetry-state error">Não foi possível alinhar amostras suficientes entre as duas voltas.</div>}
          {comparison && trace && (
            <div className="comparison-section insights-first">
              <div className="comparison-summary">
                <div><span>REFERÊNCIA ESTIMADA</span><strong>{formatLapTime(comparison.estimatedReferenceTime)}</strong></div>
                <div><span>GAP ESTIMADO</span><strong className={comparison.estimatedGap > 0 ? "negative" : "positive"}>{comparison.estimatedGap > 0 ? "+" : ""}{comparison.estimatedGap.toFixed(3)}s</strong></div>
                <div><span>Δ VELOCIDADE MÉDIA</span><strong>{comparison.averageSpeedDifference >= 0 ? "+" : ""}{(comparison.averageSpeedDifference * 3.6).toFixed(1)} km/h</strong></div>
              </div>
              {/* No standalone chart here by design: this same lateral-offset data (comparison.lineDistance)
               * is instead used to draw the actual track-usage divergence directly on the map (see
               * TrackMap below) and to drive the per-corner "line" insight above -- the number itself
               * isn't the point, where it puts you on track is. */}
              <div className="insights-heading"><span className="section-kicker">MAIORES OPORTUNIDADES</span><h3>Onde você perde tempo e o que fazer</h3><p>As curvas são numeradas na ordem em que aparecem na volta. Quando eu sei o nome real da curva, uso ele; quando não sei, mostro só o número.</p></div>
                  <div className="insights-grid" ref={insightsRef}>{comparison.opportunities.length ? comparison.opportunities.map((item) => (
                    <button type="button" className={selectedRange?.[0] === item.start ? "active" : ""} onClick={() => { setSelectedRange([item.start, item.end]); setHoveredDistance(null); setFocusedInsight(item); }} key={item.title}>
                      <strong>{item.title}</strong><span>até {item.gain.toFixed(3)}s estimados</span><p>{item.detail}</p><ul>{item.metrics.map((metric) => <li key={metric}>{metric}</li>)}</ul>
                    </button>
                  )) : <p className="comparison-note">A volta própria não apresentou perdas materiais nos segmentos analisados.</p>}</div>
              <div className="channel-report"><h3>Relatório de inputs</h3>{comparison.channelInsights.map((insight) => <p key={insight}>{insight}</p>)}</div>
              <p className="comparison-note">Tempos e ganhos são estimados pela integração de velocidade normalizada por distância. Confirme cada hipótese nos traços; combustível, setup, clima e aderência podem explicar diferenças.</p>
            </div>
          )}
          {trace && (
            <div className="telemetry-chart-wrap">
              <div className="telemetry-legend"><span className="own-lap">Sua volta — linha contínua</span>{referenceTrace && <span className="reference">Referência — tracejada</span>}</div>
              <div className="channel-key"><span className="speed">Velocidade</span><span className="throttle">Acelerador</span><span className="brake">Freio</span><span className="steering">Volante</span><span className="rpm">RPM</span><span className="gear">Marcha</span><span className="clutch">Embreagem</span><span className="dynamics">Dinâmica</span></div>
              <div className="telemetry-workspace">
              {/* Persistent, full-track map (like Garage61's own analysis view): always the whole
               * lap, own+reference lines at their real GPS positions, manual zoom/pan instead of
               * auto-narrowing on hover — the hover-panel's own small map (below) already covers
               * the "zoom to where I'm hovering" job, so this one's job is the overview. */}
              <aside className="telemetry-map-sticky"><span className="section-kicker">TRACK POSITION</span><h3>{selected?.track.name}</h3><TrackMap trace={trace} referenceTrace={referenceTrace} trackId={selected?.track.id} range={null} hoverDistance={hoveredDistance} lineDistance={comparison?.lineDistance} focusRequest={chartFocus} />{referenceTrace && <p className="track-map-legend"><span className="own">Sua volta</span><span className="reference">Referência</span></p>}<p>Passe o mouse nos inputs para localizar o ponto no mapa, clique para dar zoom ali, ou role o mouse sobre o mapa para aproximar/afastar.</p></aside>
              <div className="interactive-chart">
              <svg className="telemetry-chart" viewBox="0 0 1000 960" role="img" tabIndex={0}
                aria-label="Canais sincronizados das duas voltas por distância da pista. Use as setas esquerda/direita para percorrer a pista, Shift+seta para passos maiores."
                onMouseLeave={() => setHoveredDistance(null)} onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoveredDistance(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)));
                }}
                // Click a specific point in the input graphs to zoom the sticky map there (31/08/2026:
                // "eu possa clicar nos gráficos de inputs em uma seção específica e o mapa dá zoom
                // naquela região") -- same %-of-lap math as the hover handler above, just committed on
                // click instead of tracked continuously.
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const distance = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
                  setChartFocus({ distance, nonce: Date.now() });
                }}
                // Tap only (no touchmove/touch-action:none) here on purpose: this chart is forced
                // wide on mobile (min-width below) specifically so its ten stacked channels stay
                // readable instead of squished, which means it needs native horizontal SCROLL to
                // work on a narrow screen -- capturing drag for scrubbing would break that. A tap
                // still sets the hover position; dragging pans the chart like anywhere else.
                onTouchStart={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoveredDistance(Math.max(0, Math.min(100, (event.touches[0].clientX - rect.left) / rect.width * 100)));
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 5 : 0.5;
                  if (event.key === "ArrowRight") { event.preventDefault(); setHoveredDistance((prev) => Math.min(100, (prev ?? 0) + step)); }
                  else if (event.key === "ArrowLeft") { event.preventDefault(); setHoveredDistance((prev) => Math.max(0, (prev ?? 0) - step)); }
                  else if (event.key === "Home") { event.preventDefault(); setHoveredDistance(0); }
                  else if (event.key === "End") { event.preventDefault(); setHoveredDistance(100); }
                }}>
                {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1={value * 10} x2={value * 10} y1="0" y2="925" className="telemetry-grid" /><text x={value * 10} y="954" textAnchor={value === 0 ? "start" : value === 100 ? "end" : "middle"}>{value}%</text></g>)}
                {corners.map((corner) => <g key={corner.number}><line x1={corner.distance * 10} x2={corner.distance * 10} y1="0" y2="925" className="corner-marker-line" /><text x={corner.distance * 10} y="10" textAnchor="middle" className="corner-marker-label">{corner.name ? corner.name.slice(0, 12) : `C${corner.number}`}</text></g>)}
                {([{"field":"speed","top":10,"height":140},{"field":"throttle","top":175,"height":65},{"field":"brake","top":265,"height":65},{"field":"steering","top":355,"height":65},{"field":"rpm","top":445,"height":65},{"field":"gear","top":535,"height":35},{"field":"clutch","top":595,"height":55},{"field":"latAccel","top":685,"height":55},{"field":"longAccel","top":775,"height":55},{"field":"yawRate","top":865,"height":55}] as {field:ChannelKey;top:number;height:number}[]).map((row) => <g key={row.field}>
                  <text x="8" y={row.top + 12} className="channel-label">{row.field === "speed" ? "SPEED" : row.field === "throttle" ? "THROTTLE" : row.field === "brake" ? "BRAKE" : row.field === "steering" ? "STEERING" : row.field.toUpperCase()}</text>
                  <polyline points={polyline(trace.points, row.field, row.top, row.height, referenceTrace ? [...trace.points, ...referenceTrace.points] : trace.points)} className={`trace-${row.field}`} />
                  {referenceTrace && <polyline points={polyline(referenceTrace.points, row.field, row.top, row.height, [...trace.points, ...referenceTrace.points])} className={`trace-${row.field} reference-line`} />}
                </g>)}
                {selectedRange && <rect x={selectedRange[0] * 10} y="0" width={(selectedRange[1] - selectedRange[0]) * 10} height="925" className="selected-segment" />}
                {hoveredDistance !== null && <line x1={hoveredDistance * 10} x2={hoveredDistance * 10} y1="0" y2="925" className="hover-line" />}
              </svg>
              </div>
              <aside className="telemetry-hover-panel">
                {hoveredDistance !== null ? (() => {
                  const own = (field: ChannelKey) => interpolate(trace.points, hoveredDistance, field);
                  const ref = (field: ChannelKey) => referenceTrace ? interpolate(referenceTrace.points, hoveredDistance, field) : null;
                  const format = (field: ChannelKey, value: number | null) => value === null ? "—" : field === "speed" ? `${(value * 3.6).toFixed(1)} km/h` : field === "steering" ? `${(value * 180 / Math.PI).toFixed(1)}°` : field === "rpm" ? `${value.toFixed(0)}` : field === "gear" || field === "p2pCount" || field === "p2pStatus" ? `${Math.round(value)}` : field === "pushToPass" ? (value ? "ATIVO" : "inativo") : field === "latAccel" || field === "longAccel" ? `${value.toFixed(2)} m/s²` : field === "yawRate" ? `${value.toFixed(3)} rad/s` : `${(value * 100).toFixed(0)}%`;
                  const visible = (["speed","throttle","brake","steering","rpm","gear","clutch","latAccel","longAccel","yawRate","pushToPass","p2pStatus","p2pCount"] as ChannelKey[]).filter((field) => own(field) !== null || ref(field) !== null);
                  return <div className="telemetry-hover">
                    <strong>{hoveredDistance.toFixed(1)}% {trace.trackLengthMeters ? `• ${(hoveredDistance / 100 * trace.trackLengthMeters).toFixed(0)} m` : ""}</strong>
                    {/* The sticky full-track map above (telemetry-map-sticky) already tracks this same
                     * hoveredDistance and is bigger/easier to read, so this hover panel's own small map
                     * is redundant now -- removed 29/08/2026 per "Agora que tem o mapa maior, não precisa
                     * desse minimapa aqui, deixe só os valores dos inputs". */}
                    {visible.map((field) => <div key={field}><span>{field}</span><b>{format(field, own(field))}</b><em>{format(field, ref(field))}</em></div>)}
                  </div>;
                })() : <p className="telemetry-hover-empty">Passe o mouse sobre os gráficos para ver os valores exatos deste ponto da pista.</p>}
              </aside>
              </div>
              <p className="telemetry-caption">{trace.points.length.toLocaleString("pt-BR")} amostras exibidas • volta de {new Date(selected.bestLap!.startTime).toLocaleString("pt-BR")}</p>
            </div>
          )}
          {focusedInsight && trace && (
            <div className="insight-popup-backdrop">
              <div className="insight-popup" ref={popupRef}>
                <div className="insight-popup-head">
                  <div>
                    <span className="section-kicker">{focusedInsight.kind === "corner" ? (focusedInsight.cornerLabel ?? `CURVA ${focusedInsight.cornerNumber}`).toUpperCase() : "TRECHO"}</span>
                    <h3>{focusedInsight.title}</h3>
                  </div>
                  <button type="button" className="insight-popup-close" onClick={() => { setFocusedInsight(null); setSelectedRange(null); }}>Fechar ✕</button>
                </div>
                <p className="insight-popup-detail">{focusedInsight.detail}</p>
                {(() => {
                  // Same +-3% padding the map already used around the focused range, so the chart's
                  // own approach/exit context matches what the map shows either side of the corner.
                  const from = Math.max(0, focusedInsight.start - 3), to = Math.min(100, focusedInsight.end + 3);
                  const ownPts = trace.points.filter((point) => point.distance >= from && point.distance <= to);
                  const refPts = referenceTrace ? referenceTrace.points.filter((point) => point.distance >= from && point.distance <= to) : [];
                  const toSeries = (points: TracePoint[], field: "throttle" | "brake") => points
                    .filter((point) => point[field] !== null && Number.isFinite(point[field]))
                    .map((point) => ({ x: point.distance, value: Number(point[field]) }));
                  const wheelDistance = popupHoverDistance ?? (focusedInsight.start + focusedInsight.end) / 2;
                  const sides: FocusedSide[] = [{
                    key: "own", label: "VOCÊ", color: "var(--red)", dashed: false,
                    throttle: toSeries(ownPts, "throttle"), brake: toSeries(ownPts, "brake"),
                    angleRad: interpolate(ownPts, wheelDistance, "steering"),
                    gear: interpolate(ownPts, wheelDistance, "gear"),
                    speedMs: interpolate(ownPts, wheelDistance, "speed"),
                    throttleNow: interpolate(ownPts, wheelDistance, "throttle"),
                    brakeNow: interpolate(ownPts, wheelDistance, "brake"),
                  }];
                  if (referenceTrace) sides.push({
                    key: "reference", label: "REFERÊNCIA", color: "var(--blue)", dashed: true,
                    throttle: toSeries(refPts, "throttle"), brake: toSeries(refPts, "brake"),
                    angleRad: interpolate(refPts, wheelDistance, "steering"),
                    gear: interpolate(refPts, wheelDistance, "gear"),
                    speedMs: interpolate(refPts, wheelDistance, "speed"),
                    throttleNow: interpolate(refPts, wheelDistance, "throttle"),
                    brakeNow: interpolate(refPts, wheelDistance, "brake"),
                  });
                  return (
                    <div className="insight-popup-body">
                      <FocusedGaugeChart sides={sides} xDomain={[from, to]} hoverX={popupHoverDistance} onHoverX={setPopupHoverDistance}
                        ariaLabel="Freio, acelerador, marcha, velocidade e volante da sua volta e da referência nesse trecho; passe o mouse ou arraste o dedo para ver a posição no mapa abaixo" />
                      <div className="insight-popup-map">
                        <span className="section-kicker">TRAÇADO</span>
                        <TrackMap trace={trace} referenceTrace={referenceTrace} trackId={selected?.track.id} range={[focusedInsight.start, focusedInsight.end]} hoverDistance={popupHoverDistance} zoom lineDistance={comparison?.lineDistance} />
                        {referenceTrace && <p className="track-map-legend"><span className="own">Sua volta</span><span className="reference">Referência</span></p>}
                        <p className="focused-hover-hint">{popupHoverDistance !== null ? `${popupHoverDistance.toFixed(1)}% da volta` : "Passe o mouse no gráfico acima para localizar o ponto no mapa."}</p>
                      </div>
                    </div>
                  );
                })()}
                <div className="insight-popup-metrics">{focusedInsight.metrics.map((metric) => <span key={metric}>{metric}</span>)}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
