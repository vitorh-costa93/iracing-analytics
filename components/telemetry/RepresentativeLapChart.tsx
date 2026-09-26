"use client";

import type { KeyboardEvent, MouseEvent, TouchEvent } from "react";
import { lostAt, type LapComparison } from "@/lib/lap-analysis";
import { unwrapIntoWindow } from "@/lib/corner-sequences";
import { interpolate, type Trace, type TracePoint } from "@/lib/telemetry-trace";

/**
 * Painel "volta representativa" (Telemetry.dc.html): tempo perdido acumulado contra a referência e,
 * embaixo, acelerador e freio (você x referência) na mesma escala de distância. O hover mostra um
 * cursor ligado à bolinha do mapa Track Position e um quadro com acelerador, freio, velocidade e
 * marcha dos dois naquele ponto. Geometria do SVG igual à do mockup (viewBox 900 x 372).
 */
const W = 900, H = 372, X0 = 44, X1 = 884;
const DELTA_TOP = 28, DELTA_BOTTOM = 112;
const THR_TOP = 152, THR_BOTTOM = 212;
const BRK_TOP = 238, BRK_BOTTOM = 298;
const CHART_BOTTOM = 332;

const xOf = (distance: number) => X0 + (distance / 100) * (X1 - X0);

function pedalLine(points: TracePoint[], field: "throttle" | "brake", top: number, bottom: number) {
  const step = Math.max(1, Math.floor(points.length / 700));
  return points
    .filter((point, index) => index % step === 0 && point[field] !== null && Number.isFinite(point[field]))
    .map((point) => `${xOf(Math.max(0, Math.min(100, point.distance))).toFixed(1)},${(bottom - Math.max(0, Math.min(1, Number(point[field]))) * (bottom - top)).toFixed(1)}`)
    .join(" ");
}

