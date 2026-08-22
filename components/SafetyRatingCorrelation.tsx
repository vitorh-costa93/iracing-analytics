"use client";

import { useEffect, useState } from "react";

type Point = { sessionId: number; category: "formula_car" | "sports_car"; ratingAt: string; deltaIRating: number; deltaSafetyRating: number };
type Payload = {
  status: string; available: boolean; message?: string; pairsAnalyzed?: number;
  correlation?: { all: number | null; formula_car: number | null; sports_car: number | null };
  summary?: string; points?: Point[];
};

function ScatterChart({ points }: { points: Point[] }) {
  const width = 640, height = 300, pad = { left: 50, right: 16, top: 14, bottom: 34 };
  const xs = points.map((p) => p.deltaSafetyRating), ys = points.map((p) => p.deltaIRating);
  const xMin = Math.min(...xs, 0), xMax = Math.max(...xs, 0);
  const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
  const xSpan = Math.max(1, xMax - xMin), ySpan = Math.max(1, yMax - yMin);
  const x = (value: number) => pad.left + ((value - xMin) / xSpan) * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - ((value - yMin) / ySpan) * (height - pad.top - pad.bottom);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="safety-scatter" role="img" aria-label="Dispersão de Δ Safety Rating por Δ iRating, uma corrida por ponto">
      <line x1={x(0)} x2={x(0)} y1={pad.top} y2={height - pad.bottom} className="safety-scatter-axis" />
      <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="safety-scatter-axis" />
      <text x={x(0)} y={height - pad.bottom + 16} textAnchor="middle" className="safety-scatter-label">SR 0</text>
      <text x={pad.left - 8} y={y(0) + 4} textAnchor="end" className="safety-scatter-label">iR 0</text>
      <text x={width - pad.right} y={height - pad.bottom + 16} textAnchor="end" className="safety-scatter-label">SR {signed(Math.round(xMax))}</text>
      <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="safety-scatter-label">iR {signed(Math.round(yMax))}</text>
      {points.map((point, index) => (
        <circle key={index} cx={x(point.deltaSafetyRating)} cy={y(point.deltaIRating)} r="4"
          className={point.category === "formula_car" ? "safety-dot formula" : "safety-dot sports"} />
      ))}
    </svg>
  );
}

function signed(value: number) { return `${value > 0 ? "+" : ""}${value}`; }

export default function SafetyRatingCorrelation() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/safety-rating", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => { if (active) { if (result.status !== "ok") throw new Error(result.message); setData(result); } })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) return null;
  if (error) return <div className="telemetry-state error">{error}</div>;
  if (!data?.available) return <div className="telemetry-state">{data?.message ?? "Sem dados suficientes."}</div>;

  const points = data.points ?? [];
  const correlation = data.correlation;

  return (
    <div className="safety-correlation">
      <div className="race-debrief-summary">
        <p>{data.summary}</p>
        <div className="race-debrief-metrics">
          <div><span>PARES ANALISADOS</span><strong>{data.pairsAnalyzed}</strong></div>
          <div><span>CORRELAÇÃO GERAL (r)</span><strong>{correlation?.all?.toFixed(2) ?? "—"}</strong></div>
          <div><span>FORMULA CAR (r)</span><strong>{correlation?.formula_car?.toFixed(2) ?? "—"}</strong></div>
          <div><span>SPORTS CAR (r)</span><strong>{correlation?.sports_car?.toFixed(2) ?? "—"}</strong></div>
        </div>
      </div>
      <div className="race-debrief-chart-block">
        <span className="section-kicker">DISPERSÃO</span>
        <h4>Δ Safety Rating × Δ iRating, uma corrida por ponto</h4>
        <p className="race-debrief-channels-note">Ciano = Formula Car, âmbar = Sports Car. Cada ponto é uma corrida onde as duas mudanças foram registradas no mesmo instante.</p>
        <ScatterChart points={points} />
        <div className="safety-scatter-legend">
          <span className="formula">Formula Car</span>
          <span className="sports">Sports Car</span>
        </div>
      </div>
    </div>
  );
}
