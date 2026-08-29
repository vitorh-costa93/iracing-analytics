"use client";

import { useMemo, useState } from "react";

export type RaceScatterPoint = { id: number; durationMinutes: number | null; delta: number; car: string; track: string; startedAt: string };

type PlottablePoint = RaceScatterPoint & { durationMinutes: number };

export default function RaceScatterPlot({ points }: { points: RaceScatterPoint[] }) {
  const [hovered, setHovered] = useState<PlottablePoint | null>(null);
  const width = 640, height = 290, pad = { left: 48, right: 18, top: 18, bottom: 38 };
  // durationMinutes is an estimate (laps × pace) computed server-side, null only when a race's
  // page had no fastest-lap field to estimate pace from at all (rare parsing gap, not the norm).
  // Points without a duration can't be placed on this axis, so they're dropped rather than crashing.
  const plottable = useMemo<PlottablePoint[]>(
    () => points.filter((point): point is PlottablePoint => point.durationMinutes !== null),
    [points]
  );
  const bounds = useMemo(() => ({
    maxX: Math.max(10, ...plottable.map((point) => point.durationMinutes)),
    maxY: Math.max(25, ...plottable.map((point) => Math.abs(point.delta))),
  }), [plottable]);
  const x = (value: number) => pad.left + value / bounds.maxX * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (bounds.maxY - value) / (bounds.maxY * 2) * (height - pad.top - pad.bottom);

  if (!plottable.length) return <div className="ranking-empty">Sem dados de duração de corrida disponíveis para este gráfico.</div>;
  return <div className="scatter-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dispersão entre duração da corrida e variação de iRating">
      {[-1, -.5, 0, .5, 1].map((ratio) => <g key={ratio}><line x1={pad.left} x2={width - pad.right} y1={y(bounds.maxY * ratio)} y2={y(bounds.maxY * ratio)} className={ratio === 0 ? "scatter-zero" : "scatter-grid"} /><text x={pad.left - 8} y={y(bounds.maxY * ratio) + 4} textAnchor="end">{Math.round(bounds.maxY * ratio)}</text></g>)}
      {[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={x(bounds.maxX * ratio)} x2={x(bounds.maxX * ratio)} y1={pad.top} y2={height - pad.bottom} className="scatter-grid" /><text x={x(bounds.maxX * ratio)} y={height - 13} textAnchor="middle">{Math.round(bounds.maxX * ratio)} min</text></g>)}
      {/* r=5 is the visible dot; a separate transparent r=13 sits on top purely as a bigger touch
       * target (mouseenter/leave never fires on tap, so onClick toggles the tooltip there too). */}
      {plottable.map((point) => <g key={point.id}>
        <circle cx={x(point.durationMinutes)} cy={y(point.delta)} r="5" className={point.delta >= 0 ? "scatter-positive" : "scatter-negative"} />
        <circle cx={x(point.durationMinutes)} cy={y(point.delta)} r="13" className="scatter-hit" onMouseEnter={() => setHovered(point)} onMouseLeave={() => setHovered(null)} onClick={() => setHovered((existing) => existing?.id === point.id ? null : point)} />
      </g>)}
    </svg>
    {hovered && <div className="scatter-tooltip"><strong>{hovered.delta > 0 ? "+" : ""}{hovered.delta} iRating</strong><span>{hovered.durationMinutes.toFixed(1)} min • {hovered.car}</span><span>{hovered.track} • {new Date(hovered.startedAt).toLocaleDateString("pt-BR")}</span></div>}
  </div>;
}
