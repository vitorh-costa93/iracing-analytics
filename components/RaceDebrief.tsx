"use client";

import { useEffect, useState } from "react";
import SectorConsistency from "@/components/SectorConsistency";
import { createTrackProjector } from "@/lib/track-map";

type BinStat = { distance: number; mean: number; stddev: number };
type ChannelStat = { channel: string; label: string; avgScore: number; binStats?: BinStat[] };
type LapScatterPoint = { lapNumber: number | null; lapTime: number; deltaFromBest: number };
type ExcludedOutlier = { lapNumber: number | null; lapTime: string; zScore: number };
type CornerMetric = { meanDistancePct?: number; mean?: number; stddev: number; consistency: string };
type ShapeMetric = { consistency: string };
type BandPoint = { offset: number; mean: number; stddev: number };
type TrackOutlinePoint = { distance: number; lat: number; lon: number };
type CornerReport = {
  cornerNumber: number; name: string | null; distancePct: number; sampleSize: number;
  braking: CornerMetric | null; apexSpeed: CornerMetric | null; throttleReapply: CornerMetric | null;
  brakeShape: ShapeMetric | null; throttleShape: ShapeMetric | null;
  brakeBand: BandPoint[]; throttleBand: BandPoint[];
};
type CategoryDebrief = {
  session: { startedAt: string; endedAt: string; durationMinutes: number; car: string; track: string } | null;
  message?: string;
  lapsAnalyzed?: number;
  overtakeChannelAvailable?: boolean;
  excludedOutliers?: ExcludedOutlier[];
  bestLap?: string;
  worstLap?: string;
  lapTimeSpread?: string;
  lapTimeStddev?: string;
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  channelStats?: ChannelStat[];
  lapScatter?: LapScatterPoint[];
  corners?: CornerReport[];
  cornerNarratives?: string[];
  trackOutline?: TrackOutlinePoint[] | null;
};

const CONSISTENCY_CLASS: Record<string, string> = { "muito consistente": "great", "consistente": "good", "variável": "warn", "muito inconsistente": "bad" };
type Category = "formula_car" | "sports_car" | "gtp_car";
const CATEGORIES: Category[] = ["formula_car", "sports_car", "gtp_car"];
const CATEGORY_LABEL: Record<Category, string> = { formula_car: "Formula Car", sports_car: "Sports Car", gtp_car: "GTP" };

function LapScatterChart({ points }: { points: LapScatterPoint[] }) {
  const width = 980, height = 130, pad = { left: 54, right: 18, top: 14, bottom: 24 };
  const times = points.map((p) => p.lapTime);
  const min = Math.min(...times), max = Math.max(...times);
  const span = Math.max(0.05, max - min);
  const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  const y = (time: number) => pad.top + (1 - (time - min) / span) * (height - pad.top - pad.bottom);
  const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
  const ticks = [min, max];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="debrief-chart" role="img" aria-label="Dispersão do tempo de volta ao longo do stint">
      {ticks.map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="debrief-grid" /><text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" className="debrief-axis">{tick.toFixed(2)}s</text></g>)}
      <line x1={pad.left} x2={width - pad.right} y1={y(avg)} y2={y(avg)} className="debrief-avg-line" />
      {points.map((point, index) => (
        <circle key={index} cx={x(index)} cy={y(point.lapTime)} r="4.5" className={point.lapTime <= min + 0.02 ? "debrief-dot best" : "debrief-dot"} />
      ))}
      {points.map((point, index) => <text key={`n${index}`} x={x(index)} y={height - 6} textAnchor="middle" className="debrief-axis">{point.lapNumber ?? index + 1}</text>)}
    </svg>
  );
}

