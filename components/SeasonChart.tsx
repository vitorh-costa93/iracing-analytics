"use client";

import { useMemo, useState } from "react";

type WeekPoint = {
  week: number;
  weekStart: string;
  weekEnd: string;
  iratingBeforeWeek: number | null;
  iratingFirst: number | null;
  iratingEnd: number | null;
  safetyRatingEnd?: number | null;
  delta: number | null;
  min: number | null;
  max: number | null;
  ratingChanges: number;
  races: number;
  cars: string[];
  tracks: string[];
};

type Props = {
  current: WeekPoint[];
  previous: WeekPoint[];
  currentName: string;
  previousName: string;
  metric?: "irating" | "safety";
  // 02/09/2026: "o contrato de cor por categoria... a linha do gráfico de iRating segue ciano mesmo
  // quando 'Sports Car' está selecionado, contradizendo o KPI card âmbar logo acima" -- this chart used
  // to hardcode --blue for the "current" line/area/legend/tooltip regardless of which category was
  // selected. category drives a CSS class (.season-chart.formula/.sports) so the "current" series now
  // matches the KPI card's own color (--blue for Formula, --amber for Sports) instead of always cyan.
  category?: "formula" | "sports";
};

function signed(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`;
}

function formatRating(value: number | null) {
  return value === null ? "—" : value.toLocaleString("pt-BR");
}

export default function SeasonChart({ current, previous, currentName, previousName, metric = "irating", category }: Props) {
  const [hovered, setHovered] = useState<{ point: WeekPoint; series: "current" | "previous" } | null>(null);

  const width = 640;
  const height = 290;
  const pad = { top: 22, right: 24, bottom: 38, left: 64 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  const pointValue = (point: WeekPoint) => metric === "safety" ? point.safetyRatingEnd ?? null : point.iratingEnd;
  const values = useMemo(
    () => [...current, ...previous].map(pointValue).filter((v): v is number => v !== null),
    [current, previous, metric]
  );

  const padding = metric === "safety" ? .12 : 80;
  const min = values.length ? Math.max(0, Math.min(...values) - padding) : 0;
  const max = values.length ? Math.max(...values) + padding : metric === "safety" ? 5 : 100;
  const range = Math.max(max - min, metric === "safety" ? .01 : 1);

  const x = (week: number) => pad.left + ((week - 1) / 11) * chartWidth;
  const y = (value: number) => pad.top + (1 - (value - min) / range) * chartHeight;

  function pathFor(points: WeekPoint[]) {
    const available = points.filter((p) => pointValue(p) !== null);
    return available
      .map((p, index) => `${index === 0 ? "M" : "L"} ${x(p.week)} ${y(pointValue(p) as number)}`)
      .join(" ");
  }

  function areaFor(points: WeekPoint[]) {
    const available = points.filter((p) => p.iratingEnd !== null);
    if (!available.length) return "";
    return `${pathFor(points)} L ${x(available[available.length - 1].week)} ${height - pad.bottom} L ${x(available[0].week)} ${height - pad.bottom} Z`;
  }

  const ticks = Array.from({ length: 5 }, (_, index) => max - (range / 4) * index);

  const categoryClass = category ? ` ${category}` : "";

  return (
    <div className={`season-chart-wrap${categoryClass}`}>
      <div className="chart-legend">
        <span><i className="legend-line current" />{currentName}</span>
        <span><i className="legend-line previous" />{previousName}</span>
      </div>

      <div className={`chart-canvas${categoryClass}`}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolução semanal de ${metric === "safety" ? "Safety Rating" : "iRating"}`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="grid-line" />
              <text x={pad.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-label">{metric === "safety" ? tick.toFixed(2) : Math.round(tick)}</text>
            </g>
          ))}

          {Array.from({ length: 12 }, (_, index) => index + 1).map((week) => (
            <text key={week} x={x(week)} y={height - 15} textAnchor="middle" className="axis-label">W{week}</text>
          ))}

          <path d={areaFor(previous)} className="season-area previous" />
          <path d={areaFor(current)} className="season-area current" />
          <path d={pathFor(previous)} className="season-line previous" />
          <path d={pathFor(current)} className="season-line current" />

          {/* 31/08/2026: "no mobile... eu clico e não aparece a informação corretamente" -- the bug
           * was onMouseEnter + a toggling onClick fighting each other: mobile browsers synthesize a
           * mouseenter right before the click for a tap, so by the time onClick ran, `hovered` was
           * ALREADY this same point (onMouseEnter had just set it), so the toggle's "already this
           * point → close it" branch fired immediately, closing the tooltip the same tap that opened
           * it. Pointer events fix this by only driving open/close-on-leave from an actual mouse
           * (event.pointerType === "mouse"); a touch/pen tap never calls setHovered via
           * pointerenter/pointerleave at all, so onClick's toggle is the ONLY thing touch ever
           * triggers and works exactly like tapping should. Hit radius bumped 12 -> 18 (up further on
           * narrow screens via CSS, see .chart-hit) -- these were too small a target for a finger even
           * before this bug. */}
          {previous.filter((p) => pointValue(p) !== null).map((point) => (
            <circle
              key={`previous-${point.week}`}
              cx={x(point.week)}
              cy={y(pointValue(point) as number)}
              r="18"
              className="chart-hit"
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered({ point, series: "previous" }); }}
              onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(null); }}
              onClick={() => setHovered((prevHovered) => prevHovered?.point.week === point.week && prevHovered.series === "previous" ? null : { point, series: "previous" })}
            />
          ))}

          {current.filter((p) => pointValue(p) !== null).map((point) => (
            <circle
              key={`current-${point.week}`}
              cx={x(point.week)}
              cy={y(pointValue(point) as number)}
              r="18"
              className="chart-hit"
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered({ point, series: "current" }); }}
              onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(null); }}
              onClick={() => setHovered((existing) => existing?.point.week === point.week && existing.series === "current" ? null : { point, series: "current" })}
            />
          ))}
        </svg>

        {hovered && (
          <div className="chart-tooltip">
            <div className="tooltip-kicker">
              {hovered.series === "current" ? currentName : previousName} • Semana {hovered.point.week}
            </div>
            <div className="tooltip-rating">{metric === "safety" ? pointValue(hovered.point)?.toFixed(2) : formatRating(pointValue(hovered.point))} {metric === "safety" ? "SR" : "iRating"}</div>
            <div className="tooltip-grid">
              <span>Δ semana</span><strong>{metric === "safety" ? (() => {
                const series = hovered.series === "current" ? current : previous;
                const before = [...series].reverse().find((point) => point.week < hovered.point.week && pointValue(point) !== null);
                const delta = before && pointValue(hovered.point) !== null ? Number(pointValue(hovered.point)) - Number(pointValue(before)) : null;
                return delta === null ? "—" : signed(Number(delta.toFixed(2)));
              })() : signed(hovered.point.delta)}</strong>
              <span>Corridas</span><strong>{hovered.point.races}</strong>
              <span>Pistas</span><strong>{hovered.point.tracks.length ? hovered.point.tracks.join(", ") : "—"}</strong>
              <span>Carros</span><strong>{hovered.point.cars.length ? hovered.point.cars.join(", ") : "—"}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
