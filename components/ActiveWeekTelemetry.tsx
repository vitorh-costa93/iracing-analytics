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

type TracePoint = { distance: number; speed: number | null; throttle: number | null; brake: number | null };
type Trace = { points: TracePoint[]; channels: string[] };
type Reference = { filename: string; uploadedAt: string; csv: string };

type Comparison = {
  estimatedReferenceTime: number;
  estimatedGap: number;
  averageSpeedDifference: number;
  opportunities: { title: string; detail: string; gain: number }[];
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
  const speedIndex = find("speed", "gpsspeed", "velocity");
  const throttleIndex = find("throttle", "throttleposition", "throttleinput");
  const brakeIndex = find("brake", "brakepressure", "brakeinput");
  if (distanceIndex < 0) throw new Error("O Garage61 não retornou um canal de distância reconhecido");

  const raw = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  const points = raw.map((cells) => ({
    distance: Number(cells[distanceIndex]),
    speed: speedIndex >= 0 ? Number(cells[speedIndex]) : null,
    throttle: throttleIndex >= 0 ? Number(cells[throttleIndex]) : null,
    brake: brakeIndex >= 0 ? Number(cells[brakeIndex]) : null,
  })).filter((point) => Number.isFinite(point.distance));
  if (!points.length) throw new Error("A telemetria não contém amostras válidas");
  const maxDistance = Math.max(...points.map((point) => point.distance));
  if (maxDistance > 0 && maxDistance <= 1.01) points.forEach((point) => { point.distance *= 100; });
  const stride = Math.max(1, Math.ceil(points.length / 900));
  return {
    points: points.filter((_, index) => index % stride === 0),
    channels: headers,
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
  const optional = ["RPM", "SteeringWheelAngle", "Gear", "Clutch", "OnPitRoad"];
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
      values: [value(record, "Speed"), value(record, "Brake"), value(record, "Throttle"), ...optional.slice(0, 4).map((name) => value(record, name))],
    });
  }
  finishLap();
  const bestLap = best as { duration: number; points: LapPoint[] } | null;
  if (!bestLap) throw new Error("Nenhuma volta completa fora dos boxes foi encontrada no IBT");
  const stride = Math.max(1, Math.ceil(bestLap.points.length / 1800));
  const headers = ["Speed", "LapDistPct", "Brake", "Throttle", "RPM", "SteeringWheelAngle", "Gear", "Clutch"];
  const rows = bestLap.points.filter((_, index) => index % stride === 0).map((point) =>
    [point.values[0], point.distance, ...point.values.slice(1)].map((item) => Number.isFinite(item) ? item : "").join(",")
  );
  return { csv: [headers.join(","), ...rows].join("\n"), duration: bestLap.duration, samples: rows.length };
}

