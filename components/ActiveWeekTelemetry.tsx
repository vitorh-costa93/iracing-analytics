"use client";

import { useEffect, useMemo, useState } from "react";

type Combination = {
  key: string;
  label: string;
  car: { id: number; name: string };
  track: { id: number; name: string; variant: string | null };
  sessions: number;
  lapsFound: number;
  bestLap: null | { id: string; lapTime: number; startTime: string; sessionType: number | null; telemetryUrl: string };
};

type ActiveWeekData = {
  status: string;
  week: null | { seasonName: string; number: number; start: string; end: string };
  combinations: Combination[];
};

type ChannelKey = "speed" | "throttle" | "brake" | "steering" | "rpm" | "gear" | "clutch" | "latAccel" | "longAccel" | "yaw" | "yawRate" | "abs" | "drs" | "lat" | "lon";
type TracePoint = { distance: number } & Record<ChannelKey, number | null>;
type Trace = { points: TracePoint[]; channels: string[]; trackLengthMeters: number | null };
type Reference = { filename: string; uploadedAt: string; csv: string };

type Comparison = {
  estimatedReferenceTime: number;
  estimatedGap: number;
  averageSpeedDifference: number;
  opportunities: { title: string; detail: string; gain: number; metrics: string[]; start: number; end: number }[];
  channelInsights: string[];
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
    lat: find("lat", "latitude"), lon: find("lon", "longitude"),
  };
  if (distanceIndex < 0) throw new Error("O Garage61 não retornou um canal de distância reconhecido");

  const raw = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  const points = raw.map((cells) => {
    const point = { distance: Number(cells[distanceIndex]) } as TracePoint;
    for (const key of Object.keys(indexes) as ChannelKey[]) {
      const index = indexes[key];
      const parsed = index >= 0 ? Number(cells[index]) : Number.NaN;
      point[key] = Number.isFinite(parsed) ? parsed : null;
    }
    return point;
  }).filter((point) => Number.isFinite(point.distance)).sort((a, b) => a.distance - b.distance);
  if (!points.length) throw new Error("A telemetria não contém amostras válidas");
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
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
  const exported = ["Speed", "Brake", "Throttle", "RPM", "SteeringWheelAngle", "Gear", "Clutch", "LatAccel", "LongAccel", "Yaw", "YawRate", "BrakeABSactive", "DRS_Status", "Lat", "Lon"];
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
  const finishLap = () => {
    if (points.length < 100 || touchedPit) return;
    const ordered = [...points].sort((a, b) => a.distance - b.distance);
    const minDistance = ordered[0].distance;
    const maxDistance = ordered[ordered.length - 1].distance;
    const duration = points[points.length - 1].time - points[0].time;
    if (minDistance > 0.03 || maxDistance < 0.97 || duration <= 10) return;
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
  const min = field === "speed" ? Math.min(...values) : 0;
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

function compareTraces(own: Trace, reference: Trace, ownLapTime: number): Comparison | null {
  const bins = Array.from({ length: 401 }, (_, index) => index / 4);
  const fields: ChannelKey[] = ["speed", "throttle", "brake", "steering", "rpm", "gear", "clutch", "latAccel", "longAccel", "yawRate", "abs", "drs"];
  const samples = bins.map((distance) => {
    const values: Record<string, number | null> = { distance };
    for (const field of fields) { values[`own_${field}`] = interpolate(own.points, distance, field); values[`ref_${field}`] = interpolate(reference.points, distance, field); }
    return values;
  }).filter((item) => item.own_speed && item.ref_speed && item.own_speed > 1 && item.ref_speed > 1);
  if (samples.length < 100) return null;
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
    return { index, gain: ownTime - refTime, speedGap: (avg("ref_speed") - avg("own_speed")) * 3.6, throttleGap: avg("ref_throttle") - avg("own_throttle"), brakeGap: avg("own_brake") - avg("ref_brake"), steeringGap: Math.abs(avg("own_steering")) - Math.abs(avg("ref_steering")), rpmGap: avg("ref_rpm") - avg("own_rpm"), gearGap: avg("ref_gear") - avg("own_gear"), latAccelGap: Math.abs(avg("ref_latAccel")) - Math.abs(avg("own_latAccel")) };
  }).filter((item) => item.gain > 0.008).sort((a, b) => b.gain - a.gain).slice(0, 5);
  const opportunities = segments.map((item) => {
    const start = item.index * 5, end = (item.index + 1) * 5;
    const braking = brakingDeltas.find((event) => event.position >= start - 2 && event.position <= end + 2);
    const observations: string[] = [];
    if (braking?.deltaMeters) observations.push(braking.deltaMeters < 0
      ? `você freia ${Math.abs(braking.deltaMeters).toFixed(0)} m antes; há espaço para testar uma frenagem progressivamente mais adiante se velocidade mínima e saída não piorarem`
      : `você freia ${Math.abs(braking.deltaMeters).toFixed(0)} m depois; confira se isso causa pico de freio, menor velocidade mínima ou atraso na retomada`);
    if (item.throttleGap > .06) observations.push(`referência usa ${(item.throttleGap * 100).toFixed(0)} p.p. mais acelerador`);
    if (item.brakeGap > .06) observations.push(`você aplica ${(item.brakeGap * 100).toFixed(0)} p.p. mais freio`);
    if (Math.abs(item.steeringGap) > .03) observations.push(`${item.steeringGap > 0 ? "mais" : "menos"} ângulo de volante`);
    if (Math.abs(item.gearGap) >= .45) observations.push(`referência usa marcha ${item.gearGap > 0 ? "mais alta" : "mais baixa"}`);
    if (item.rpmGap > 300) observations.push(`referência mantém cerca de ${item.rpmGap.toFixed(0)} RPM a mais`);
    if (item.latAccelGap > .5) observations.push("referência sustenta mais aceleração lateral");
    return {
      title: `${start}%–${end}% da volta${trackLength ? ` • ${(start / 100 * trackLength).toFixed(0)}–${(end / 100 * trackLength).toFixed(0)} m` : ""}`,
      detail: `Você perde cerca de ${(item.gain * 10).toFixed(1)} décimos neste trecho porque ${observations.length ? observations.join("; ") : "mantém menos velocidade que a referência"}.`,
      gain: item.gain,
      metrics: [`Δ velocidade ${item.speedGap >= 0 ? "+" : ""}${item.speedGap.toFixed(1)} km/h`, `Δ throttle ${(item.throttleGap * 100).toFixed(0)} p.p.`, `Δ freio ${(item.brakeGap * 100).toFixed(0)} p.p.`],
      start,
      end,
    };
  });
  const avgAbs = (field: ChannelKey, source: Trace) => source.points.reduce((sum, point) => sum + Math.abs(point[field] ?? 0), 0) / source.points.length;
  const channelInsights = [
    `Volante: média absoluta ${(avgAbs("steering", own) * 180 / Math.PI).toFixed(1)}° contra ${(avgAbs("steering", reference) * 180 / Math.PI).toFixed(1)}° na referência.`,
    `RPM: média ${avgAbs("rpm", own).toFixed(0)} contra ${avgAbs("rpm", reference).toFixed(0)}; diferenças podem indicar marcha ou ponto de troca distintos.`,
    `Inputs: acelerador médio ${(avgAbs("throttle", own) * 100).toFixed(0)}% e freio médio ${(avgAbs("brake", own) * 100).toFixed(0)}%, contra ${(avgAbs("throttle", reference) * 100).toFixed(0)}% / ${(avgAbs("brake", reference) * 100).toFixed(0)}%.`,
  ];
  return { estimatedReferenceTime, estimatedGap: ownLapTime - estimatedReferenceTime, averageSpeedDifference, opportunities, channelInsights };
}

