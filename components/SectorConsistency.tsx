"use client";

import { useEffect, useState } from "react";

type SectorStat = { sector: number; sampleSize: number; mean: number; stddev: number; best: number; consistency: string; note: string | null };
type SectorReport = { car: string; track: string; lapsAnalyzed: number; sectors: SectorStat[]; idealLap: string; actualBestLap: string; gapToIdeal: string; summary: string };
type CategoryPayload = { status: string; report: SectorReport | null; message?: string | null };
export type SectorCategory = "formula_car" | "sports_car" | "gtp_car";
type TrackOutlinePoint = { distance: number; lat: number; lon: number };

const CONSISTENCY_CLASS: Record<string, string> = { "muito consistente": "great", "consistente": "good", "variável": "warn", "muito inconsistente": "bad" };
const CONSISTENCY_LABEL: Record<string, string> = { great: "Muito consistente", good: "Consistente", warn: "Variável", bad: "Muito inconsistente" };

function SectorTrackMap({ sectors, outline }: { sectors: SectorStat[]; outline: TrackOutlinePoint[] }) {
  if (outline.length < 20) return null;
  const lats = outline.map((point) => point.lat), lons = outline.map((point) => point.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.00005), lonSpan = Math.max(maxLon - minLon, 0.00005);
  const project = (point: TrackOutlinePoint) => {
    const x = 18 + (point.lon - minLon) / lonSpan * 404;
    const y = 272 - (point.lat - minLat) / latSpan * 244;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const sectorCount = Math.max(sectors.length, 1);

  return (
    <div className="sector-map-card">
      <svg viewBox="0 0 440 300" className="sector-map" role="img" aria-label="Mapa da pista colorido pela consistência de cada setor">
        <polyline points={outline.map(project).join(" ")} className="sector-map-base" />
        {sectors.map((sector, index) => {
          const start = index / sectorCount * 100;
          const end = (index + 1) / sectorCount * 100;
          const points = outline.filter((point) => point.distance >= start && point.distance <= end);
          const cls = CONSISTENCY_CLASS[sector.consistency] ?? "good";
          return points.length > 1 ? <polyline key={sector.sector} points={points.map(project).join(" ")} className={`sector-map-segment ${cls}`} /> : null;
        })}
      </svg>
      <div className="sector-map-legend">
        {Object.entries(CONSISTENCY_LABEL).map(([cls, label]) => <span key={cls} className={cls}>{label}</span>)}
      </div>
    </div>
  );
}

function SectorDetail({ sector }: { sector: SectorStat }) {
  const cls = CONSISTENCY_CLASS[sector.consistency] ?? "";
  return (
    <div className={`sector-detail ${cls}`}>
      <span>S{sector.sector}</span>
      <strong>{sector.consistency}</strong>
      <div><b>Melhor</b>{sector.best.toFixed(3)}s</div>
      <div><b>Média</b>{sector.mean.toFixed(3)}s</div>
      <div><b>Δ</b><em className={sector.mean - sector.best <= 0.05 ? "positive" : "negative"}>{(sector.mean - sector.best).toFixed(3)}s</em></div>
      {sector.note && <p>{sector.note}</p>}
    </div>
  );
}

export default function SectorConsistency({ category, trackOutline }: { category: SectorCategory; trackOutline?: TrackOutlinePoint[] | null }) {
  const [categories, setCategories] = useState<Record<SectorCategory, CategoryPayload> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/telemetry/sectors", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok") throw new Error(result.message ?? "Erro ao calcular consistência por setor");
        setCategories(result.categories);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  if (loading) return <div className="telemetry-state">Juntando as voltas mais rápidas dessa corrida para calcular sua volta ideal...</div>;
  if (error) return <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={() => setRetryCount((count) => count + 1)}>Tentar novamente</button></div>;

  const data = categories?.[category];

  return (
    <div className="sector-consistency">
      {!data?.report ? (
        <div className="telemetry-state">{data?.message ?? "Sem dados suficientes ainda."}</div>
      ) : (
        <>
          <div className="race-debrief-header">
            <span className="section-kicker">CONSISTÊNCIA POR SETOR • VOLTAS MAIS RÁPIDAS DA CORRIDA</span>
            <h4>Sua volta ideal, setor a setor</h4>
            <p>{data.report.lapsAnalyzed} voltas mais rápidas dessa corrida — as mesmas usadas acima, para os dois contarem a mesma história.</p>
          </div>

          <div className="race-debrief-summary">
            <p>{data.report.summary}</p>
            <div className="race-debrief-metrics">
              <div><span>VOLTA IDEAL</span><strong>{data.report.idealLap}</strong></div>
              <div><span>MELHOR VOLTA REAL</span><strong>{data.report.actualBestLap}</strong></div>
              <div><span>TEMPO NA MESA</span><strong className="negative">{data.report.gapToIdeal}s</strong></div>
              <div><span>SETORES</span><strong>{data.report.sectors.length}</strong></div>
            </div>
          </div>

          <div className="sector-map-layout">
            {trackOutline && <SectorTrackMap sectors={data.report.sectors} outline={trackOutline} />}
            <div className="sector-detail-list">
              {data.report.sectors.map((sector) => <SectorDetail key={sector.sector} sector={sector} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
