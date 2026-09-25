"use client";

import { useMemo, useState } from "react";
import { signedNumber } from "./format";

export type RaceScatterPoint = { id: number; durationMinutes: number | null; delta: number; car: string; track: string; startedAt: string };
type Plottable = RaceScatterPoint & { durationMinutes: number };

// Geometria do mockup (B.dc.html): viewBox 860×240, plano de x=60..840 e y=14..200.
const X0 = 60, X1 = 840, Y0 = 14, Y1 = 200;

/** Dispersão "Duração × Δ iRating" no Night Grid. Mesma lógica de antes: só pontos com duração
 * estimada; eixo Y simétrico em torno de zero; pontos verdes (ganho) e vermelhos (perda). O
 * tooltip é desenhado no próprio SVG (como no mockup); o toque alterna o ponto, já que mouseenter
 * não dispara no celular. */
export default function RaceScatter({ points }: { points: RaceScatterPoint[] }) {
  const [hovered, setHovered] = useState<Plottable | null>(null);
  const plottable = useMemo(() => points.filter((p): p is Plottable => p.durationMinutes !== null), [points]);
  const maxX = Math.max(10, ...plottable.map((p) => p.durationMinutes));
  const maxY = Math.max(25, Math.ceil(Math.max(0, ...plottable.map((p) => Math.abs(p.delta))) / 25) * 25);
  const x = (m: number) => X0 + (m / maxX) * (X1 - X0);
  const y = (d: number) => (Y0 + Y1) / 2 - (d / maxY) * ((Y1 - Y0) / 2);

  if (!plottable.length) return <div className="ngo-empty">Sem dados de duração de corrida disponíveis para este gráfico.</div>;

  let tip: { x: number; y: number } | null = null;
  if (hovered) {
    const px = x(hovered.durationMinutes), py = y(hovered.delta);
    const tx = px - 210 < 60 ? px + 14 : px - 210;
    tip = { x: Math.min(tx, 850 - 196), y: Math.min(Math.max(py - 24, 4), 190) };
  }

  return (
    <svg className="ngo-scatter" viewBox="0 0 860 240" role="img" aria-label="Dispersão entre duração da corrida e variação de iRating">
      {[-1, -0.5, 0, 0.5, 1].map((r) => (
        <g key={r}>
          <line x1={56} x2={850} y1={y(maxY * r)} y2={y(maxY * r)} stroke={r === 0 ? "#5C6A9E" : "var(--ng-line)"} strokeWidth={1} />
          <text x={46} y={y(maxY * r) + 4} textAnchor="end" fontSize={12} fill="var(--ng-soft)">{r === 0 ? "0" : signedNumber(Math.round(maxY * r))}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <g key={r}>
          <line x1={x(maxX * r)} x2={x(maxX * r)} y1={14} y2={200} stroke="var(--ng-line)" strokeWidth={1} />
          <text x={x(maxX * r)} y={222} textAnchor="middle" fontSize={12} fill="var(--ng-soft)">{Math.round(maxX * r)} min</text>
        </g>
      ))}
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
          <rect x={tip.x} y={tip.y} width={196} height={50} rx={6} fill="var(--ng-header)" stroke="var(--ng-tooltip-border)" />
          <text x={tip.x + 12} y={tip.y + 18} fontSize={13} fontWeight={600} fill={hovered.delta >= 0 ? "var(--ng-gain)" : "var(--ng-loss)"}>{signedNumber(hovered.delta)} iRating</text>
          <text x={tip.x + 12} y={tip.y + 33} fontSize={11.5} fill="var(--ng-text-2)">{hovered.durationMinutes.toFixed(1).replace(".", ",")} min · {hovered.car.length > 26 ? hovered.car.slice(0, 25) + "…" : hovered.car}</text>
          <text x={tip.x + 12} y={tip.y + 46} fontSize={11.5} fill="var(--ng-muted)">{hovered.track.length > 24 ? hovered.track.slice(0, 23) + "…" : hovered.track} · {new Date(hovered.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>
        </g>
      )}
      <text x={14} y={107} fontSize={12} fill="var(--ng-soft)" transform="rotate(-90 14 107)" textAnchor="middle">Δ iRating</text>
    </svg>
  );
}
