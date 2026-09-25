/** Geometria dos minigráficos dos KpiCards do Night Grid, copiada da lógica do mockup aprovado
 * (docs/redesign-mockup/B.dc.html, renderVals): viewBox 200×34, respiro vertical de 3px, barras de
 * 12px a cada 16,6px com altura |v|/3 limitada a 2..15px em torno do eixo y=17. Funções puras para
 * serem testáveis sem DOM. Valores null (semana sem dado) são ignorados no traçado. */
export const SPARK_W = 200;
export const SPARK_H = 34;
const PAD = 3;

function yFor(value: number, lo: number, hi: number) {
  return SPARK_H - PAD - ((value - lo) / (hi - lo || 1)) * (SPARK_H - 2 * PAD);
}

function xFor(index: number, count: number) {
  return count <= 1 ? SPARK_W / 2 : (index * SPARK_W) / (count - 1);
}

export function sparkRange(series: ReadonlyArray<ReadonlyArray<number | null>>): [number, number] {
  const values = series.flat().filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return [0, 1];
  return [Math.min(...values), Math.max(...values)];
}

/** Pontos de <polyline> para uma série; `count` fixa o eixo X (ex.: 12 weeks) para séries curtas. */
export function linePoints(values: ReadonlyArray<number | null>, lo: number, hi: number, count = values.length) {
  return values
    .map((value, index) => (value === null || !Number.isFinite(value) ? null : `${xFor(index, count).toFixed(1)},${yFor(value, lo, hi).toFixed(1)}`))
    .filter((point): point is string => point !== null)
    .join(" ");
}

/** Caminho em degraus (contagem acumulada, ex.: vitórias). Escala de 0 até o máximo (mínimo 1). */
export function stepPath(values: ReadonlyArray<number>, count = values.length) {
  const max = Math.max(...values, 1);
  let d = "";
  values.forEach((value, index) => {
    const y = yFor(value, 0, max).toFixed(1);
    d += `${index ? "L" : "M"}${xFor(index, count).toFixed(1)},${y}`;
    if (index < values.length - 1) d += `L${xFor(index + 1, count).toFixed(1)},${y}`;
  });
  return d;
}

export type SparkBar = { x: number; y: number; h: number; positive: boolean };

/** Barras de ganho/perda por corrida (sequência). Até 12 barras cabem nos 200px do mockup. */
export function sparkBars(values: ReadonlyArray<number>): SparkBar[] {
  return values.map((value, index) => {
    const h = Math.max(2, Math.min(15, Math.abs(value) / 3));
    return { x: index * 16.6 + 2, y: value >= 0 ? 17 - h : 17, h: Number(h.toFixed(1)), positive: value >= 0 };
  });
}
