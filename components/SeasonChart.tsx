"use client";

import { useMemo, useState } from "react";

type WeekPoint = {
  week: number;
  weekStart: string;
  weekEnd: string;
  iratingBeforeWeek: number | null;
  iratingFirst: number | null;
  iratingEnd: number | null;
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
};

function signed(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`;
}

function formatRating(value: number | null) {
  return value === null ? "—" : value.toLocaleString("pt-BR");
}

export default function SeasonChart({ current, previous, currentName, previousName }: Props) {
  const [hovered, setHovered] = useState<{ point: WeekPoint; series: "current" | "previous" } | null>(null);

  const width = 1000;
  const height = 260;
  const pad = { top: 22, right: 24, bottom: 38, left: 64 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  const values = useMemo(
    () => [...current, ...previous].map((p) => p.iratingEnd).filter((v): v is number => v !== null),
    [current, previous]
  );

  const min = values.length ? Math.floor((Math.min(...values) - 80) / 100) * 100 : 0;
  const max = values.length ? Math.ceil((Math.max(...values) + 80) / 100) * 100 : 100;
  const range = Math.max(max - min, 1);

  const x = (week: number) => pad.left + ((week - 1) / 11) * chartWidth;
  const y = (value: number) => pad.top + (1 - (value - min) / range) * chartHeight;

  function pathFor(points: WeekPoint[]) {
    const available = points.filter((p) => p.iratingEnd !== null);
    return available
      .map((p, index) => `${index === 0 ? "M" : "L"} ${x(p.week)} ${y(p.iratingEnd as number)}`)
      .join(" ");
  }

  function areaFor(points: WeekPoint[]) {
    const available = points.filter((p) => p.iratingEnd !== null);
    if (!available.length) return "";
    return `${pathFor(points)} L ${x(available[available.length - 1].week)} ${height - pad.bottom} L ${x(available[0].week)} ${height - pad.bottom} Z`;
  }

  const ticks = Array.from({ length: 5 }, (_, index) => Math.round(max - (range / 4) * index));

  return (
    <div className="season-chart-wrap">
      <div className="chart-legend">
        <span><i className="legend-line current" />{currentName}</span>
        <span><i className="legend-line previous" />{previousName}</span>
      </div>

      <div className="chart-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução semanal de iRating">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="grid-line" />
              <text x={pad.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-label">{tick}</text>
            </g>
          ))}

          {Array.from({ length: 12 }, (_, index) => index + 1).map((week) => (
            <text key={week} x={x(week)} y={height - 15} textAnchor="middle" className="axis-label">W{week}</text>
          ))}

          <path d={areaFor(previous)} className="season-area previous" />
          <path d={areaFor(current)} className="season-area current" />
          <path d={pathFor(previous)} className="season-line previous" />
          <path d={pathFor(current)} className="season-line current" />

          {previous.filter((p) => p.iratingEnd !== null).map((point) => (
            <circle
              key={`previous-${point.week}`}
              cx={x(point.week)}
              cy={y(point.iratingEnd as number)}
              r="8"
              className="chart-hit"
              onMouseEnter={() => setHovered({ point, series: "previous" })}
              onMouseLeave={() => setHovered(null)}
            />
          ))}

          {current.filter((p) => p.iratingEnd !== null).map((point) => (
            <circle
              key={`current-${point.week}`}
              cx={x(point.week)}
              cy={y(point.iratingEnd as number)}
              r="8"
              className="chart-hit"
              onMouseEnter={() => setHovered({ point, series: "current" })}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {hovered && (
          <div className="chart-tooltip">
            <div className="tooltip-kicker">
              {hovered.series === "current" ? currentName : previousName} • Semana {hovered.point.week}
            </div>
            <div className="tooltip-rating">{formatRating(hovered.point.iratingEnd)} iRating</div>
            <div className="tooltip-grid">
              <span>Δ semana</span><strong>{signed(hovered.point.delta)}</strong>
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