function TrackMap({ trace, range }: { trace: Trace; range: [number, number] | null }) {
  const gps = trace.points.filter((point) => point.lat !== null && point.lon !== null);
  if (gps.length < 20) return <div className="track-map-empty">Mapa GPS indisponível nesta volta.</div>;
  const lats = gps.map((point) => Number(point.lat)), lons = gps.map((point) => Number(point.lon));
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const project = (point: TracePoint) => {
    const x = 18 + (Number(point.lon) - minLon) / Math.max(.000001, maxLon - minLon) * 264;
    const y = 182 - (Number(point.lat) - minLat) / Math.max(.000001, maxLat - minLat) * 164;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const selected = range ? gps.filter((point) => point.distance >= range[0] && point.distance <= range[1]) : [];
  return <svg className="track-map" viewBox="0 0 300 200" role="img" aria-label="Mapa GPS da pista com trecho selecionado">
    <polyline points={gps.map(project).join(" ")} className="track-outline" />
    {selected.length > 1 && <polyline points={selected.map(project).join(" ")} className="track-highlight" />}
    {selected[0] && <circle cx={project(selected[0]).split(",")[0]} cy={project(selected[0]).split(",")[1]} r="4" className="track-marker" />}
  </svg>;
}

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

  useEffect(() => {
    let active = true;
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
  }, []);

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
  }, [selected]);

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
          setReference(result.reference);
          setReferenceTrace(parseTelemetryCsv(result.reference.csv));
        }
      })
      .catch((reason) => active && setReferenceMessage(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [selected]);

  const comparison = useMemo(() => {
    if (!trace || !referenceTrace || !selected?.bestLap) return null;
    return compareTraces(trace, referenceTrace, selected.bestLap.lapTime);
  }, [trace, referenceTrace, selected]);

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
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("carId", String(selected.car.id));
      form.set("trackId", String(selected.track.id));
      const response = await fetch("/api/telemetry/reference", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro no upload da referência");
      setReference(result.reference);
      setReferenceTrace(parseTelemetryCsv(result.reference.csv));
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
      {!loading && error && !selected && <div className="telemetry-state error">{error}</div>}
      {!loading && !error && !data?.combinations.length && <div className="telemetry-state">Nenhuma atividade encontrada na semana vigente.</div>}
      {selected && (
        <div className="telemetry-content">
          <div className="telemetry-meta">
            <div><span>MELHOR VOLTA LIMPA</span><strong>{selected.bestLap ? formatLapTime(selected.bestLap.lapTime) : "Indisponível"}</strong></div>
            <div><span>ATIVIDADE</span><strong>{selected.sessions} sessões • {selected.lapsFound} voltas</strong></div>
            <div><span>FONTE</span><strong>Garage61 • pré-carregada</strong></div>
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
          {error && <div className="telemetry-state error">{error}</div>}
          {!traceLoading && !error && !selected.bestLap && <div className="telemetry-state">Ainda não há uma volta limpa com telemetria disponível para esta combinação.</div>}
          {referenceTrace && !comparison && <div className="telemetry-state error">Não foi possível alinhar amostras suficientes entre as duas voltas.</div>}
          {comparison && trace && (
            <div className="comparison-section insights-first">
              <div className="comparison-summary">
                <div><span>REFERÊNCIA ESTIMADA</span><strong>{formatLapTime(comparison.estimatedReferenceTime)}</strong></div>
                <div><span>GAP ESTIMADO</span><strong className={comparison.estimatedGap > 0 ? "negative" : "positive"}>{comparison.estimatedGap > 0 ? "+" : ""}{comparison.estimatedGap.toFixed(3)}s</strong></div>
                <div><span>Δ VELOCIDADE MÉDIA</span><strong>{comparison.averageSpeedDifference >= 0 ? "+" : ""}{(comparison.averageSpeedDifference * 3.6).toFixed(1)} km/h</strong></div>
              </div>
              <div className="insights-heading"><span className="section-kicker">MAIORES OPORTUNIDADES</span><h3>Onde você perde tempo e o que fazer</h3></div>
                  <div className="insights-grid">{comparison.opportunities.length ? comparison.opportunities.map((item) => (
                    <button type="button" className={selectedRange?.[0] === item.start ? "active" : ""} onClick={() => { setSelectedRange([item.start, item.end]); setHoveredDistance((item.start + item.end) / 2); }} key={item.title}>
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
              <aside className="telemetry-map-sticky"><span className="section-kicker">TRACK POSITION</span><h3>{selected?.track.name}</h3><TrackMap trace={trace} range={selectedRange ?? (hoveredDistance !== null ? [Math.max(0, hoveredDistance - .35), Math.min(100, hoveredDistance + .35)] : null)} /><p>Passe o mouse nos inputs ou clique em um insight.</p></aside>
              <div className="interactive-chart">
              <svg className="telemetry-chart" viewBox="0 0 1000 960" role="img" aria-label="Canais sincronizados das duas voltas por distância da pista"
                onMouseLeave={() => setHoveredDistance(null)} onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoveredDistance(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)));
                }}>
                {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1={value * 10} x2={value * 10} y1="0" y2="925" className="telemetry-grid" /><text x={value * 10} y="954" textAnchor={value === 0 ? "start" : value === 100 ? "end" : "middle"}>{value}%</text></g>)}
                {([{"field":"speed","top":10,"height":140},{"field":"throttle","top":175,"height":65},{"field":"brake","top":265,"height":65},{"field":"steering","top":355,"height":65},{"field":"rpm","top":445,"height":65},{"field":"gear","top":535,"height":35},{"field":"clutch","top":595,"height":55},{"field":"latAccel","top":685,"height":55},{"field":"longAccel","top":775,"height":55},{"field":"yawRate","top":865,"height":55}] as {field:ChannelKey;top:number;height:number}[]).map((row) => <g key={row.field}>
                  <text x="8" y={row.top + 12} className="channel-label">{row.field === "speed" ? "SPEED" : row.field === "throttle" ? "THROTTLE" : row.field === "brake" ? "BRAKE" : row.field === "steering" ? "STEERING" : row.field.toUpperCase()}</text>
                  <polyline points={polyline(trace.points, row.field, row.top, row.height, referenceTrace ? [...trace.points, ...referenceTrace.points] : trace.points)} className={`trace-${row.field}`} />
                  {referenceTrace && <polyline points={polyline(referenceTrace.points, row.field, row.top, row.height, [...trace.points, ...referenceTrace.points])} className={`trace-${row.field} reference-line`} />}
                </g>)}
                {selectedRange && <rect x={selectedRange[0] * 10} y="0" width={(selectedRange[1] - selectedRange[0]) * 10} height="925" className="selected-segment" />}
                {hoveredDistance !== null && <line x1={hoveredDistance * 10} x2={hoveredDistance * 10} y1="0" y2="925" className="hover-line" />}
              </svg>
              {hoveredDistance !== null && (() => {
                const own = (field: ChannelKey) => interpolate(trace.points, hoveredDistance, field);
                const ref = (field: ChannelKey) => referenceTrace ? interpolate(referenceTrace.points, hoveredDistance, field) : null;
                const format = (field: ChannelKey, value: number | null) => value === null ? "—" : field === "speed" ? `${(value * 3.6).toFixed(1)} km/h` : field === "steering" ? `${(value * 180 / Math.PI).toFixed(1)}°` : field === "rpm" ? `${value.toFixed(0)}` : field === "gear" ? `${Math.round(value)}` : field === "latAccel" || field === "longAccel" ? `${value.toFixed(2)} m/s²` : field === "yawRate" ? `${value.toFixed(3)} rad/s` : `${(value * 100).toFixed(0)}%`;
                return <div className="telemetry-hover" style={{ left: `${Math.min(82, Math.max(2, hoveredDistance))}%` }}><strong>{hoveredDistance.toFixed(1)}% {trace.trackLengthMeters ? `• ${(hoveredDistance / 100 * trace.trackLengthMeters).toFixed(0)} m` : ""}</strong>{(["speed","throttle","brake","steering","rpm","gear","clutch","latAccel","longAccel","yawRate"] as ChannelKey[]).map((field) => <div key={field}><span>{field}</span><b>{format(field, own(field))}</b><em>{format(field, ref(field))}</em></div>)}</div>;
              })()}
              </div>
              </div>
              <p className="telemetry-caption">{trace.points.length.toLocaleString("pt-BR")} amostras exibidas • volta de {new Date(selected.bestLap!.startTime).toLocaleString("pt-BR")}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
