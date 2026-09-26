// Parsing de telemetria (CSV do Garage61, CSV/IBT de referência) e interpolação por distância.
// Extraído sem mudanças de components/ActiveWeekTelemetry.tsx (redesign etapa 3, 25/09/2026) para
// ficar testável e ser reaproveitado pelos componentes novos do Telemetry Lab.

export type ChannelKey = "speed" | "throttle" | "brake" | "steering" | "rpm" | "gear" | "clutch" | "latAccel" | "longAccel" | "yaw" | "yawRate" | "abs" | "drs" | "pushToPass" | "p2pStatus" | "p2pCount" | "lat" | "lon";
export type TracePoint = { distance: number } & Record<ChannelKey, number | null>;
export type Trace = { points: TracePoint[]; channels: string[]; trackLengthMeters: number | null };

type IbtVariable = { type: number; offset: number };

export function formatLapTime(value: number) {
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

/** `maxPoints` (padrão 900, o que o navegador desenha) limita as amostras por decimação; o servidor
 * passa `Infinity` quando precisa da resolução cheia (microcorreções, lib/microcorrections.ts). */
export function parseTelemetryCsv(csv: string, options: { maxPoints?: number } = {}): Trace {
  const maxPoints = options.maxPoints ?? 900;
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
  const stride = Number.isFinite(maxPoints) ? Math.max(1, Math.ceil(points.length / maxPoints)) : 1;
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

export function traceUsesOvertake(trace: Trace) {
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

export function ibtToBestLapCsv(buffer: ArrayBuffer) {
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

export function interpolate(points: TracePoint[], distance: number, field: ChannelKey) {
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

/** Cobertura GPS da volta (regra do CLAUDE.md: rejeitar volta quebrada/parcial pelo caminho GPS,
 * não só pelo tempo ou pela flag clean): GPS em pelo menos 90% das amostras, cobrindo do início ao
 * fim da volta e sem buraco maior que 3% da volta entre dois pontos com GPS. */
export function hasCompleteGps(trace: Trace) {
  const gps = trace.points.filter((point) => point.lat !== null && point.lon !== null && Number.isFinite(point.lat) && Number.isFinite(point.lon) && !(point.lat === 0 && point.lon === 0));
  if (!trace.points.length || gps.length / trace.points.length < 0.9 || gps.length < 30) return false;
  const sorted = [...gps].sort((a, b) => a.distance - b.distance);
  if (sorted[0].distance > 2 || sorted[sorted.length - 1].distance < 98) return false;
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i].distance - sorted[i - 1].distance > 3) return false;
  return true;
}

export function nearestGpsPoint(points: TracePoint[], distance: number) {
  let best: TracePoint | null = null, bestDelta = Infinity;
  for (const point of points) {
    const delta = Math.min(Math.abs(point.distance - distance), 100 - Math.abs(point.distance - distance));
    if (delta < bestDelta) { bestDelta = delta; best = point; }
  }
  return best;
}
