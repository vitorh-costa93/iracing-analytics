"use client";

import { useEffect, useState } from "react";

type SectorStat = { sector: number; sampleSize: number; mean: number; stddev: number; best: number; consistency: string; note: string | null };
type SectorReport = { car: string; track: string; lapsAnalyzed: number; sectors: SectorStat[]; idealLap: string; actualBestLap: string; gapToIdeal: string; summary: string };
type CategoryPayload = { status: string; report: SectorReport | null; message?: string | null };
export type SectorCategory = "formula_car" | "sports_car" | "gtp_car";

const CONSISTENCY_CLASS: Record<string, string> = { "muito consistente": "great", "consistente": "good", "variável": "warn", "muito inconsistente": "bad" };

function SectorBar({ sector }: { sector: SectorStat }) {
  const range = Math.max(sector.mean - sector.best, 0.02);
  const spread = Math.min(100, (sector.stddev / range) * 60 + 8);
  return (
    <div className={`sector-row ${CONSISTENCY_CLASS[sector.consistency] ?? ""}`}>
      <span className="sector-number">S{sector.sector}</span>
      <div className="sector-track">
        <div className="sector-spread" style={{ width: `${spread}%` }} />
        <div className="sector-best-marker" />
      </div>
      <span className="sector-consistency">{sector.consistency}</span>
      <span className="sector-times">melhor {sector.best.toFixed(3)}s • média {sector.mean.toFixed(3)}s</span>
      {sector.note && <span className="sector-note">{sector.note}</span>}
    </div>
  );
}

export default function SectorConsistency({ category }: { category: SectorCategory }) {
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

          <div className="sector-list">
            {data.report.sectors.map((sector) => <SectorBar key={sector.sector} sector={sector} />)}
          </div>
        </>
      )}
    </div>
  );
}