function CornerBandChart({ brakeBand, throttleBand, onHover }: { brakeBand: BandPoint[]; throttleBand: BandPoint[]; onHover: (offset: number | null) => void }) {
  const width = 520, height = 112, pad = { left: 6, right: 6, top: 6, bottom: 5 };
  const offsets = [...brakeBand.map((p) => p.offset), ...throttleBand.map((p) => p.offset)];
  if (!offsets.length) return null;
  const minOffset = Math.min(...offsets), maxOffset = Math.max(...offsets);
  const x = (offset: number) => pad.left + ((offset - minOffset) / Math.max(1, maxOffset - minOffset)) * (width - pad.left - pad.right);
  const unx = (px: number) => minOffset + ((px - pad.left) / Math.max(1, width - pad.left - pad.right)) * (maxOffset - minOffset);
  const y = (value: number) => pad.top + (1 - value) * (height - pad.top - pad.bottom);
  const bandPath = (band: BandPoint[]) => band.length ? `${band.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.offset).toFixed(1)} ${y(Math.min(1, p.mean + p.stddev)).toFixed(1)}`).join(" ")} ${[...band].reverse().map((p) => `L ${x(p.offset).toFixed(1)} ${y(Math.max(0, p.mean - p.stddev)).toFixed(1)}`).join(" ")} Z` : "";
  const meanPath = (band: BandPoint[]) => band.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.offset).toFixed(1)} ${y(p.mean).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="corner-mini-chart" role="img" aria-label="Consistência de freio e acelerador nessa curva, entre as voltas analisadas; passe o mouse para localizar no mapa"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width * width;
        onHover(Math.max(minOffset, Math.min(maxOffset, unx(px))));
      }}
      onMouseLeave={() => onHover(null)}>
      <line x1={x(0)} x2={x(0)} y1={pad.top} y2={height - pad.bottom} className="corner-mini-axis" />
      <path d={bandPath(brakeBand)} className="corner-mini-band brake" />
      <path d={meanPath(brakeBand)} className="corner-mini-line brake" />
      <path d={bandPath(throttleBand)} className="corner-mini-band throttle" />
      <path d={meanPath(throttleBand)} className="corner-mini-line throttle" />
    </svg>
  );
}

/** Small track-shape map showing where on the physical circuit this corner card sits — the corner's
 * own position by default, or the point under the driver's cursor on the band chart above it, so
 * variance in the band chart can be tied back to an exact spot on track instead of just an offset %. */
function CornerTrackMap({ outline, cornerDistance, hoverOffset }: { outline: TrackOutlinePoint[]; cornerDistance: number; hoverOffset: number | null }) {
  const project = createTrackProjector(outline, 220, 140, 12);
  const markerDistance = ((cornerDistance + (hoverOffset ?? 0)) % 100 + 100) % 100;
  let marker: TrackOutlinePoint | null = null, bestDelta = Infinity;
  for (const point of outline) {
    const delta = Math.min(Math.abs(point.distance - markerDistance), 100 - Math.abs(point.distance - markerDistance));
    if (delta < bestDelta) { bestDelta = delta; marker = point; }
  }
  return (
    <svg viewBox="0 0 220 140" className="corner-mini-map" role="img" aria-label="Posição dessa curva no traçado da pista">
      <polyline points={outline.map(project).join(" ")} className="corner-mini-map-outline" />
      {marker && <circle cx={project(marker).split(",")[0]} cy={project(marker).split(",")[1]} r="4.8" className="corner-mini-map-marker" />}
    </svg>
  );
}

export default function RaceDebrief() {
  const [categories, setCategories] = useState<Record<Category, CategoryDebrief> | null>(null);
  const [selected, setSelected] = useState<Category>("formula_car");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [hoveredCorner, setHoveredCorner] = useState<{ cornerNumber: number; offset: number } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/telemetry/debrief", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao gerar o debrief");
        setCategories(result.categories);
        if (!result.categories?.formula_car?.session) {
          const fallback = CATEGORIES.find((category) => result.categories?.[category]?.session);
          if (fallback) setSelected(fallback);
        }
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  if (loading) return <div className="telemetry-state">Buscando sua última corrida válida (mínimo 15 minutos) em cada categoria e baixando telemetria das melhores voltas...</div>;
  if (error) return <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={() => setRetryCount((count) => count + 1)}>Tentar novamente</button></div>;

  const data = categories?.[selected];

  return (
    <div className="race-debrief">
      <div className="race-debrief-category-toggle">
        {CATEGORIES.map((category) => (
          <button key={category} className={selected === category ? "active" : ""} onClick={() => setSelected(category)}>{CATEGORY_LABEL[category]}</button>
        ))}
      </div>

      {!data?.session ? (
        <div className="telemetry-state">{data?.message ?? "Nenhuma corrida elegível encontrada."}</div>
      ) : (
        <>
          <div className="race-debrief-header">
            <div>
              <span className="section-kicker">DEBRIEF DA CORRIDA</span>
              <h3>{data.session.car} — {data.session.track}</h3>
              <p>{new Date(data.session.startedAt).toLocaleString("pt-BR")} • {data.session.durationMinutes} min de corrida • {data.lapsAnalyzed} voltas analisadas</p>
            </div>
          </div>

          <div className="race-debrief-summary">
            <p>{data.summary}</p>
            <div className="race-debrief-metrics">
              <div><span>MELHOR VOLTA</span><strong>{data.bestLap}</strong></div>
              <div><span>PIOR DAS ANALISADAS</span><strong>{data.worstLap}</strong></div>
              <div><span>VARIAÇÃO (SPREAD)</span><strong>{data.lapTimeSpread}s</strong></div>
              <div><span>DESVIO PADRÃO</span><strong>{data.lapTimeStddev}s</strong></div>
            </div>
          </div>

          {data.lapScatter && data.lapScatter.length > 2 && (
            <div className="race-debrief-chart-block">
              <span className="section-kicker">DISPERSÃO DO RITMO</span>
              <h4>Tempo de volta ao longo do stint</h4>
              <p className="race-debrief-channels-note">Cada ponto é uma volta, na ordem em que aconteceram na corrida. A linha tracejada é a média. O ponto destacado é a mais rápida.</p>
              <LapScatterChart points={data.lapScatter} />
            </div>
          )}

          <div className="race-debrief-columns">
            <div className="race-debrief-col strengths">
              <span className="section-kicker">PONTOS FORTES</span>
              <h4>O que manter</h4>
              {data.strengths?.map((text) => <p key={text}>{text}</p>)}
            </div>
            <div className="race-debrief-col improvements">
              <span className="section-kicker">PONTOS DE MELHORIA</span>
              <h4>Onde focar no treino</h4>
              {data.improvements?.map((text) => <p key={text}>{text}</p>)}
            </div>
          </div>

          <div className="race-debrief-channels">
            <span className="section-kicker">CONSISTÊNCIA POR CANAL</span>
            <p className="race-debrief-channels-note">Quanto menor a barra, mais você repete o mesmo padrão entre as voltas nesse canal.</p>
            <div className="race-debrief-channel-bars">
              {data.channelStats?.slice().sort((a, b) => a.avgScore - b.avgScore).map((item) => {
                const max = Math.max(...(data.channelStats ?? []).map((stat) => stat.avgScore), 0.01);
                return (
                  <div className="race-debrief-channel-row" key={item.channel}>
                    <span>{item.label}</span>
                    <div className="race-debrief-channel-track"><div style={{ width: `${Math.max(4, (item.avgScore / max) * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          {data.excludedOutliers && data.excludedOutliers.length > 0 && (
            <div className="race-debrief-chart-block">
              <span className="section-kicker">VOLTAS DESCARTADAS</span>
              <h4>Outliers estatísticos (provável overtake)</h4>
              <p className="race-debrief-channels-note">Essas voltas foram rápidas demais em relação ao seu ritmo real (detecção estatística por desvio robusto, já que a Garage61 não exporta o canal de overtake) e não entraram na análise de consistência.</p>
              <ul className="race-debrief-outlier-list">
                {data.excludedOutliers.map((item) => <li key={`${item.lapNumber}-${item.lapTime}`}>Volta {item.lapNumber ?? "?"} — {item.lapTime} (z-score {item.zScore})</li>)}
              </ul>
            </div>
          )}

          {data.corners && data.corners.length > 0 && (
            <div className="race-debrief-chart-block">
              <span className="section-kicker">ANÁLISE POR CURVA</span>
              <h4>Curva por curva, o que fazer em cada uma</h4>
              <p className="race-debrief-channels-note">Toda curva da pista, não só onde você freia forte. O gráfico mostra freio (vermelho) e acelerador (verde): faixa estreita = você repete o mesmo movimento volta após volta; faixa larga = você faz diferente cada vez.</p>
              <div className="race-debrief-corner-grid">
                {data.corners.map((corner, index) => (
                  <div className="race-debrief-corner-card" key={corner.cornerNumber}>
                    <h5>{corner.name ?? `Curva ${corner.cornerNumber}`} <span>~{corner.distancePct}% da volta</span></h5>
                    <div className="corner-mini-row">
                      <CornerBandChart brakeBand={corner.brakeBand} throttleBand={corner.throttleBand} onHover={(offset) => setHoveredCorner(offset === null ? null : { cornerNumber: corner.cornerNumber, offset })} />
                      {data.trackOutline && <CornerTrackMap outline={data.trackOutline} cornerDistance={corner.distancePct} hoverOffset={hoveredCorner?.cornerNumber === corner.cornerNumber ? hoveredCorner.offset : null} />}
                    </div>
                    {data.cornerNarratives?.[index] && <p className="corner-narrative">{data.cornerNarratives[index].replace(/^.*?\(~\d+% da volta\):\s*/, "")}</p>}
                    <div className="corner-metric-grid">
                      {corner.braking && <span className={`corner-chip ${CONSISTENCY_CLASS[corner.braking.consistency] ?? ""}`}>Ponto de freada: {corner.braking.consistency}</span>}
                      {corner.brakeShape && <span className={`corner-chip ${CONSISTENCY_CLASS[corner.brakeShape.consistency] ?? ""}`}>Força no freio: {corner.brakeShape.consistency}</span>}
                      {corner.apexSpeed && <span className={`corner-chip ${CONSISTENCY_CLASS[corner.apexSpeed.consistency] ?? ""}`}>Velocidade na curva: {corner.apexSpeed.consistency}</span>}
                      {corner.throttleShape && <span className={`corner-chip ${CONSISTENCY_CLASS[corner.throttleShape.consistency] ?? ""}`}>Retomada do acelerador: {corner.throttleShape.consistency}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="race-debrief-chart-block">
            <SectorConsistency category={selected} trackOutline={data.trackOutline} />
          </div>
        </>
      )}
    </div>
  );
}
