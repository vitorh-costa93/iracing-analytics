"use client";

// Shared by both focused-chart popups -- ActiveWeekTelemetry.tsx's own/reference view and
// CarComparison.tsx's car-vs-car view (31/08/2026: "Eu quero, inclusive, que use o mesmo objeto" --
// the two had grown into two separately-maintained near-copies of the same iRacing-widget-inspired
// gauge cluster, with different column order, different wheel coloring, and no live speed readout in
// one of them. One component now, used identically by both, laid out to match the reference iRacing
// HUD widget image left-to-right EXACTLY: inputs (brake/throttle history) -> accelerator bar -> brake
// bar -> gear -> speed -> steering wheel, each its own column, repeated once per side (own/reference
// or carA/carB) as two stacked rows to the right of the shared history chart.
//
// Colors: matching iRacing's own widget (which only ever shows one car, so has no own/reference
// convention to begin with) -- the wheel stays neutral gray/yellow/red regardless of side, and only
// the side LABEL text under the wheel + the history chart's line style (solid vs dashed) carry the
// per-side color. Pedal bars and the gear digit are fixed channel colors (green/red/yellow) the same
// way the rest of the app already colors throttle/brake/gear, not per-side.

export type FocusedSeriesPoint = { x: number; value: number };
export type FocusedSide = {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  throttle: FocusedSeriesPoint[];
  brake: FocusedSeriesPoint[];
  angleRad: number | null;
  gear: number | null;
  speedMs: number | null;
  throttleNow: number | null;
  brakeNow: number | null;
};

// 31/08/2026: widened (was 480+260) so the whole widget has real room -- stacking the chart above
// the map instead of beside it (see .insight-popup-body) freed up the popup's full width for this,
// removing the vertical scrollbar a narrower/taller layout used to force.
const CHART_WIDTH = 620;
const GAUGE_WIDTH = 300;
const ROW_HEIGHT = 116;
const BAR_X = 14, BAR_WIDTH = 7, BAR_HEIGHT = 46, BAR_GAP = 6;
const GEAR_X = 78;
const SPEED_X = 128;
const WHEEL_RADIUS = 24;
const WHEEL_CX = GAUGE_WIDTH - WHEEL_RADIUS - 24;

/** Car names ("McLaren 720S GT3 EVO") can run much longer than the own/reference "VOCÊ"/"REFERÊNCIA"
 * labels this widget was first built for. SVG text doesn't wrap on its own, so this greedily packs
 * words onto up to 2 lines instead of truncating the name away (31/08/2026: "deixar o nome do carro
 * de forma completa, pode quebrar a linha") -- only the pathological case (a single word alone still
 * too long for one line) still gets an ellipsis, since there's nowhere left to wrap it. */
function wrapLabelLines(label: string, maxLineChars = 16): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineChars && current) { lines.push(current); current = word; }
    else current = next;
    if (lines.length === 1 && current.length > maxLineChars) { current = `${current.slice(0, maxLineChars - 1).trimEnd()}…`; break; }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function formatGear(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  if (rounded === 0) return "N";
  if (rounded < 0) return "R";
  return String(rounded);
}

/** A close copy of iRacing's own telemetry-widget wheel icon: a stroked RING (rim) with three
 * spokes to a center hub, the pie-shaped gaps between spokes left open (not a solid filled disk),
 * plus a short red tick just outside the rim at 12 o'clock. Neutral gray regardless of side -- see
 * this file's own top comment for why. */
function GaugeWheel({ cx, cy, radius, angleRad, label, labelColor }: { cx: number; cy: number; radius: number; angleRad: number | null; label: string; labelColor: string }) {
  const degrees = angleRad !== null ? -angleRad * 180 / Math.PI : 0;
  const rimStroke = radius * 0.16;
  const rimRadius = radius - rimStroke / 2;
  const hubRadius = radius * 0.26;
  return (
    <g>
      <g transform={`translate(${cx},${cy}) rotate(${degrees})`} className={angleRad === null ? "steering-wheel-empty" : ""}>
        <circle r={rimRadius} className="steering-wheel-rim" style={{ strokeWidth: rimStroke }} />
        <line x1="0" y1={-hubRadius} x2="0" y2={-radius + rimStroke * 0.4} className="steering-wheel-spoke" />
        <line x1={-hubRadius * 0.5} y1={hubRadius * 0.87} x2={-(radius - rimStroke * 0.4) * 0.87} y2={(radius - rimStroke * 0.4) * 0.5} className="steering-wheel-spoke" />
        <line x1={hubRadius * 0.5} y1={hubRadius * 0.87} x2={(radius - rimStroke * 0.4) * 0.87} y2={(radius - rimStroke * 0.4) * 0.5} className="steering-wheel-spoke" />
        <circle r={hubRadius} className="steering-wheel-hub" />
        <rect x={-radius * 0.09} y={-radius - 5} width={radius * 0.18} height={radius * 0.18} rx="1.5" className="steering-wheel-mark" />
      </g>
      <text x={cx} y={cy + radius + 14} textAnchor="middle" className="steering-wheel-label" style={{ fill: labelColor }}>
        {wrapLabelLines(label).map((line, index) => <tspan key={index} x={cx} dy={index === 0 ? 0 : 11}>{line}</tspan>)}
      </text>
    </g>
  );
}

