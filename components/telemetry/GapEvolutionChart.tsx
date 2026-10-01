"use client";

import { useId, useMemo, useState } from "react";
import type { GridSample, SectionResult } from "@/lib/lap-analysis";
import { formatSignedSeconds } from "@/lib/engineer-talk";

/**
 * Evolução do gap (Comparação de carros, 29/09/2026; aprovado por mockup, ver artifact
 * https://claude.ai/artifact/EBw6RGMXG6sQCMXiCNFcEH). Mostra o gap acumulado entre os dois carros ao
 * longo da volta inteira -- complementar ao "Curva a curva", que já mostra o ganho/perda de cada trecho
 * isolado, mas não onde a diferença se abre ou fecha ao longo do traçado. Reaproveita `comparison.grid`
 * (já calculado por compareLaps() para o curva a curva), sem custo de backend.
 *
 * Convenção de sinal de comparison: lostSeconds/lostSoFar > 0 = carA (own) perde para carB (ref).
 * Aqui inverte pra exibir (positivo = carA à frente), igual ao resto da tela ("Tempo" da lista de
 * trechos já usa -section.lostSeconds).
 */

const VB_W = 360;
const VB_H = 172;
const PAD_X = 8;
const PLOT_X0 = PAD_X;
const PLOT_X1 = VB_W - PAD_X;
const PLOT_Y0 = 14;
const PLOT_Y1 = VB_H - 14;

type Row = { section: SectionResult; talk: { note: string } };

