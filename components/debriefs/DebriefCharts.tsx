import type { ReactNode } from "react";
import { weekShort } from "@/lib/season-week";
import type { PaceChart } from "@/lib/debrief-charts";
import { LOSS_BINS } from "@/lib/debrief-charts";
import { dec, signedInt } from "@/lib/debrief-narrative";

/** Gráficos dos Debriefs de season/week, desenhados no mesmo formato dos mockups
 * (docs/redesign-mockup/DebriefSeason.dc.html e DebriefWeek.dc.html). */

const X0 = 46, X1 = 544, Y0 = 14, Y1 = 224, YMID = (Y0 + Y1) / 2;

/** Dispersão ritmo × resultado: X = distância da melhor volta até a referência (%), Y = iRating. */
export function PaceScatter({ pace }: { pace: PaceChart }) {
  const maxAbs = Math.max(10, ...pace.points.map((point) => Math.abs(point.delta))) * 1.12;
  const x = (gap: number) => X0 + Math.min(1, Math.max(0, gap / pace.domainMax)) * (X1 - X0);
  const y = (value: number) => YMID - (value / maxAbs) * (YMID - Y0 - 6);
  const splitX = pace.split === null ? null : x(pace.split);
  const showSplitLabel = splitX !== null && splitX - X0 > 60 && X1 - splitX > 130;
  return (
    <svg className="ngd-scatter" viewBox="0 0 560 250" role="img" aria-label="Ritmo contra resultado">
      {splitX !== null && <line x1={splitX} x2={splitX} y1={Y0} y2={Y1} stroke="var(--ng-tooltip-border)" strokeDasharray="4 4" />}
      <line x1={X0} x2={X1} y1={YMID} y2={YMID} stroke="#5C6A9E" />
      <text x={54} y={28} fontSize={11} fill="var(--ng-gain)" fontWeight={600}>RÁPIDO E GANHANDO</text>
      <text x={540} y={28} fontSize={11} fill="var(--ng-caution)" fontWeight={600} textAnchor="end">DEVAGAR E GANHANDO</text>
      <text x={54} y={218} fontSize={11} fill="var(--ng-loss)" fontWeight={600}>RÁPIDO, MAS PERDENDO</text>
      <text x={540} y={218} fontSize={11} fill="var(--ng-loss)" fontWeight={600} textAnchor="end">DEVAGAR E PERDENDO</text>
      <text x={X0} y={244} fontSize={11} fill="var(--ng-soft)">0%</text>
      {showSplitLabel && <text x={splitX!} y={244} fontSize={11} fill="var(--ng-soft)" textAnchor="middle">{dec(pace.split!, 2)}%</text>}
      <text x={X1} y={244} fontSize={11} fill="var(--ng-soft)" textAnchor="end">{dec(pace.domainMax, pace.domainMax % 1 ? 1 : 0)}% da referência</text>
      {pace.points.map((point) => (
        <circle key={point.key} cx={x(point.gapPct).toFixed(1)} cy={y(point.delta).toFixed(1)} r={5.5} fill={point.delta > 0 ? "var(--ng-gain)" : "var(--ng-loss)"} fillOpacity={0.9}>
          <title>{point.label + ": melhor volta a " + dec(point.gapPct, 2) + "% da referência · " + signedInt(point.delta) + " de iRating" + (point.races > 1 ? " em " + point.races + " corridas" : "")}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Histograma "quando as perdas acontecem": agora (vermelho) contra referência (cinza-azulado). */
export function LossTimingBars({ current, reference, referenceLabel }: { current: number[]; reference: number[]; referenceLabel: string }) {
  const max = Math.max(1, ...current, ...reference);
  const height = (count: number) => (count ? Math.max(4, Math.round((count / max) * 100)) : 0);
  return (
    <div className="ngd-hist">
      {LOSS_BINS.map((label, index) => (
        <div className="ngd-hist-col" key={label}>
          <div className="ngd-hist-bars">
            <div className="ngd-hist-bar" data-kind="now" style={{ height: height(current[index]) }} title={"Agora: " + current[index] + " perda(s) grande(s)"} />
            <div className="ngd-hist-bar" data-kind="ref" style={{ height: height(reference[index]) }} title={referenceLabel + ": " + reference[index] + " perda(s) grande(s)"} />
          </div>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

/** "Pressão por week": uma barra por week, para cima (ganho) ou para baixo (perda) de uma linha zero. */
export function WeekPressureBars({ weeks }: { weeks: Array<{ week: number; delta: number; races: number; severeLosses: number }> }) {
  const max = Math.max(1, ...weeks.map((item) => Math.abs(item.delta)));
  return (
    <div className="ngd-weeks">
      <div className="ngd-weeks-zero" />
      {weeks.map((item) => {
        const h = Math.max(2, Math.round((Math.abs(item.delta) / max) * 58));
        return (
          <div className="ngd-weeks-col" key={item.week} title={weekShort(item.week) + ": " + signedInt(item.delta) + " em " + item.races + " corrida(s)" + (item.severeLosses ? " · " + item.severeLosses + " perda(s) grande(s)" : "")}>
            <div className="ngd-weeks-bar" data-tone={item.delta >= 0 ? "gain" : "loss"} style={item.delta >= 0 ? { top: 60 - h, height: h } : { top: 60, height: h }} />
            <span>{weekShort(item.week)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Linha de barra divergente (corridas e contextos): título/subtítulo, barra a partir do centro, valor. */
export function DivergingRow({ title, subtitle, value, max, valueText }: { title: ReactNode; subtitle: ReactNode; value: number; max: number; valueText: string }) {
  const width = Math.max(1, (Math.abs(value) / Math.max(1, max)) * 48);
  const tone = value > 0 ? "gain" : value < 0 ? "loss" : "neutral";
  return (
    <div className="ngd-row">
      <div className="ngd-row-text">
        <div className="ngd-row-title">{title}</div>
        <div className="ngd-row-sub">{subtitle}</div>
      </div>
      <div className="ngd-row-track">
        <div className="ngd-row-axis" />
        <div className="ngd-row-bar" data-tone={tone} style={value >= 0 ? { left: "50%", width: width + "%" } : { right: "50%", width: width + "%" }} />
      </div>
      <div className="ngd-row-value" data-tone={tone}>{valueText}</div>
    </div>
  );
}
