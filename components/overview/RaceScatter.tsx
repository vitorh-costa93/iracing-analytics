"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { signedNumber } from "./format";

export type RaceScatterPoint = { id: number; durationMinutes: number | null; delta: number; car: string; track: string; startedAt: string };
type Plottable = RaceScatterPoint & { durationMinutes: number };

/** Dispersão "Duração × Δ iRating" no Night Grid. Mede o container com ResizeObserver para manter
 * o viewBox em escala 1:1 (px reais), evitando zoom/distorção nas fontes dos eixos no desktop e mobile. */
export default function RaceScatter({ points, tall = false }: { points: RaceScatterPoint[]; tall?: boolean }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>(() => (tall ? { w: 680, h: 290 } : { w: 860, h: 240 }));
  const [hovered, setHovered] = useState<Plottable | null>(null);
  const plottable = useMemo(() => points.filter((p): p is Plottable => p.durationMinutes !== null), [points]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w >= 180 && h >= 120) {
        setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [plottable.length]);

  const vw = size.w;
  const vh = size.h;
  const x0 = 58, x1 = vw - 18, y0 = 14, y1 = vh - 32;
  const maxX = Math.max(10, ...plottable.map((p) => p.durationMinutes));
  const maxY = Math.max(25, Math.ceil(Math.max(0, ...plottable.map((p) => Math.abs(p.delta))) / 25) * 25);
  const x = (m: number) => x0 + (m / maxX) * (x1 - x0);
  const y = (d: number) => (y0 + y1) / 2 - (d / maxY) * ((y1 - y0) / 2);

  if (!plottable.length) return <div className="ngo-empty">Sem dados de duração de corrida disponíveis para este gráfico.</div>;

  let tip: { x: number; y: number } | null = null;
  if (hovered) {
    const px = x(hovered.durationMinutes), py = y(hovered.delta);
    const tx = px - 224 < x0 ? px + 14 : px - 224;
    tip = { x: Math.min(tx, vw - 222), y: Math.min(Math.max(py - 24, 4), vh - 54) };
  }

  return (
    <svg ref={svgRef} className="ngo-scatter" viewBox={`0 0 ${vw} ${vh}`} role="img" aria-label="Dispersão entre duração da corrida e variação de iRating">
      {[-1, -0.5, 0, 0.5, 1].map((r) => (
        <g key={r}>
          <line x1={x0 - 4} x2={vw - 10} y1={y(maxY * r)} y2={y(maxY * r)} stroke={r === 0 ? "#5C6A9E" : "var(--ng-line)"} strokeWidth={1} />
          <text x={x0 - 12} y={y(maxY * r) + 4} textAnchor="end" fontSize={11} fill="var(--ng-soft)">{r === 0 ? "0" : signedNumber(Math.round(maxY * r))}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => {
        const anchor = r === 0 ? "start" : r === 1 ? "end" : "middle";
        return (
          <g key={r}>
            <line x1={x(maxX * r)} x2={x(maxX * r)} y1={y0} y2={y1} stroke="var(--ng-line)" strokeWidth={1} />
            <text x={x(maxX * r)} y={vh - 10} textAnchor={anchor} fontSize={11} fill="var(--ng-soft)">{Math.round(maxX * r)} min</text>
          </g>
        );
      })}
      {plottable.map((p) => {
        const active = hovered?.id === p.id;
        return (
          <g key={p.id}>
            <circle cx={x(p.durationMinutes)} cy={y(p.delta)} r={active ? 6.5 : 5} fill={p.delta >= 0 ? "var(--ng-gain)" : "var(--ng-loss)"} fillOpacity={0.9} stroke={active ? "#FFFFFF" : "none"} strokeWidth={active ? 2 : 0} />
            <circle cx={x(p.durationMinutes)} cy={y(p.delta)} r={13} fill="transparent" style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(p)} onMouseLeave={() => setHovered(null)}
              onClick={() => setHovered((e) => (e?.id === p.id ? null : p))} />
          </g>
        );
      })}
      {hovered && tip && (
        <g pointerEvents="none">
          <rect x={tip.x} y={tip.y} width={214} height={48} rx={6} fill="var(--ng-header)" stroke="var(--ng-tooltip-border)" />
          <text x={tip.x + 10} y={tip.y + 16} fontSize={11.5} fontWeight={600} fill={hovered.delta >= 0 ? "var(--ng-gain)" : "var(--ng-loss)"}>{signedNumber(hovered.delta)} iRating</text>
          <text x={tip.x + 10} y={tip.y + 30} fontSize={10} fill="var(--ng-text-2)">{hovered.durationMinutes.toFixed(1).replace(".", ",")} min · {hovered.car.length > 26 ? hovered.car.slice(0, 25) + "…" : hovered.car}</text>
          <text x={tip.x + 10} y={tip.y + 42} fontSize={10} fill="var(--ng-muted)">{hovered.track.length > 26 ? hovered.track.slice(0, 25) + "…" : hovered.track} · {new Date(hovered.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>
        </g>
      )}
      <text x={14} y={(y0 + y1) / 2} fontSize={11} fill="var(--ng-soft)" transform={`rotate(-90 14 ${(y0 + y1) / 2})`} textAnchor="middle">Δ iRating</text>
    </svg>
  );
}
