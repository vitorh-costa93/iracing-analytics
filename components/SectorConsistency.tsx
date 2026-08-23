"use client";

import { useEffect, useState } from "react";

type SectorStat = { sector: number; sampleSize: number; mean: number; stddev: number; best: number; consistency: string };
type SectorReport = { car: string; track: string; lapsAnalyzed: number; sectors: SectorStat[]; idealLap: string; actualBestLap: string; gapToIdeal: string; summary: string };
type CategoryPayload = { status: string; report: SectorReport | null; message?: string | null };
type Category = "formula_car" | "sports_car" | "gtp_car";

const CATEGORIES: Category[] = ["formula_car", "sports_car", "gtp_car"];
const CATEGORY_LABEL: Record<Category, string> = { formula_car: "Formula Car", sports_car: "Sports Car", gtp_car: "GTP" };
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
    </div>
  );
}

export default function SectorConsistency() {
  const [categories, setCategories] = useState<Record<Category, CategoryPayload> | null>(null);
  const [selected, setSelected] = useState<Category>("formula_car");
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
        if (!result.categories?.formula_car?.report) {
          const fallback = CATEGORIES.find((category) => result.categories?.[category]?.report);
          if (fallback) setSelected(fallback);
        }
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  if (loading) return <div className="telemetry-state">Juntando todas as voltas já registradas nesse carro/pista para calcular sua volta ideal...</div>;
  if (error) return <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={() => setRetryCount((count) => count + 1)}>Tentar novamente</button></div>;

  const data = categories?.[selected];

  return (
    <div className="sector-consistency">
      <div className="race-debrief-category-toggle">
        {CATEGORIES.map((category) => (
          <button key={category} className={selected === category ? "active" : ""} onClick={() => setSelected(category)}>{CATEGORY_LABEL[category]}</button>
        ))}
      </div>

      {!data?.report ? (
        <div className="telemetry-state">{data?.message ?? "Sem dados suficientes ainda."}</div>
      ) : (
        <>
          <div className="race-debrief-header">
            <span className="section-kicker">CONSISTÊNCIA POR SETOR • TODAS AS VOLTAS</span>
            <h3>{data.report.car} — {data.report.track}</h3>
            <p>{data.report.lapsAnalyzed} voltas limpas analisadas (todo o período com dados), não só a última corrida.</p>
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