function GaugeGear({ x, y, value }: { x: number; y: number; value: number | null }) {
  const chevron = (rowY: number, pointsUp: boolean) => {
    const tip = pointsUp ? rowY - 2.2 : rowY + 2.2, base = pointsUp ? rowY + 2.2 : rowY - 2.2;
    return `${x - 5},${base} ${x},${tip} ${x + 5},${base}`;
  };
  return (
    <g>
      <polyline points={chevron(y - 18, true)} className="gear-chevron" />
      <text x={x} y={y + 8} textAnchor="middle" className="gear-readout">{formatGear(value)}</text>
      <polyline points={chevron(y + 18, false)} className="gear-chevron" />
    </g>
  );
}

function GaugeBars({ x, y, throttle, brake }: { x: number; y: number; throttle: number | null; brake: number | null }) {
  const fillHeight = (value: number | null) => Math.max(0, Math.min(1, value ?? 0)) * BAR_HEIGHT;
  return (
    <g transform={`translate(${x},${y - BAR_HEIGHT / 2})`}>
      <rect x="0" y="0" width={BAR_WIDTH} height={BAR_HEIGHT} className="pedal-bar-track" />
      <rect x="0" y={BAR_HEIGHT - fillHeight(throttle)} width={BAR_WIDTH} height={fillHeight(throttle)} className="pedal-bar-fill throttle" />
      <rect x={BAR_WIDTH + BAR_GAP} y="0" width={BAR_WIDTH} height={BAR_HEIGHT} className="pedal-bar-track" />
      <rect x={BAR_WIDTH + BAR_GAP} y={BAR_HEIGHT - fillHeight(brake)} width={BAR_WIDTH} height={fillHeight(brake)} className="pedal-bar-fill brake" />
    </g>
  );
}

