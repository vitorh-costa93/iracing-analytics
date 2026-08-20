"use client";

import { useMemo, useState } from "react";

export type RaceScatterPoint = { id: number; durationMinutes: number; delta: number; car: string; track: string; startedAt: string };

export default function RaceScatterPlot({ points }: { points: RaceScatterPoint[] }) {
  const [hovered, setHovered] = useState<RaceScatterPoint | null>(null);
  const width = 640, height = 290, pad = { left: 48, right: 18, top: 18, bottom: 38 };
  const bounds = useMemo(() => ({
    maxX: Math.max(10, ...points.map((point) => point.durationMinutes)),
    maxY: Math.max(25, ...points.map((point) => Math.abs(point.delta))),
  }), [points]);
  const x = (value: number) => pad.left + value / bounds.maxX * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (bounds.maxY - value) / (bounds.maxY * 2) * (height - pad.top - pad.bottom);

  if (!points.length) return <div className="ranking-empty">Sem corridas associadas a uma variação de iRating.</div>;
  return <div className="scatter-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dispersão entre duração da corrida e variação de iRating">
      {[-1, -.5, 0, .5, 1].map((ratio) => <g key={ratio}><line x1={pad.left} x2={width - pad.right} y1={y(bounds.maxY * ratio)} y2={y(bounds.maxY * ratio)} className={ratio === 0 ? "scatter-zero" : "scatter-grid"} /><text x={pad.left - 8} y={y(bounds.maxY * ratio) + 4} textAnchor="end">{Math.round(bounds.maxY * ratio)}</text></g>)}
      {[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={x(bounds.maxX * ratio)} x2={x(bounds.maxX * ratio)} y1={pad.top} y2={height - pad.bottom} className="scatter-grid" /><text x={x(bounds.maxX * ratio)} y={height - 13} textAnchor="middle">{Math.round(bounds.maxX * ratio)} min</text></g>)}
      {points.map((point) => <circle key={point.id} cx={x(point.durationMinutes)} cy={y(point.delta)} r="5" className={point.delta >= 0 ? "scatter-positive" : "scatter-negative"} onMouseEnter={() => setHovered(point)} onMouseLeave={() => setHovered(null)} />)}
    </svg>
    {hovered && <div className="scatter-tooltip"><strong>{hovered.delta > 0 ? "+" : ""}{hovered.delta} iRating</strong><span>{hovered.durationMinutes.toFixed(1)} min • {hovered.car}</span><span>{hovered.track} • {new Date(hovered.startedAt).toLocaleDateString("pt-BR")}</span></div>}
  </div>;
}
