"use client";

import { useEffect, useState } from "react";

type Point = { sessionId: number; category: "formula_car" | "sports_car"; offtrackLaps: number; deltaIrating: number };
type Payload = {
  status: string; available: boolean; message?: string; pairsAnalyzed?: number; paceRowsAnalyzed?: number;
  correlation?: { all: number | null; formula_car: number | null; sports_car: number | null };
  correlationText?: string; paceText?: string; points?: Point[];
};

function ScatterChart({ points }: { points: Point[] }) {
  const width = 640, height = 300, pad = { left: 50, right: 16, top: 14, bottom: 34 };
  const xs = points.map((p) => p.offtrackLaps), ys = points.map((p) => p.deltaIrating);
  const xMax = Math.max(...xs, 1);
  const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
  const ySpan = Math.max(1, yMax - yMin);
  const x = (value: number) => pad.left + (value / xMax) * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - ((value - yMin) / ySpan) * (height - pad.top - pad.bottom);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="safety-scatter" role="img" aria-label="Dispersão de voltas fora da pista por Δ iRating, uma corrida por ponto">
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} className="safety-scatter-axis" />
      <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="safety-scatter-axis" />
      <text x={pad.left} y={height - pad.bottom + 16} textAnchor="middle" className="safety-scatter-label">0 voltas</text>
      <text x={pad.left - 8} y={y(0) + 4} textAnchor="end" className="safety-scatter-label">iR 0</text>
      <text x={width - pad.right} y={height - pad.bottom + 16} textAnchor="end" className="safety-scatter-label">{xMax} voltas</text>
      <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="safety-scatter-label">iR {signed(Math.round(yMax))}</text>
      {points.map((point, index) => (
        <circle key={index} cx={x(point.offtrackLaps)} cy={y(point.deltaIrating)} r="4"
          className={point.category === "formula_car" ? "safety-dot formula" : "safety-dot sports"} />
      ))}
    </svg>
  );
}

function signed(value: number) { return `${value > 0 ? "+" : ""}${value}`; }

export default function IncidentCorrelation() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/dashboard/incident-correlation", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => { if (active) { if (result.status !== "ok") throw new Error(result.message); setData(result); } })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [retryCount]);

  if (loading) return <div className="telemetry-state">Cruzando voltas fora da pista com o Δ iRating de cada corrida...</div>;
  if (error) return <div className="telemetry-state error">{error}<button type="button" className="retry-button" onClick={() => setRetryCount((count) => count + 1)}>Tentar novamente</button></div>;
  if (!data?.available) return <div className="telemetry-state">{data?.message ?? "Sem dados suficientes."}</div>;

  const points = data.points ?? [];
  const correlation = data.correlation;

  return (
    <div className="safety-correlation">
      <div className="race-debrief-summary">
        <p>{data.correlationText}</p>
        <p>{data.paceText}</p>
        <div className="race-debrief-metrics">
          <div><span>CORRIDAS ANALISADAS</span><strong>{data.pairsAnalyzed}</strong></div>
          <div><span>CORRELAÇÃO GERAL (r)</span><strong>{correlation?.all?.toFixed(2) ?? "—"}</strong></div>
          <div><span>FORMULA CAR (r)</span><strong>{correlation?.formula_car?.toFixed(2) ?? "—"}</strong></div>
          <div><span>SPORTS CAR (r)</span><strong>{correlation?.sports_car?.toFixed(2) ?? "—"}</strong></div>
        </div>
      </div>
      <div className="race-debrief-chart-block">
        <span className="section-kicker">DISPERSÃO</span>
        <h4>Voltas fora da pista × Δ iRating, uma corrida por ponto</h4>
        <p className="race-debrief-channels-note">Ciano = Formula Car, âmbar = Sports Car. "Fora da pista" é o sinal mais próximo de incidente que a Garage61 expõe — não existe um contador de incidentes bruto na API, então isso é o proxy real disponível.</p>
        <ScatterChart points={points} />
        <div className="safety-scatter-legend">
          <span className="formula">Formula Car</span>
          <span className="sports">Sports Car</span>
        </div>
      </div>
    </div>
  );
}