export default function FocusedGaugeChart({ sides, xDomain, hoverX, onHoverX, ariaLabel }: {
  sides: FocusedSide[]; xDomain: [number, number]; hoverX: number | null; onHoverX: (x: number | null) => void; ariaLabel: string;
}) {
  const totalWidth = CHART_WIDTH + GAUGE_WIDTH;
  const height = ROW_HEIGHT * 2;
  const [from, to] = xDomain;
  const span = Math.max(0.0001, to - from);
  const scaleX = (x: number) => (x - from) / span * CHART_WIDTH;
  const unscaleX = (px: number) => from + (px / CHART_WIDTH) * span;
  // Chart is now the FIRST (leftmost) column (31/08/2026: "ao invés de ser um gráfico ao lado do
  // outro, o de inputs pode vir em cima do gráfico" -- freed by stacking the popup's chart+map
  // vertically instead of side by side, see .insight-popup-body), so local x is just the raw
  // viewBox-units position, no gauge-column offset to subtract like the old layout needed.
  function localChartX(clientX: number, rect: DOMRect) {
    return (clientX - rect.left) / rect.width * totalWidth;
  }
  function pedalLine(points: FocusedSeriesPoint[], top: number, h: number) {
    return points.map((point) => `${scaleX(point.x).toFixed(1)},${(top + h - Math.max(0, Math.min(1, point.value)) * h).toFixed(1)}`).join(" ");
  }
  const rowTop = 8, rowHeight = height / 2 - 14;

  return (
    <svg viewBox={`0 0 ${totalWidth} ${height}`} className="focused-chart" role="img" aria-label={ariaLabel}
      onMouseMove={(event) => { const x = localChartX(event.clientX, event.currentTarget.getBoundingClientRect()); onHoverX(Math.max(from, Math.min(to, unscaleX(x)))); }}
      onMouseLeave={() => onHoverX(null)}
      onTouchStart={(event) => { const x = localChartX(event.touches[0].clientX, event.currentTarget.getBoundingClientRect()); onHoverX(Math.max(from, Math.min(to, unscaleX(x)))); }}
      onTouchMove={(event) => { const x = localChartX(event.touches[0].clientX, event.currentTarget.getBoundingClientRect()); onHoverX(Math.max(from, Math.min(to, unscaleX(x)))); }}
      onTouchEnd={() => onHoverX(null)}>
      {/* "inputs" -- the brake/throttle history, first/leftmost column, shared by both sides on one
       * pair of axes (fixed channel colors: green=throttle/red=brake regardless of side; the second
       * side is distinguished by a dashed stroke, same convention the rest of the app already uses). */}
      <text x="4" y={rowTop + 10} className="channel-label">INPUTS</text>
      {/* Which line is whose (31/08/2026: "deixar claro qual é a linha tracejada e qual carro é a
       * linha contínua") -- the INPUTS lines themselves stay fixed channel colors (green/red) with
       * only a dashed-vs-solid stroke telling the two sides apart, so that distinction needs spelling
       * out explicitly rather than relying on the wheel labels below to be noticed first. */}
      {sides.map((side, index) => (
        <g key={`legend-${side.key}`} transform={`translate(${70 + index * 240},${rowTop})`}>
          <line x1="0" y1="6" x2="22" y2="6" style={{ stroke: side.color, strokeWidth: 2, strokeDasharray: side.dashed ? "5 3" : undefined }} />
          <text x="28" y="10" className="focused-chart-legend-label" style={{ fill: side.color }}>{side.label} ({side.dashed ? "tracejada" : "contínua"})</text>
        </g>
      ))}
      {sides.map((side) => (
        <g key={side.key}>
          <polyline points={pedalLine(side.brake, rowTop, rowHeight * 2)} className={`trace-brake${side.dashed ? " reference-line" : ""}`} />
          <polyline points={pedalLine(side.throttle, rowTop, rowHeight * 2)} className={`trace-throttle${side.dashed ? " reference-line" : ""}`} />
        </g>
      ))}
      {hoverX !== null && <line x1={scaleX(hoverX)} x2={scaleX(hoverX)} y1="0" y2={height} className="hover-line" />}

      <line x1={CHART_WIDTH} x2={CHART_WIDTH} y1="0" y2={height} className="gauge-divider" />
      <g transform={`translate(${CHART_WIDTH},0)`}>
        {sides.map((side, index) => {
          const rowCenterY = ROW_HEIGHT * index + ROW_HEIGHT / 2;
          const angle = side.angleRad;
          const speedKmh = side.speedMs !== null ? side.speedMs * 3.6 : null;
          return (
            <g key={side.key}>
              <GaugeBars x={BAR_X} y={rowCenterY} throttle={side.throttleNow} brake={side.brakeNow} />
              <GaugeGear x={GEAR_X} y={rowCenterY} value={side.gear} />
              <text x={SPEED_X} y={rowCenterY + 4} className="gauge-speed-readout">{speedKmh !== null ? `${speedKmh.toFixed(0)} km/h` : "—"}</text>
              <GaugeWheel cx={WHEEL_CX} cy={rowCenterY} radius={WHEEL_RADIUS} angleRad={angle} label={side.label} labelColor={side.color} />
            </g>
          );
        })}
        {sides.length > 1 && <line x1="0" x2={GAUGE_WIDTH} y1={ROW_HEIGHT} y2={ROW_HEIGHT} className="gauge-divider" />}
      </g>
    </svg>
  );
}

/**
 * Variante Night Grid do mesmo widget (redesign etapa 3, TelemetryPopup.dc.html): mesmo contrato
 * (FocusedSide, xDomain, hoverX/onHoverX) e mesma regra de cores (acelerador verde, freio vermelho,
 * você contínua, referência tracejada), com o gráfico de inputs à esquerda (viewBox 640 x 250) e os
 * mostradores sincronizados em HTML à direita: pedais, marcha, velocidade e volante de cada lado.
 * O modo clássico acima continua sendo o usado por CarComparison.tsx.
 */
const NG_W = 640, NG_H = 250, NG_X0 = 12, NG_X1 = 628, NG_TOP = 40, NG_BOTTOM = 200;

function NightWheel({ angleRad, tickColor }: { angleRad: number | null; tickColor: string }) {
  const degrees = angleRad !== null ? -angleRad * 180 / Math.PI : 0;
  return (
    <svg className="ngt-wheel" width="44" height="44" viewBox="0 0 44 44" aria-hidden style={{ opacity: angleRad === null ? 0.35 : 1 }}>
      <g transform={`rotate(${degrees.toFixed(1)} 22 22)`}>
        <circle className="rim" cx="22" cy="22" r="17" />
        <line x1="8" x2="36" y1="24" y2="24" />
        <line x1="22" x2="22" y1="24" y2="38" />
        <circle cx="22" cy="5" r="2.5" fill={tickColor} />
      </g>
    </svg>
  );
}