export default function GapEvolutionChart({
  grid, rows, hoveredSectionId, onHoverSection, onOpenSection,
}: {
  grid: GridSample[];
  rows: Row[];
  hoveredSectionId: string | null;
  onHoverSection: (id: string | null) => void;
  onOpenSection: (id: string) => void;
}) {
  const clipId = useId();
  const [cursorPct, setCursorPct] = useState<number | null>(null);

  const points = useMemo(() => grid.map((sample) => ({ pct: sample.distance, value: -sample.lostSoFar })), [grid]);

  const { yFor, xFor, zeroY } = useMemo(() => {
    const values = points.map((point) => point.value);
    const maxVal = Math.max(0, ...values);
    const minVal = Math.min(0, ...values);
    const span = Math.max(0.06, maxVal - minVal);
    const pad = span * 0.18;
    const top = maxVal + pad;
    const bottom = minVal - pad;
    const range = Math.max(1e-6, top - bottom);
    const x = (pct: number) => PLOT_X0 + (pct / 100) * (PLOT_X1 - PLOT_X0);
    const y = (value: number) => PLOT_Y1 - ((value - bottom) / range) * (PLOT_Y1 - PLOT_Y0);
    return { xFor: x, yFor: y, zeroY: y(0) };
  }, [points]);

  const linePath = useMemo(
    () => points.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.pct)},${yFor(point.value)}`).join(" "),
    [points, xFor, yFor]
  );
  const areaPath = useMemo(() => {
    if (!points.length) return "";
    return `${linePath} L${xFor(points[points.length - 1].pct)},${zeroY} L${xFor(points[0].pct)},${zeroY} Z`;
  }, [linePath, points, xFor, zeroY]);

  function sectionAt(pct: number) {
    return rows.find((row) => pct >= row.section.windowStart && pct <= row.section.windowEnd) ?? null;
  }

  const hovered = cursorPct !== null ? sectionAt(cursorPct) : null;
  const activeId = hovered?.section.id ?? hoveredSectionId;

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const vbX = ((event.clientX - rect.left) / rect.width) * VB_W;
    const pct = Math.max(0, Math.min(100, ((vbX - PLOT_X0) / (PLOT_X1 - PLOT_X0)) * 100));
    setCursorPct(pct);
    onHoverSection(sectionAt(pct)?.section.id ?? null);
  }
  function handleLeave() {
    setCursorPct(null);
    onHoverSection(null);
  }
  function handleClick() {
    if (hovered) onOpenSection(hovered.section.id);
  }

  // rótulos de trecho no eixo X: sem o complemento entre parênteses (sozinho já é mais largo que o
  // espaço disponível em pistas com muitos trechos -- "Curvas 7-8 (Malmedy -- Bruxelles)" vira só
  // "Curvas 7-8"), e espaçados por posição real na pista, não por índice -- dois trechos próximos no
  // fim de um setor (confirmado ao vivo em Spa: Paul Frère e a chicane Bus Stop) ficam fisicamente perto
  // mesmo pulando um a cada N, então o corte certo é "só mostra se já abriu distância mínima do último
  // rótulo mostrado", garantindo sempre o último trecho da volta por último.
  const shortLabel = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "");
  const shownLabelIndices = useMemo(() => {
    const MIN_GAP = 44;
    const shown: number[] = [];
    let lastX = -Infinity;
    rows.forEach((row, index) => {
      const x = xFor(row.section.windowStart);
      if (x - lastX >= MIN_GAP) { shown.push(index); lastX = x; }
    });
    const lastIndex = rows.length - 1;
    if (lastIndex >= 0 && shown[shown.length - 1] !== lastIndex) {
      const lastX2 = xFor(rows[lastIndex].section.windowStart);
      while (shown.length && lastX2 - xFor(rows[shown[shown.length - 1]].section.windowStart) < MIN_GAP) shown.pop();
      shown.push(lastIndex);
    }
    return new Set(shown);
  }, [rows, xFor]);
  const lastLabelIndex = rows.length - 1;

  return (
    <div className="ngc-gap-chart-wrap">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Gráfico do gap acumulado entre os dois carros ao longo da volta"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        style={{ cursor: hovered ? "pointer" : "default" }}
      >
        <defs>
          <clipPath id={`${clipId}-above`}>
            <rect x={0} y={0} width={VB_W} height={zeroY} />
          </clipPath>
          <clipPath id={`${clipId}-below`}>
            <rect x={0} y={zeroY} width={VB_W} height={Math.max(0, VB_H - zeroY)} />
          </clipPath>
        </defs>

        <line x1={PLOT_X0} y1={zeroY} x2={PLOT_X1} y2={zeroY} className="ngc-gap-zero" />
        <text x={PLOT_X0} y={Math.max(10, zeroY - 8)} className="ngc-gap-zone">à frente</text>
        <text x={PLOT_X0} y={Math.min(VB_H - 4, zeroY + 16)} className="ngc-gap-zone">atrás</text>

        {rows.map((row, index) => {
          const x = xFor(row.section.windowStart);
          const showLabel = shownLabelIndices.has(index);
          // só o ÚLTIMO rótulo mostrado ancora pelo fim do texto (senão vaza pra fora do viewBox) --
          // ancorar qualquer rótulo "perto da borda" por aí colidia com o penúltimo rótulo mostrado.
          const isLastLabel = index === lastLabelIndex;
          return (
            <g key={row.section.id}>
              <line x1={x} y1={PLOT_Y0} x2={x} y2={PLOT_Y1} className="ngc-gap-tick" />
              {showLabel && (
                <text x={isLastLabel ? PLOT_X1 : x + 3} y={VB_H - 4} textAnchor={isLastLabel ? "end" : "start"} className="ngc-gap-corner-label">{shortLabel(row.section.label)}</text>
              )}
            </g>
          );
        })}

        {areaPath && (
          <>
            <path d={areaPath} className="ngc-gap-area-gain" clipPath={`url(#${clipId}-above)`} />
            <path d={areaPath} className="ngc-gap-area-loss" clipPath={`url(#${clipId}-below)`} />
          </>
        )}
        {linePath && <path d={linePath} className="ngc-gap-line" />}

        {activeId && (() => {
          const active = rows.find((row) => row.section.id === activeId);
          if (!active) return null;
          const x = xFor((active.section.windowStart + active.section.windowEnd) / 2);
          return <line x1={x} y1={PLOT_Y0} x2={x} y2={PLOT_Y1} className="ngc-gap-hover-line" />;
        })()}
      </svg>
      {hovered && (
        <div
          className="ngc-gap-callout"
          style={{
            left: `${Math.min(72, Math.max(2, ((xFor((hovered.section.windowStart + hovered.section.windowEnd) / 2) / VB_W) * 100))).toFixed(1)}%`,
          }}
        >
          <b>{hovered.section.label}</b> — {formatSignedSeconds(-hovered.section.lostSeconds)} aqui
          <br />{hovered.talk.note}
        </div>
      )}
    </div>
  );
}