function polyline(points: TracePoint[], field: "speed" | "throttle" | "brake", top: number, height: number, scalePoints = points) {
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

function interpolate(points: TracePoint[], distance: number, field: "speed" | "throttle" | "brake") {
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
  const samples = bins.map((distance) => ({
    distance,
    ownSpeed: interpolate(own.points, distance, "speed"),
    refSpeed: interpolate(reference.points, distance, "speed"),
    ownThrottle: interpolate(own.points, distance, "throttle"),
    refThrottle: interpolate(reference.points, distance, "throttle"),
    ownBrake: interpolate(own.points, distance, "brake"),
    refBrake: interpolate(reference.points, distance, "brake"),
  })).filter((item) => item.ownSpeed && item.refSpeed && item.ownSpeed > 1 && item.refSpeed > 1);
  if (samples.length < 100) return null;
  const ownIntegral = samples.reduce((sum, item) => sum + 1 / Number(item.ownSpeed), 0);
  const refIntegral = samples.reduce((sum, item) => sum + 1 / Number(item.refSpeed), 0);
  const scale = ownLapTime / ownIntegral;
  const estimatedReferenceTime = refIntegral * scale;
  const averageSpeedDifference = samples.reduce((sum, item) => sum + Number(item.refSpeed) - Number(item.ownSpeed), 0) / samples.length;
  const segments = Array.from({ length: 10 }, (_, index) => {
    const rows = samples.filter((item) => item.distance >= index * 10 && item.distance < (index + 1) * 10);
    const own = rows.reduce((sum, item) => sum + 1 / Number(item.ownSpeed), 0) * scale;
    const ref = rows.reduce((sum, item) => sum + 1 / Number(item.refSpeed), 0) * scale;
    const speedGap = rows.reduce((sum, item) => sum + Number(item.refSpeed) - Number(item.ownSpeed), 0) / Math.max(1, rows.length);
    const throttleGap = rows.reduce((sum, item) => sum + Number(item.refThrottle ?? 0) - Number(item.ownThrottle ?? 0), 0) / Math.max(1, rows.length);
    const brakeGap = rows.reduce((sum, item) => sum + Number(item.ownBrake ?? 0) - Number(item.refBrake ?? 0), 0) / Math.max(1, rows.length);
    return { index, gain: own - ref, speedGap, throttleGap, brakeGap };
  }).filter((item) => item.gain > 0.01).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const opportunities = segments.map((item) => {
    const technique = item.brakeGap > 0.08 ? "mais frenagem que a referência" : item.throttleGap > 0.08 ? "retomada de acelerador mais tardia" : "menor velocidade sustentada";
    return {
      title: `${item.index * 10}%–${(item.index + 1) * 10}% da volta`,
      detail: `${technique}; diferença média de velocidade de ${item.speedGap >= 0 ? "+" : ""}${item.speedGap.toFixed(1)} no canal Speed.`,
      gain: item.gain,
    };
  });
  return { estimatedReferenceTime, estimatedGap: ownLapTime - estimatedReferenceTime, averageSpeedDifference, opportunities };
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
          {trace && (
            <div className="telemetry-chart-wrap">
              <div className="telemetry-legend"><span className="speed">Sua volta</span>{referenceTrace && <span className="reference">Referência</span>}<span className="throttle">Acelerador</span><span className="brake">Freio</span></div>
              <svg className="telemetry-chart" viewBox="0 0 1000 300" role="img" aria-label="Canais da melhor volta por distância da pista">
                {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1={value * 10} x2={value * 10} y1="0" y2="275" className="telemetry-grid" /><text x={value * 10} y="296" textAnchor={value === 0 ? "start" : value === 100 ? "end" : "middle"}>{value}%</text></g>)}
                <polyline points={polyline(trace.points, "speed", 8, 150, referenceTrace ? [...trace.points, ...referenceTrace.points] : trace.points)} className="trace-speed" />
                {referenceTrace && <polyline points={polyline(referenceTrace.points, "speed", 8, 150, [...trace.points, ...referenceTrace.points])} className="trace-reference" />}
                <polyline points={polyline(trace.points, "throttle", 185, 75)} className="trace-throttle" />
                <polyline points={polyline(trace.points, "brake", 185, 75)} className="trace-brake" />
              </svg>
              <p className="telemetry-caption">{trace.points.length.toLocaleString("pt-BR")} amostras exibidas • volta de {new Date(selected.bestLap!.startTime).toLocaleString("pt-BR")}</p>
            </div>
          )}
          {referenceTrace && !comparison && <div className="telemetry-state error">Não foi possível alinhar amostras suficientes entre as duas voltas.</div>}
          {comparison && (
            <div className="comparison-section">
              <div className="comparison-summary">
                <div><span>REFERÊNCIA ESTIMADA</span><strong>{formatLapTime(comparison.estimatedReferenceTime)}</strong></div>
                <div><span>GAP ESTIMADO</span><strong className={comparison.estimatedGap > 0 ? "negative" : "positive"}>{comparison.estimatedGap > 0 ? "+" : ""}{comparison.estimatedGap.toFixed(3)}s</strong></div>
                <div><span>Δ VELOCIDADE MÉDIA</span><strong>{comparison.averageSpeedDifference >= 0 ? "+" : ""}{comparison.averageSpeedDifference.toFixed(1)}</strong></div>
              </div>
              <div className="insights-heading"><span className="section-kicker">MAIORES OPORTUNIDADES</span><h3>Onde investigar primeiro</h3></div>
              <div className="insights-grid">
                {comparison.opportunities.length ? comparison.opportunities.map((item) => (
                  <article key={item.title}><strong>{item.title}</strong><span>até {item.gain.toFixed(3)}s estimados</span><p>{item.detail}</p></article>
                )) : <p className="comparison-note">A volta própria não apresentou perdas materiais nos dez segmentos analisados.</p>}
              </div>
              <p className="comparison-note">Tempos e ganhos são estimados pela integração de velocidade normalizada por distância. Confirme cada hipótese nos traços; combustível, setup, clima e aderência podem explicar diferenças.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