export function FocusedGaugePanel({ sides, xDomain, hoverX, onHoverX, startLabel, endLabel, ariaLabel }: {
  sides: FocusedSide[]; xDomain: [number, number]; hoverX: number | null; onHoverX: (x: number | null) => void;
  startLabel: string; endLabel: string; ariaLabel: string;
}) {
  const [from, to] = xDomain;
  const span = Math.max(0.0001, to - from);
  const scaleX = (x: number) => NG_X0 + ((x - from) / span) * (NG_X1 - NG_X0);
  const line = (points: FocusedSeriesPoint[]) => points
    .map((point) => `${scaleX(point.x).toFixed(1)},${(NG_BOTTOM - Math.max(0, Math.min(1, point.value)) * (NG_BOTTOM - NG_TOP)).toFixed(1)}`)
    .join(" ");
  function toX(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const local = ((clientX - rect.left) / rect.width) * NG_W;
    return Math.max(from, Math.min(to, from + ((local - NG_X0) / (NG_X1 - NG_X0)) * span));
  }
  const own = sides[0], reference = sides[1];
  return (
    <div className="ngt-inputs">
      <div className="ngt-inputs-chart">
        <svg viewBox={`0 0 ${NG_W} ${NG_H}`} role="img" aria-label={ariaLabel}
          onMouseMove={(event) => onHoverX(toX(event.clientX, event.currentTarget))}
          onMouseLeave={() => onHoverX(null)}
          onTouchStart={(event) => { if (event.touches[0]) onHoverX(toX(event.touches[0].clientX, event.currentTarget)); }}
          onTouchMove={(event) => { if (event.touches[0]) onHoverX(toX(event.touches[0].clientX, event.currentTarget)); }}>
          <text x="12" y="18" fontSize="11" letterSpacing="1.5" fill="var(--ng-soft)">INPUTS</text>
          <line x1="150" x2="176" y1="14" y2="14" stroke="var(--ng-text)" strokeWidth="2" />
          <text x="182" y="18" fontSize="11" fill="var(--ng-text)">VOCÊ (contínua)</text>
          {reference && <>
            <line x1="300" x2="326" y1="14" y2="14" stroke="var(--ng-reference-popup)" strokeWidth="2" strokeDasharray="5 3" />
            <text x="332" y="18" fontSize="11" fill="var(--ng-reference-popup)">{reference.label} (tracejada)</text>
          </>}
          {[40, 120, 200].map((y) => <line key={y} x1="0" x2={NG_W} y1={y} y2={y} className="ngt-inputs-grid" />)}
          {reference && <>
            <polyline points={line(reference.brake)} className="ngt-in-brake" data-ref="" />
            <polyline points={line(reference.throttle)} className="ngt-in-throttle" data-ref="" />
          </>}
          <polyline points={line(own.brake)} className="ngt-in-brake" />
          <polyline points={line(own.throttle)} className="ngt-in-throttle" />
          {hoverX !== null && <line x1={scaleX(hoverX)} x2={scaleX(hoverX)} y1="30" y2="215" className="ngt-in-cursor" />}
          <text x="12" y="240" fontSize="10" fill="var(--ng-soft)">{startLabel}</text>
          <text x="628" y="240" fontSize="10" textAnchor="end" fill="var(--ng-soft)">{endLabel}</text>
        </svg>
      </div>
      <div className="ngt-gauges">
        {sides.map((side) => {
          const fill = (value: number | null) => `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;
          return (
            <div key={side.key} className="ngt-gauge" data-side={side.key === "own" ? "own" : "reference"}>
              <div className="ngt-pedals" aria-label={`Acelerador ${fill(side.throttleNow)}, freio ${fill(side.brakeNow)}`}>
                <div className="ngt-pedal" data-channel="throttle"><i style={{ height: fill(side.throttleNow) }} /></div>
                <div className="ngt-pedal" data-channel="brake"><i style={{ height: fill(side.brakeNow) }} /></div>
              </div>
              <div className="ngt-gear" aria-label="Marcha">{formatGear(side.gear)}</div>
              <div className="ngt-speed"><strong>{side.speedMs !== null ? `${Math.round(side.speedMs * 3.6)} km/h` : "—"}</strong><span>{side.label}</span></div>
              <NightWheel angleRad={side.angleRad} tickColor={side.key === "own" ? "var(--ng-loss)" : "var(--ng-reference-popup)"} />
            </div>
          );
        })}
      </div>
    </div>
  );
}