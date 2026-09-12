"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectCorners as detectCornersFromLatAccel, detectCornersFromGps } from "@/lib/corner-detection";
import { lookupCornerNames } from "@/lib/track-corners";
import { createTrackProjector } from "@/lib/track-map";
import { getTrackBoundary, type TrackBoundary } from "@/lib/track-boundaries";
import { useMapZoomPan } from "@/lib/useMapZoomPan";
import FocusedGaugeChart, { type FocusedSide } from "@/components/FocusedGaugeChart";
import { trackUiEvent } from "@/lib/track-ui-event";
import { buildGearRpmModel, detectWheelspin, compareToReference, type TractionSample } from "@/lib/traction-events";
import { describeWheelspinVsReference, describeCorrectionsVsReference } from "@/lib/traction-narrative";

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
  opportunities: { title: string; detail: string; gain: number; metrics: string[]; start: number; end: number; binStart: number; binEnd: number; deltaSeries: { distance: number; cumulativeGain: number }[]; kind: "corner" | "straight"; cornerNumber: number | null; cornerLabel: string | null; primaryType: string }[];
  channelInsights: string[];
};

type IbtVariable = { type: number; offset: number };

function formatLapTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function sessionTypeLabel(type: number | null | undefined) {
  if (type === 3) return "corrida";
  if (type === 2) return "qualifying";
  if (type === 1) return "practice";
  return "sessão registrada";
}