function niceStep(span: number) {
  const raw = span / 3;
  for (const step of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]) if (raw <= step) return step;
  return 10;
}

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`);
const kmh = (value: number | null) => (value === null ? "—" : `${Math.round(value * 3.6)} km/h`);
const gear = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return rounded === 0 ? "N" : rounded < 0 ? "R" : `${rounded}ª`;
};

export default function RepresentativeLapChart({ trace, referenceTrace, comparison, sectionName, hover, onHover }: {
  trace: Trace;
  referenceTrace: Trace;
  comparison: LapComparison;
  sectionName: (distance: number) => string | null;
  hover: number | null;
  onHover: (distance: number | null) => void;
}) {
  const grid = comparison.grid;
  const values = grid.map((sample) => sample.lostSoFar);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const step = niceStep(Math.max(0.15, hi - lo));
  const vMin = Math.floor(lo / step) * step, vMax = Math.max(vMin + step, Math.ceil(hi / step) * step);
  const yD = (value: number) => DELTA_BOTTOM - ((value - vMin) / (vMax - vMin)) * (DELTA_BOTTOM - DELTA_TOP);
  const ticks: number[] = [];
  for (let v = vMin; v <= vMax + 1e-9; v += step) ticks.push(Number(v.toFixed(3)));
  const tickLabel = (v: number) => (Math.abs(v) < 1e-9 ? "0" : `${v > 0 ? "+" : "−"}${String(Math.abs(v)).replace(".", ",")}`);
  const deltaLine = grid.map((sample) => `${xOf(sample.distance).toFixed(1)},${yD(sample.lostSoFar).toFixed(1)}`).join(" ");

  const length = comparison.trackLengthMeters;
  const xTicks = [0, 1, 2, 3, 4, 5].map((k) => ({ x: xOf(k * 20), label: length ? `${Math.round((k / 5) * length).toLocaleString("pt-BR")} m` : `${k * 20}%` }));

  function toDistance(clientX: number, svg: SVGSVGElement) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = 0;
    const local = point.matrixTransform(ctm.inverse());
    return Math.max(0, Math.min(100, ((local.x - X0) / (X1 - X0)) * 100));
  }
  const onMove = (event: MouseEvent<SVGSVGElement>) => onHover(toDistance(event.clientX, event.currentTarget));
  const onTouch = (event: TouchEvent<SVGSVGElement>) => { if (event.touches[0]) onHover(toDistance(event.touches[0].clientX, event.currentTarget)); };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const stepPct = event.shiftKey ? 5 : 0.5;
    if (event.key === "ArrowRight") { event.preventDefault(); onHover(Math.min(100, (hover ?? 0) + stepPct)); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); onHover(Math.max(0, (hover ?? 0) - stepPct)); }
    else if (event.key === "Home") { event.preventDefault(); onHover(0); }
    else if (event.key === "End") { event.preventDefault(); onHover(100); }
    else if (event.key === "Escape") onHover(null);
  };

  let cursor = null;
  if (hover !== null) {
    const x = xOf(hover);
    const own = (field: "throttle" | "brake" | "speed" | "gear") => interpolate(trace.points, hover, field);
    const ref = (field: "throttle" | "brake" | "speed" | "gear") => interpolate(referenceTrace.points, hover, field);
    const thrO = own("throttle"), thrR = ref("throttle"), brkO = own("brake"), brkR = ref("brake");
    const yPedal = (value: number | null, top: number, bottom: number) => bottom - Math.max(0, Math.min(1, value ?? 0)) * (bottom - top);
    const flip = x + 14 + 250 > W;
    const boxX = flip ? x - 14 - 250 : x + 14;
    const name = sectionName(hover);
    const where = length ? `${Math.round((hover / 100) * length).toLocaleString("pt-BR")} m` : `${hover.toFixed(1).replace(".", ",")}%`;
    const rows: [string, string, string][] = [
      ["Acelerador", pct(thrO), pct(thrR)],
      ["Freio", pct(brkO), pct(brkR)],
      ["Velocidade", kmh(own("speed")), kmh(ref("speed"))],
      ["Marcha", gear(own("gear")), gear(ref("gear"))],
    ];
    cursor = (
      <g pointerEvents="none">
        <line x1={x} x2={x} y1="6" y2={CHART_BOTTOM} className="ngt-cursor" />
        <circle cx={x} cy={yD(lostAt(grid, hover))} r="4.5" fill="var(--ng-loss)" stroke="var(--ng-card)" strokeWidth="2" />
        {thrO !== null && <circle cx={x} cy={yPedal(thrO, THR_TOP, THR_BOTTOM)} r="4" fill="var(--ng-text)" />}
        {thrR !== null && <circle cx={x} cy={yPedal(thrR, THR_TOP, THR_BOTTOM)} r="4" fill="var(--ng-reference)" />}
        {brkO !== null && <circle cx={x} cy={yPedal(brkO, BRK_TOP, BRK_BOTTOM)} r="4" fill="var(--ng-text)" />}
        {brkR !== null && <circle cx={x} cy={yPedal(brkR, BRK_TOP, BRK_BOTTOM)} r="4" fill="var(--ng-reference)" />}
        <rect x={boxX} y="24" width="250" height="122" rx="8" className="ngt-tip-box" />
        <text x={boxX + 12} y="46" className="ngt-tip-title">{name ? `${name} · ${where}` : `Reta · ${where}`}</text>
        <text x={boxX + 156} y="64" textAnchor="end" className="ngt-tip-head-own">Você</text>
        <text x={boxX + 226} y="64" textAnchor="end" className="ngt-tip-head-ref">Referência</text>
        {rows.map(([label, o, r], index) => (
          <g key={label}>
            <text x={boxX + 12} y={84 + index * 18} className="ngt-tip-key">{label}</text>
            <text x={boxX + 156} y={84 + index * 18} textAnchor="end" className="ngt-tip-own">{o}</text>
            <text x={boxX + 226} y={84 + index * 18} textAnchor="end" className="ngt-tip-ref">{r}</text>
          </g>
        ))}
      </g>
    );
  }

  return (
    <svg className="ngt-chart" viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
      aria-label="Tempo perdido acumulado contra a referência, acelerador e freio ao longo da volta. Setas esquerda e direita percorrem a pista."
      onMouseMove={onMove} onMouseLeave={() => onHover(null)} onTouchStart={onTouch} onTouchMove={onTouch} onKeyDown={onKey}>
      {comparison.sections.map((section) => {
        const loss = section.lostSeconds > 0.005;
        const pieces: [number, number][] = [];
        const a = section.start, b = section.end;
        if (a < 0) { pieces.push([a + 100, 100], [0, b]); } else if (b > 100) { pieces.push([a, 100], [0, b - 100]); } else pieces.push([a, b]);
        return pieces.map(([from, to], index) => (
          <rect key={`${section.id}-${index}`} x={xOf(from)} y="6" width={Math.max(1, xOf(to) - xOf(from))} height={CHART_BOTTOM - 6} fill={loss ? "var(--ng-loss)" : "var(--ng-gain)"} fillOpacity="0.07" />
        ));
      })}
      <text x="8" y="16" className="ngt-axis-label">TEMPO PERDIDO (s)</text>
      {ticks.map((value) => (
        <g key={value}>
          <line x1={X0} x2={X1} y1={yD(value)} y2={yD(value)} className={Math.abs(value) < 1e-9 ? "ngt-grid-zero" : "ngt-grid-line"} />
          <text x={X0 - 6} y={yD(value) + 4} textAnchor="end" className="ngt-axis-label">{tickLabel(value)}</text>
        </g>
      ))}
      <polyline points={deltaLine} className="ngt-delta-line" />

      <text x="8" y={THR_TOP - 6} className="ngt-axis-label">ACELERADOR</text>
      <line x1={X0} x2={X1} y1={THR_TOP} y2={THR_TOP} className="ngt-grid-line" />
      <line x1={X0} x2={X1} y1={THR_BOTTOM} y2={THR_BOTTOM} className="ngt-grid-line" />
      <polyline points={pedalLine(referenceTrace.points, "throttle", THR_TOP, THR_BOTTOM)} className="ngt-ref-line" />
      <polyline points={pedalLine(trace.points, "throttle", THR_TOP, THR_BOTTOM)} className="ngt-own-line" />

      <text x="8" y={BRK_TOP - 6} className="ngt-axis-label">FREIO</text>
      <line x1={X0} x2={X1} y1={BRK_TOP} y2={BRK_TOP} className="ngt-grid-line" />
      <line x1={X0} x2={X1} y1={BRK_BOTTOM} y2={BRK_BOTTOM} className="ngt-grid-line" />
      <polyline points={pedalLine(referenceTrace.points, "brake", BRK_TOP, BRK_BOTTOM)} className="ngt-ref-line" />
      <polyline points={pedalLine(trace.points, "brake", BRK_TOP, BRK_BOTTOM)} className="ngt-own-line" />

      {xTicks.map((tick) => <text key={tick.x} x={tick.x} y="356" textAnchor="middle" className="ngt-axis-label">{tick.label}</text>)}
      {cursor}
    </svg>
  );
}

/** Nome do trecho que contém a distância (para o título do quadro de hover). */
export function sectionNameAt(comparison: LapComparison, distance: number) {
  const section = comparison.sections.find((item) => unwrapIntoWindow(distance, item.windowStart, item.windowEnd) !== null);
  return section ? section.label : null;
}