function selectionExplanation(item: Combination) {
  if (!item.bestLap) return "Ainda não há uma volta limpa com telemetria para avaliar neste contexto.";
  const activity = item.sessionTypes.map(sessionTypeLabel).join(", ");
  if (item.bestLap.selectionReason === "race_best_lap_without_p2p") return `Escolhida a melhor volta de corrida sem P2P/Overtake. Atividade encontrada: ${activity || "sessão registrada"}.`;
  if (item.bestLap.selectionReason === "race_best_lap") return `Escolhida a melhor volta de corrida. Atividade encontrada: ${activity || "sessão registrada"}.`;
  if (item.bestLap.selectionReason === "practice_best_lap") return `Ainda não há volta de corrida elegível; foi escolhida a melhor volta de practice para preparar a semana. Atividade encontrada: ${activity || "practice"}.`;
  return `Escolhida a melhor volta limpa disponível. Atividade encontrada: ${activity || "sessão registrada"}.`;
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

function channelScale(scalePoints: TracePoint[], field: ChannelKey) {
  const values = scalePoints.map((point) => point[field]).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return null;
  // Steering and yaw rate are signed (left/right), not a 0-based pedal input — same fix as the
  // popup's line() below, so full left-steering traces stop getting clipped off the row.
  const min = field === "speed" || field === "steering" || field === "yaw" || field === "yawRate" ? Math.min(...values) : 0;
  const max = Math.max(...values);
  return { min, max, span: Math.max(0.0001, max - min) };
}

function polyline(points: TracePoint[], field: ChannelKey, top: number, height: number, scalePoints = points) {
  const scale = channelScale(scalePoints, field);
  if (!scale) return "";
  return points.filter((point) => point[field] !== null && Number.isFinite(point[field])).map((point) => {
    const x = Math.max(0, Math.min(100, point.distance)) * 10;
    const y = top + height - ((Number(point[field]) - scale.min) / scale.span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

// 02/09/2026 P1 fix: "nenhum canal tem eixo/escala" -- the chart had no printed value anywhere on its
// ten stacked rows, so every reading required a hover. A compact min-max range per row (in the same
// units the hover panel already uses) gives a value at a glance without needing to touch the chart.
function formatChannelRange(field: ChannelKey, min: number, max: number) {
  const fmt = (value: number) => {
    if (field === "speed") return `${(value * 3.6).toFixed(0)}`;
    if (field === "steering") return `${(value * 180 / Math.PI).toFixed(0)}°`;
    if (field === "gear") return `${Math.round(value)}`;
    if (field === "latAccel" || field === "longAccel") return value.toFixed(1);
    if (field === "yawRate") return value.toFixed(2);
    if (field === "rpm") return value.toFixed(0);
    return `${(value * 100).toFixed(0)}%`;
  };
  const unit = field === "speed" ? " km/h" : "";
  return `${fmt(min)}–${fmt(max)}${unit}`;
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

type Corner = { number: number; distance: number; name: string | null; startDistance: number; endDistance: number };

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
  return raw.map((corner, index) => ({ number: corner.number, distance: corner.distance, name: names?.[index] ?? null, startDistance: corner.startDistance, endDistance: corner.endDistance }));
}

// 03/09/2026: "segue a mesma coisa, curva 31... na verdade isso é uma sequência de curvas e uma curva
// influencia na outra, então a nomenclatura tá errada" -- picking a single NEAREST corner to an
// analysis bin (the old nearestCorner, kept below only as a fallback comment reference) always named
// the loss after one corner even when the bin's real loss came from a run of several adjacent ones
// (a chicane/esses complex on a long track easily packs 3-4 detected corners into one 5%-of-lap bin).
// Returns every corner whose OWN real span overlaps the bin at all, in track order, so the caller can
// tell "one corner" from "a sequence" and label/frame each case honestly.
function cornersInRange(corners: Corner[], start: number, end: number): Corner[] {
  return corners
    .filter((corner) => corner.endDistance >= start && corner.startDistance <= end)
    .sort((a, b) => a.startDistance - b.startDistance);
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
    // 03/09/2026: "na verdade isso é uma sequência de curvas... a nomenclatura tá errada, seria algo
    // como 'Curvas 31-34'" -- see cornersInRange's own comment. One matched corner keeps the old
    // single-name behavior; several get an honest range label instead of picking just the nearest one.
    const matchedCorners = cornersInRange(corners, start, end);
    const corner = matchedCorners[0] ?? null;
    const kind: "corner" | "straight" = matchedCorners.length ? "corner" : "straight";
    // 03/09/2026: "se tá com a referência completa, curvas 20-22 deveria aparecer Indianapolis-Arnage"
    // -- a multi-corner match used to always fall back to plain numbers ("Curvas 20–22"), even when
    // one or more of those corners DO have a known real name (e.g. Arnage sitting right in that
    // range) -- discarding real names we already have just because the match happened to span more
    // than one detected corner. Prefer the distinct real name(s) among the matched corners; only
    // fall back to plain numbering when none of them are named.
    const namedCorners = Array.from(new Set(matchedCorners.map((item) => item.name).filter((name): name is string => Boolean(name))));
    const cornerLabel = matchedCorners.length === 0 ? null
      : namedCorners.length > 0 ? namedCorners.join("–")
      : matchedCorners.length === 1 ? `Curva ${matchedCorners[0].number}`
      : `Curvas ${matchedCorners[0].number}–${matchedCorners[matchedCorners.length - 1].number}`;
    const place = cornerLabel ? `${matchedCorners.length > 1 ? "nas" : "na"} ${cornerLabel}` : "neste trecho";

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

    // 03/09/2026: "curva 31... ela contempla um monte de curva, precisa ser mais específico" -- this
    // opportunity's `start`/`end` were always the fixed 5%-of-lap analysis bin (index*5 to
    // (index+1)*5), used only to slice samples for the gain/finding computation above. The title and
    // the highlighted chart/map range reused those SAME bin edges to describe "the corner" -- so a
    // real corner spanning a tight ~1% of the lap got labeled with a generic 5%-wide window whenever
    // it happened to fall in one (675m at Le Mans, easily several real corners on a long track). When
    // real corners were matched, show and highlight THEIR OWN combined footprint (a little padding
    // for context) instead of the arbitrary bin -- the underlying gain/finding numbers above still
    // come from the full bin's samples (a real change here would need a corner-aligned analysis
    // window, a bigger change), but at least the reported location is now honest about which stretch
    // it is, whether that's one corner or a run of several.
    const displayStart = matchedCorners.length ? Math.max(0, Math.min(...matchedCorners.map((item) => item.startDistance)) - 1) : start;
    const displayEnd = matchedCorners.length ? Math.min(100, Math.max(...matchedCorners.map((item) => item.endDistance)) + 1) : end;

    // 03/09/2026: "o delta de tempo evoluindo conforme eu corro o mouse... o delta final deve ser o
    // mesmo apresentado no card" -- a running cumulative own-vs-reference time delta across THIS
    // opportunity's own analysis bin (the same [start,end) samples and `scale` normalization the
    // `gain` above was computed from), so a hover position anywhere in the bin can look up "how much
    // of the total loss/gain has accumulated by here" and the very last point always sums to exactly
    // `item.gain` (verified below: deltaSeries.at(-1).cumulativeGain === gain by construction, since
    // it's the same running sum split into steps instead of collapsed straight to a total).
    const binRows = samples.filter((row) => Number(row.distance) >= start && Number(row.distance) < end);
    let cumulative = 0;
    const deltaSeries = binRows.map((row) => {
      cumulative += (1 / Number(row.own_speed) - 1 / Number(row.ref_speed)) * scale;
      return { distance: Number(row.distance), cumulativeGain: cumulative };
    });

    return {
      title: `${cornerLabel ?? "Reta / transição"} • ${displayStart.toFixed(1)}%–${displayEnd.toFixed(1)}%${trackLength ? ` • ${(displayStart / 100 * trackLength).toFixed(0)}–${(displayEnd / 100 * trackLength).toFixed(0)} m` : ""}`,
      detail: `Você perde cerca de ${tenths.toFixed(1)} décimos aqui. ${narrative}`,
      gain: item.gain,
      metrics: [`Δ velocidade ${item.speedGap >= 0 ? "+" : ""}${item.speedGap.toFixed(1)} km/h`, `Δ acelerador ${(item.throttleGap * 100).toFixed(0)} p.p.`, `Δ freio ${(item.brakeGap * 100).toFixed(0)} p.p.`],
      start: displayStart,
      end: displayEnd,
      binStart: start,
      binEnd: end,
      deltaSeries,
      kind,
      cornerNumber: corner?.number ?? null,
      cornerLabel,
      primaryType,
    };
  }).sort((a, b) => a.start - b.start);
  const avgAbs = (field: ChannelKey, source: Trace) => source.points.reduce((sum, point) => sum + Math.abs(point[field] ?? 0), 0) / source.points.length;

  // 11/09/2026: "ver se eu tenho mais microcorreções/destracionamentos comparado ao da referência" --
  // same lib/traction-events.ts engine as Comparar Carros, but only two laps exist here (not a pool),
  // so wheelspin is judged per-lap against its OWN gear/speed model (works fine from a single flying
  // lap, same as the real validation lap), and corrections use the reference lap itself as the
  // baseline (lib/traction-events.ts's compareToReference) instead of a median across many laps.
  const toTractionSamples = (points: TracePoint[]): TractionSample[] => points.map((point) => ({
    distance: point.distance,
    throttle: point.throttle ?? undefined, rpm: point.rpm ?? undefined, gear: point.gear ?? undefined,
    speedMs: point.speed ?? undefined, steeringRad: point.steering ?? undefined, yawRate: point.yawRate ?? undefined,
  }));
  const ownSamples = toTractionSamples(own.points);
  const referenceSamples = toTractionSamples(reference.points);
  const ownWheelspin = detectWheelspin(ownSamples, buildGearRpmModel([ownSamples]));
  const referenceWheelspin = detectWheelspin(referenceSamples, buildGearRpmModel([referenceSamples]));
  const tractionCorrections = compareToReference(ownSamples, referenceSamples);
  const worstCorrection = tractionCorrections.length
    ? tractionCorrections.reduce((best, event) => (event.oscillationDeg - event.baselineDeg > best.oscillationDeg - best.baselineDeg ? event : best))
    : null;
  const worstCorrectionLocation = worstCorrection ? (() => {
    const matched = cornersInRange(corners, worstCorrection.startDistance, worstCorrection.endDistance);
    const namedCorners = Array.from(new Set(matched.map((corner) => corner.name).filter((name): name is string => Boolean(name))));
    const label = namedCorners.length ? namedCorners.join("–") : matched.length ? `Curva ${matched[0].number}` : null;
    return label ? `${matched.length > 1 ? "nas" : "na"} ${label}` : `em ${worstCorrection.startDistance.toFixed(0)}%-${worstCorrection.endDistance.toFixed(0)}% da volta`;
  })() : null;

  const channelInsights = [
    `Volante: média absoluta ${(avgAbs("steering", own) * 180 / Math.PI).toFixed(1)}° contra ${(avgAbs("steering", reference) * 180 / Math.PI).toFixed(1)}° na referência.`,
    `RPM: média ${avgAbs("rpm", own).toFixed(0)} contra ${avgAbs("rpm", reference).toFixed(0)}; diferenças podem indicar marcha ou ponto de troca distintos.`,
    `Inputs: acelerador médio ${(avgAbs("throttle", own) * 100).toFixed(0)}% e freio médio ${(avgAbs("brake", own) * 100).toFixed(0)}%, contra ${(avgAbs("throttle", reference) * 100).toFixed(0)}% / ${(avgAbs("brake", reference) * 100).toFixed(0)}%.`,
    ...(reference.channels.some((channel) => /PushToPass|P2P_/i.test(channel))
      ? [`Push-to-pass: a referência IBT contém os canais de acionamento, estado e contagem. Use o tooltip para separar ganho de potência de ganho de pilotagem.`]
      : []),
    ...[describeWheelspinVsReference(ownWheelspin.length, referenceWheelspin.length), describeCorrectionsVsReference(tractionCorrections.length, worstCorrectionLocation)]
      .filter((line): line is string => line !== null),
  ];
  return { estimatedReferenceTime, estimatedGap: ownLapTime - estimatedReferenceTime, averageSpeedDifference, opportunities, channelInsights };
}

/** Linear-interpolates an opportunity's running cumulative time delta (see its `deltaSeries` own
 * comment) at an arbitrary distance -- clamped to the series' own [start,end) span, since a hover
 * position can sit in the small padding zone just outside it (0 before the sequence starts, the
 * final/total value once past its end, matching the card's own headline number). */
function interpolateCumulativeGain(series: { distance: number; cumulativeGain: number }[], distance: number): number {
  if (!series.length) return 0;
  if (distance <= series[0].distance) return 0;
  const last = series[series.length - 1];
  if (distance >= last.distance) return last.cumulativeGain;
  let prev = series[0];
  for (const point of series) {
    if (point.distance >= distance) {
      const span = point.distance - prev.distance;
      const ratio = span > 0 ? (distance - prev.distance) / span : 0;
      return prev.cumulativeGain + (point.cumulativeGain - prev.cumulativeGain) * ratio;
    }
    prev = point;
  }
  return last.cumulativeGain;
}

function nearestGpsPoint(points: TracePoint[], distance: number) {
  let best: TracePoint | null = null, bestDelta = Infinity;
  for (const point of points) {
    const delta = Math.min(Math.abs(point.distance - distance), 100 - Math.abs(point.distance - distance));
    if (delta < bestDelta) { bestDelta = delta; best = point; }
  }
  return best;
}

function TrackMap({ trace, referenceTrace, range, hoverDistance, zoom, trackId, focusRequest }: { trace: Trace; referenceTrace?: Trace | null; range: [number, number] | null; hoverDistance?: number | null; zoom?: boolean; trackId?: number | null; focusRequest?: { distance: number; nonce: number } | null }) {
  // Tracks the last focusRequest.nonce actually applied, so the render-time focusOn() call below (see
  // its own comment) fires once per click on the input chart, not every render.
  const appliedFocusNonce = useRef<number | null>(null);
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
  // 11/09/2026: "eu quero que todos os mapas sejam gerados por GPS, não essa coisa mal feita de
  // própria posição + offset. Isso é ruim e não funciona" -- dropped the offset-reconstruction
  // entirely (it derived the reference's map position from YOUR OWN GPS plus a computed lateral
  // offset instead of the reference's actual recorded GPS, and a %-of-lap-distance mismatch on a long
  // track like Le Mans could place that derived point hundreds of meters from anywhere real). Every
  // map now draws each trace's own real recorded GPS, unconditionally.
  const gps = trace.points.filter((point) => point.lat !== null && point.lon !== null);
  const refGps: TracePoint[] = referenceTrace ? referenceTrace.points.filter((point) => point.lat !== null && point.lon !== null) : [];
  // Keep the map window slightly wider than the input window: a hover must always have visible
  // approach and exit context on the linked trajectory. 03/09/2026: was +-3 -- reasonable back when
  // `range` was always a generic 5%-wide analysis bin (see the opportunities list in the component
  // below), but that list now passes the MATCHED CORNER'S OWN real (often much narrower, ~1-2%)
  // boundaries -- the same fixed +-3 on top of an already-tight corner window re-swallowed neighboring
  // corners into view ("curva 31... continua abordando muita coisa" even after that fix). +-1 still
  // gives a hover some breathing room without drowning a tight corner back into its neighbors.
  const mapRange = range ? [Math.max(0, range[0] - 1), Math.min(100, range[1] + 1)] as [number, number] : null;
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

  // Pan+zoom (01/09/2026: "eu quero usar o mouse para navegar... clico e movo o mouse para baixo eu
  // vou vendo a parte de cima do mapa... é uma funcionalidade bem conhecida") -- shared hook, same
  // one components/TrackMap.tsx uses, so every map in the app behaves identically now. Previously only
  // this file's full/sticky map (zoom prop falsy) had scroll-zoom, and even that used click-to-recenter
  // instead of drag-to-pan; the hover-panel and popup maps had no interactivity at all. Enabled for
  // BOTH here now -- the popup map narrows its own bounds to the corner window already, but the driver
  // still wants to pan/zoom further within that window to see exact positioning.
  // 12/09/2026: initialScale=projectGps.fillScale, computed above (before this hook call, since it's
  // needed here) from whichever bounds are active for this render (full track / zoomed corner / hover
  // selection) -- boundsPoints only changes on a genuinely new selection (a different opportunity card,
  // a different corner via prev/next, a different track), never on mere mouse hover, so this never
  // fights the driver's own manual pan/zoom mid-interaction; it resets to a sensible fill for whatever
  // is newly shown, same category as the existing resetKey=trackId reset.
  const { svgRef, camera, isDragging, onMouseDown, onTouchStart, transform, zoomBy, focusOn } = useMapZoomPan(300, 200, true, trackId, projectGps.fillScale);

  if (gps.length < 20) return <div className="track-map-empty">Mapa GPS indisponível nesta volta.</div>;

  // 03/09/2026: "os traçados fora da linha de corrida" -- same bug/fix as components/TrackMap.tsx
  // (see that file's own comment): boundary.segments held the WHOLE circuit, but a zoomed corner
  // window projects using bounds fit to just that corner -- any segment from a different part of a
  // long, winding track (Le Mans loops close to itself in several places) that happened to land
  // in-frame showed up as a stray line unrelated to the actual corner. Only draw segments with at
  // least one point inside the window's own bounds (padded for slack); harmless on the full-track
  // view (zoom prop falsy), whose own bounds already span the whole track.
  const BOUNDARY_PAD_METERS = 120;
  const boundsLats = boundsPoints.map((point) => Number(point.lat));
  const boundsLons = boundsPoints.map((point) => Number(point.lon));
  const boundsMinLat = Math.min(...boundsLats);
  const boundsMaxLat = Math.max(...boundsLats);
  const boundsMinLon = Math.min(...boundsLons);
  const boundsMaxLon = Math.max(...boundsLons);
  const boundsMeanLat = (boundsMinLat + boundsMaxLat) / 2;
  const padLat = BOUNDARY_PAD_METERS / 111_320;
  const padLon = BOUNDARY_PAD_METERS / (111_320 * Math.max(0.1, Math.cos((boundsMeanLat * Math.PI) / 180)));
  const paddedMinLat = boundsMinLat - padLat;
  const paddedMaxLat = boundsMaxLat + padLat;
  const paddedMinLon = boundsMinLon - padLon;
  const paddedMaxLon = boundsMaxLon + padLon;
  const visibleSegments = boundary
    ? boundary.segments.filter((segment) => segment.pts.some(([lat, lon]) => lat >= paddedMinLat && lat <= paddedMaxLat && lon >= paddedMinLon && lon <= paddedMaxLon))
    : [];
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
      focusOn(x, y, 3);
    }
  }
  return <div className="track-map-zoom-wrap">
    <svg ref={svgRef} className="track-map" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa GPS da pista com o traçado da sua volta e da referência no trecho selecionado"
      style={{ cursor: isDragging ? "grabbing" : camera.scale > 1 ? "grab" : "default", touchAction: "none" }}
      onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
      {/* Pan+zoom camera (lib/useMapZoomPan.ts): drag to pan, scroll to zoom anchored at the cursor --
       * no new bounds are computed, it just magnifies/pans the same projected points. */}
      <g style={{ transform }}>
        {/* Real track edges (OSM) when we have them for this track — each way segment drawn separately
         * at its own real-meters width; see lib/track-boundaries.ts for why they're deliberately not
         * stitched into one ordered polyline. Falls back to the old synthetic per-lap ribbon (thick
         * stroke drawn around whichever GPS trace is on screen) for a track we haven't sourced yet. */}
        {boundary
          ? visibleSegments.map((segment, index) => (
            <polyline key={index} points={segment.pts.map(([lat, lon]) => project({ lat, lon } as unknown as TracePoint)).join(" ")} className="track-outline" style={{ strokeWidth: Math.max(2, projectGps.metersToPixels(segment.width)) }} />
          ))
          : <>
            <polyline points={mapGps.map(project).join(" ")} className="track-outline" style={{ strokeWidth: trackWidthPx }} />
            {mapReference.length > 1 && <polyline points={mapReference.map(project).join(" ")} className="track-outline" style={{ strokeWidth: trackWidthPx }} />}
          </>}
        <polyline points={mapGps.map(project).join(" ")} className="track-own-line" />
        {mapReference.length > 1 && <polyline points={mapReference.map(project).join(" ")} className="track-reference" />}
        {/* r and strokeWidth divided by the camera scale (31/08/2026: "a bolinha está muito grande") --
         * these circles sit inside the same scaled <g> as everything else, so without this they
         * visually balloon in lockstep with the zoom; dividing keeps their SCREEN size constant. */}
        {!hoverOwn && selected[0] && <circle cx={project(selected[0]).split(",")[0]} cy={project(selected[0]).split(",")[1]} r={3 / camera.scale} style={{ strokeWidth: 3 / camera.scale }} className="track-marker" />}
        {hoverRef && <circle cx={project(hoverRef).split(",")[0]} cy={project(hoverRef).split(",")[1]} r={3.5 / camera.scale} style={{ strokeWidth: 3 / camera.scale }} className="track-marker-ref" />}
        {hoverOwn && <circle cx={project(hoverOwn).split(",")[0]} cy={project(hoverOwn).split(",")[1]} r={3.5 / camera.scale} style={{ strokeWidth: 3 / camera.scale }} className="track-marker" />}
      </g>
    </svg>
    {/* Manual +/- only makes sense on the FULL-track map (zoom prop falsy). The hover-panel and
     * insight-popup maps already auto-fit to a narrow local window — adding it there on top of that
     * auto-zoom was redundant and, worse, ate into their already-small footprint; drag-to-pan and
     * scroll-to-zoom still work on those, just without the on-screen buttons. */}
    {!zoom && (
      <div className="track-map-zoom-controls">
        <button type="button" onClick={(event) => { event.stopPropagation(); zoomBy(1.5); }} aria-label="Aproximar mapa">+</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); zoomBy(1 / 1.5); }} aria-label="Afastar mapa">–</button>
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
  // 02/09/2026 P1 fix: ".reference-message renderiza sucesso e falha na identica slot com identica
  // estilização" -- "Referência ativa atualizada." and a P2P-rejection/parse-failure used to be
  // visually indistinguishable. Tracked alongside the message itself rather than sniffed from its
  // text, so it can't drift out of sync with whichever string actually shows.
  const [referenceMessageError, setReferenceMessageError] = useState(false);
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
    setReferenceMessageError(false);
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
      .catch((reason) => { if (active) { setReferenceMessage(reason instanceof Error ? reason.message : String(reason)); setReferenceMessageError(true); } });
    return () => { active = false; };
  }, [selected]);

  const corners = useMemo(() => trace && selected ? detectCorners(trace.points, selected.track.name, selected.track.variant ?? "") : [], [trace, selected]);

  const comparison = useMemo(() => {
    if (!trace || !referenceTrace || !selected?.bestLap) return null;
    return compareTraces(trace, referenceTrace, selected.bestLap.lapTime, corners);
  }, [trace, referenceTrace, selected, corners]);

  // Esc closes the insight popup — the only way out was previously a mouse click on the ✕ or
  // outside the card, which stalls a keyboard-driven flow entirely.
  useEffect(() => {
    setPopupHoverDistance(null);
    if (!focusedInsight) return;
    // 02/09/2026 persona fix: "abre o popup de uma curva, termina, quer a próxima -- não existe
    // 'próxima'. Esc, rolar, achar o card certo, clicar" -- Left/Right cycle through the same
    // comparison.opportunities list the card grid renders, without closing the popup.
    function goTo(delta: number) {
      const list = comparison?.opportunities ?? [];
      const index = list.findIndex((item) => item.title === focusedInsight!.title);
      const next = list[index + delta];
      if (next) { setSelectedRange([next.start, next.end]); setFocusedInsight(next); }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setFocusedInsight(null); setSelectedRange(null); }
      else if (event.key === "ArrowRight") { event.preventDefault(); goTo(1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(-1); }
    }
    document.addEventListener("keydown", handleKeyDown);
    popupRef.current?.querySelector<HTMLButtonElement>(".insight-popup-close")?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedInsight, comparison]);

  async function uploadReference(file: File) {
    if (!selected) return;
    setUploading(true);
    setReferenceMessage("Validando e armazenando referência...");
    setReferenceMessageError(false);
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
      setReferenceMessageError(true);
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
            <select value={selectedKey} onChange={(event) => { const next = data.combinations.find((item) => item.key === event.target.value); setSelectedKey(event.target.value); if (next) trackUiEvent("telemetry_context_selected", { carId: next.car.id, trackId: next.track.id, selectionReason: next.bestLap?.selectionReason ?? "unavailable" }); }} disabled={data.combinations.length === 1}>
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
          <div className={`telemetry-selection-note ${selected.bestLap ? "" : "is-limited"}`}><strong>CRITÉRIO DE ELEGIBILIDADE</strong><span>{selectionExplanation(selected)}</span></div>
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
          {referenceMessage && <div className={`reference-message${referenceMessageError ? " error" : ""}`}>{referenceMessage}</div>}
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
              {/* Delta Bar (02/09/2026, "conseguiríamos trazer mais coisas próprias do iRacing pra
               * cá") -- iRacing's own in-sim widget for exactly this number: how far ahead/behind a
               * reference you are, as a bar growing from center instead of only a signed number.
               * Reuses the app's own diverging-bar visual language (already used for PERDAS|GANHOS
               * rankings) rather than inventing a new pattern -- green/right = faster than reference,
               * red/left = slower, clamped to a fixed ±2s scale (iRacing's widget is similarly
               * calibrated to a fixed range, not autoscaled per lap). */}
              {(() => {
                const gap = comparison.estimatedGap;
                const faster = gap < 0;
                const scale = 2; // seconds representing a full half-bar
                const width = Math.min(48, Math.abs(gap) / scale * 48);
                return (
                  <div className="delta-bar-row">
                    <span className="delta-bar-label">MAIS LENTO</span>
                    <div className="diverging-bar delta-bar"><i className="center-line" /><span className={faster ? "positive" : "negative"} style={faster ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} /></div>
                    <span className="delta-bar-label">MAIS RÁPIDO</span>
                  </div>
                );
              })()}
              <div className="insights-heading"><span className="section-kicker">MAIORES OPORTUNIDADES</span><h3>Onde você perde tempo e o que fazer</h3><p>As curvas são numeradas na ordem em que aparecem na volta. Quando eu sei o nome real da curva, uso ele; quando não sei, mostro só o número.</p></div>
                  <div className="insights-grid" ref={insightsRef}>{comparison.opportunities.length ? comparison.opportunities.map((item) => (
                    <button type="button" className={selectedRange?.[0] === item.start ? "active" : ""} onClick={() => { setSelectedRange([item.start, item.end]); setHoveredDistance(null); setFocusedInsight(item); trackUiEvent("telemetry_opportunity_opened", { carId: selected.car.id, trackId: selected.track.id, category: item.kind }); }} key={item.title}>
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
                {/* 02/09/2026 P1 fix: "rótulos de curva colidem" -- every label used to sit at the same
                 * y=10, so a track with many close-together corners (Silverstone, 15+) rendered them as
                 * one illegible smear. Staggering odd/even corners onto a second row (y=10/y=21) keeps
                 * each name legible without dropping any -- confirmed live this clears every corner's
                 * neighbors at Silverstone's tightest spacing. */}
                {corners.map((corner, index) => <g key={corner.number}><line x1={corner.distance * 10} x2={corner.distance * 10} y1="0" y2="925" className="corner-marker-line" /><text x={corner.distance * 10} y={index % 2 === 0 ? 10 : 21} textAnchor="middle" className="corner-marker-label">{corner.name ? corner.name.slice(0, 12) : `C${corner.number}`}</text></g>)}
                {([{"field":"speed","top":10,"height":140},{"field":"throttle","top":175,"height":65},{"field":"brake","top":265,"height":65},{"field":"steering","top":355,"height":65},{"field":"rpm","top":445,"height":65},{"field":"gear","top":535,"height":35},{"field":"clutch","top":595,"height":55},{"field":"latAccel","top":685,"height":55},{"field":"longAccel","top":775,"height":55},{"field":"yawRate","top":865,"height":55}] as {field:ChannelKey;top:number;height:number}[]).map((row) => {
                  const scale = channelScale(referenceTrace ? [...trace.points, ...referenceTrace.points] : trace.points, row.field);
                  return <g key={row.field}>
                  <text x="8" y={row.top + 12} className="channel-label">{row.field === "speed" ? "SPEED" : row.field === "throttle" ? "THROTTLE" : row.field === "brake" ? "BRAKE" : row.field === "steering" ? "STEERING" : row.field.toUpperCase()}</text>
                  {/* 02/09/2026 P1 fix: "nenhum canal tem eixo/escala" -- min-max range per row, in the
                   * same units the hover panel already uses, so a value is legible without hovering. */}
                  {scale && <text x="992" y={row.top + 12} textAnchor="end" className="channel-range">{formatChannelRange(row.field, scale.min, scale.max)}</text>}
                  <polyline points={polyline(trace.points, row.field, row.top, row.height, referenceTrace ? [...trace.points, ...referenceTrace.points] : trace.points)} className={`trace-${row.field}`} />
                  {referenceTrace && <polyline points={polyline(referenceTrace.points, row.field, row.top, row.height, [...trace.points, ...referenceTrace.points])} className={`trace-${row.field} reference-line`} />}
                </g>;
                })}
                {selectedRange && <rect x={selectedRange[0] * 10} y="0" width={(selectedRange[1] - selectedRange[0]) * 10} height="925" className="selected-segment" />}
                {hoveredDistance !== null && <line x1={hoveredDistance * 10} x2={hoveredDistance * 10} y1="0" y2="925" className="hover-line" />}
              </svg>
              </div>
              {/* 02/09/2026 P0 fix: "o mapa 'sticky' de Track Position não é sticky" -- this whole
               * block used to be .telemetry-map-sticky, `position: static` and stacked ABOVE the
               * chart as a full-width band, so by the time you scrolled down to actually hover the
               * chart, the map (and its own instruction text "passe o mouse nos inputs para localizar
               * o ponto no mapa") had already scrolled off screen -- the app's advertised core
               * interaction couldn't be seen working. Map + hover readout now live together in ONE
               * real position:sticky column next to the chart, so both are visible at the same time,
               * at every scroll position, the whole time you're hovering. */}
              <aside className="telemetry-side-sticky">
                <div className="telemetry-map-sticky"><span className="section-kicker">TRACK POSITION</span><h3>{selected?.track.name}</h3><TrackMap trace={trace} referenceTrace={referenceTrace} trackId={selected?.track.id} range={null} hoverDistance={hoveredDistance} focusRequest={chartFocus} />{referenceTrace && <p className="track-map-legend"><span className="own">Sua volta</span><span className="reference">Referência</span></p>}<p>Passe o mouse nos inputs para localizar o ponto no mapa, clique para dar zoom ali, ou role o mouse sobre o mapa para aproximar/afastar.</p></div>
                <div className="telemetry-hover-panel">
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
                </div>
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
                  {/* 02/09/2026 persona fix: explicit prev/next, not just the Left/Right keyboard
                   * shortcut above -- clamped (disabled at the ends), not wrapping, so it's always
                   * obvious which end of the list you're at. */}
                  <div className="insight-popup-nav">
                    {(() => {
                      const list = comparison?.opportunities ?? [];
                      const index = list.findIndex((item) => item.title === focusedInsight.title);
                      return <>
                        <button type="button" className="insight-popup-step" disabled={index <= 0} onClick={() => { const prev = list[index - 1]; if (prev) { setSelectedRange([prev.start, prev.end]); setFocusedInsight(prev); } }} aria-label="Curva anterior">← Anterior</button>
                        <button type="button" className="insight-popup-step" disabled={index === -1 || index >= list.length - 1} onClick={() => { const next = list[index + 1]; if (next) { setSelectedRange([next.start, next.end]); setFocusedInsight(next); } }} aria-label="Próxima curva">Próxima →</button>
                      </>;
                    })()}
                  </div>
                  <button type="button" className="insight-popup-close" onClick={() => { setFocusedInsight(null); setSelectedRange(null); }}>Fechar ✕</button>
                </div>
                <p className="insight-popup-detail">{focusedInsight.detail}</p>
                {(() => {
                  // Same +-1% padding the map now uses around the focused range (03/09/2026: was +-3,
                  // see the map's own comment for why that re-widened an already-tight matched-corner
                  // window back out into its neighbors) so the chart's own approach/exit context
                  // matches what the map shows either side of the corner.
                  const from = Math.max(0, focusedInsight.start - 1), to = Math.min(100, focusedInsight.end + 1);
                  const ownPts = trace.points.filter((point) => point.distance >= from && point.distance <= to);
                  const refPts = referenceTrace ? referenceTrace.points.filter((point) => point.distance >= from && point.distance <= to) : [];
                  const toSeries = (points: TracePoint[], field: "throttle" | "brake") => points
                    .filter((point) => point[field] !== null && Number.isFinite(point[field]))
                    .map((point) => ({ x: point.distance, value: Number(point[field]) }));
                  const wheelDistance = popupHoverDistance ?? (focusedInsight.start + focusedInsight.end) / 2;
                  // 02/09/2026: own/reference used to be --red/--blue (colliding with red=perda and
                  // blue=Formula-category); now --gauge-own (solid) / --gauge-reference (dashed
                  // purple) -- the FIXED (not theme-following) versions of --text/--reference, since
                  // this widget's own background (--gauge-bg) also stays fixed dark regardless of the
                  // app's light/dark theme (see .focused-chart's own comment in globals.css).
                  const sides: FocusedSide[] = [{
                    key: "own", label: "VOCÊ", color: "var(--gauge-own)", dashed: false,
                    throttle: toSeries(ownPts, "throttle"), brake: toSeries(ownPts, "brake"),
                    angleRad: interpolate(ownPts, wheelDistance, "steering"),
                    gear: interpolate(ownPts, wheelDistance, "gear"),
                    speedMs: interpolate(ownPts, wheelDistance, "speed"),
                    throttleNow: interpolate(ownPts, wheelDistance, "throttle"),
                    brakeNow: interpolate(ownPts, wheelDistance, "brake"),
                  }];
                  if (referenceTrace) sides.push({
                    key: "reference", label: "REFERÊNCIA", color: "var(--gauge-reference)", dashed: true,
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
                      {/* 03/09/2026: "o delta de tempo evoluindo conforme eu corro o mouse no gráfico
                       * de inputs vai me permitir visualizar onde que está a maior perda de tempo" --
                       * same diverging-bar language as the full-lap Delta Bar above (iRacing's own
                       * ahead/behind widget), but LOCAL to this corner/sequence: grows as the hover
                       * moves across the input chart, resting at the card's own total (`focusedInsight
                       * .gain`) when nothing is hovered -- by construction (deltaSeries is the same
                       * running sum split into steps, see its own comment), hovering exactly at the
                       * sequence's end always reads the same number the card headline already shows. */}
                      {(() => {
                        const hoverX = popupHoverDistance !== null
                          ? Math.min(focusedInsight.binEnd, Math.max(focusedInsight.binStart, popupHoverDistance))
                          : focusedInsight.binEnd;
                        const runningGain = interpolateCumulativeGain(focusedInsight.deltaSeries, hoverX);
                        const faster = runningGain < 0;
                        const scale = Math.max(0.15, Math.abs(focusedInsight.gain) * 1.15);
                        const width = Math.min(48, Math.abs(runningGain) / scale * 48);
                        return (
                          <div className="popup-delta-bar">
                            <div className="delta-bar-row">
                              <span className="delta-bar-label">MAIS LENTO</span>
                              <div className="diverging-bar delta-bar"><i className="center-line" /><span className={faster ? "positive" : "negative"} style={faster ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} /></div>
                              <span className="delta-bar-label">MAIS RÁPIDO</span>
                            </div>
                            <span className="popup-delta-bar-value">{runningGain >= 0 ? "+" : ""}{runningGain.toFixed(3)}s{popupHoverDistance === null ? " (total da sequência)" : " acumulado até aqui"}</span>
                          </div>
                        );
                      })()}
                      <div className="insight-popup-map">
                        <span className="section-kicker">TRAÇADO</span>
                        <TrackMap trace={trace} referenceTrace={referenceTrace} trackId={selected?.track.id} range={[focusedInsight.start, focusedInsight.end]} hoverDistance={popupHoverDistance} zoom />
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
