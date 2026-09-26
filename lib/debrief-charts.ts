import type { RaceInput } from "@/lib/race-engineer-analysis";
import { parseLapTimeSeconds } from "@/lib/winner-gap";

/** Cálculos puros dos gráficos novos dos Debriefs de season/week (redesign etapa 5,
 * docs/redesign-mockup/DebriefSeason.dc.html e DebriefWeek.dc.html). Tudo sai de linhas que o
 * relatório já carrega de v_race_results_irating (só corridas oficiais do iRStats) e do
 * raceProgress de lib/race-retirement-events.ts -- nenhuma coluna ou consulta nova para estes dois
 * gráficos.
 *
 * Referência de ritmo: race_results.race_fastest_lap_time e winner_fastest_lap_time existem, mas
 * estão praticamente vazios (0 e 3 de 237 corridas nos últimos 8 meses, checado em 25/09/2026).
 * Por isso a referência é a SUA melhor volta de corrida no mesmo carro e pista, dentro da janela
 * carregada (season atual + anterior). É honesto e sempre disponível; o texto da página diz isso. */

export const PACE_OUTLIER_PCT = 5;
export const LOSS_BINS = ["0–25%", "25–50%", "50–75%", "75–100%"] as const;

export type Quadrant = "fastGain" | "slowGain" | "fastLoss" | "slowLoss";
export type PacePoint = { key: string; label: string; gapPct: number; delta: number; incidents: number | null; races: number };
export type PaceChart = {
  unit: "week" | "race";
  split: number | null;
  domainMax: number;
  points: PacePoint[];
  quadrants: Record<Quadrant, number>;
  missing: number;
};

const delta = (row: RaceInput) => row.irating_after - row.irating_before;
const contextKey = (row: RaceInput) => row.car_name + "|" + row.track_name;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Melhor volta de corrida por carro+pista, em segundos. */
export function contextBestLaps(rows: RaceInput[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const row of rows) {
    const seconds = parseLapTimeSeconds(row.fastest_lap_time ?? null);
    if (seconds === null || seconds <= 0) continue;
    const key = contextKey(row), old = best.get(key);
    if (old === undefined || seconds < old) best.set(key, seconds);
  }
  return best;
}

/** Distância (%) da melhor volta desta corrida até a referência do carro+pista. `null` quando não há
 * volta ou quando passa de PACE_OUTLIER_PCT (corrida de uma volta só, chuva, abandono cedo). */
export function raceGapPct(row: RaceInput, best: Map<string, number>): number | null {
  const seconds = parseLapTimeSeconds(row.fastest_lap_time ?? null), reference = best.get(contextKey(row));
  if (seconds === null || reference === undefined || reference <= 0) return null;
  const pct = (seconds / reference - 1) * 100;
  return pct > PACE_OUTLIER_PCT ? null : round(pct);
}

export function classifyQuadrant(point: { gapPct: number; delta: number }, split: number): Quadrant {
  const fast = point.gapPct <= split;
  if (point.delta > 0) return fast ? "fastGain" : "slowGain";
  return fast ? "fastLoss" : "slowLoss";
}

/** Teto "redondo" do eixo X (0,5 em 0,5 até 3%, depois inteiro). */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  if (value <= 3) return Math.max(0.5, Math.ceil(value * 2) / 2);
  return Math.ceil(value);
}

/** Dispersão ritmo × resultado. Season: um ponto por week (média da distância, saldo somado).
 * Week: um ponto por corrida. O corte rápido/devagar é a mediana da distância em TODAS as corridas
 * carregadas do segmento (as duas seasons), ou seja, "o seu normal", não a média da própria tela. */
export function buildPaceChart(scope: "week" | "season", selected: RaceInput[], all: RaceInput[]): PaceChart {
  const best = contextBestLaps(all);
  // Carro+pista com uma corrida só dá distância 0 por definição (a corrida é a própria referência);
  // essas ficam fora do cálculo do "normal" para não puxar a mediana para zero.
  const contextCount = new Map<string, number>();
  for (const row of all) if (parseLapTimeSeconds(row.fastest_lap_time ?? null) !== null) contextCount.set(contextKey(row), (contextCount.get(contextKey(row)) ?? 0) + 1);
  const gapsOf = (rows: RaceInput[]) => rows.map((row) => raceGapPct(row, best)).filter((value): value is number => value !== null);
  const informative = gapsOf(all.filter((row) => (contextCount.get(contextKey(row)) ?? 0) >= 2));
  const splitRaw = median(informative.length ? informative : gapsOf(all));
  const split = splitRaw === null ? null : round(splitRaw);
  const ordered = [...selected].sort((a, b) => new Date(a.raced_at).getTime() - new Date(b.raced_at).getTime());
  const points: PacePoint[] = [];
  let missing = 0;
  if (scope === "week") {
    for (const row of ordered) {
      const gap = raceGapPct(row, best);
      if (gap === null) { missing++; continue; }
      const date = new Date(row.raced_at);
      points.push({ key: row.raced_at, label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) + " · " + row.track_name, gapPct: gap, delta: delta(row), incidents: row.incidents, races: 1 });
    }
  } else {
    const weeks = new Map<number, RaceInput[]>();
    for (const row of ordered) if (row.season_week !== null) weeks.set(row.season_week, [...(weeks.get(row.season_week) ?? []), row]);
    for (const [week, rows] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
      const gaps = rows.map((row) => raceGapPct(row, best)).filter((value): value is number => value !== null);
      const gap = avg(gaps);
      if (gap === null) { missing++; continue; }
      const incidents = avg(rows.map((row) => row.incidents).filter((value): value is number => typeof value === "number"));
      points.push({ key: "W" + week, label: "W" + week, gapPct: round(gap), delta: rows.reduce((total, row) => total + delta(row), 0), incidents: incidents === null ? null : round(incidents, 1), races: rows.length });
    }
  }
  const quadrants: Record<Quadrant, number> = { fastGain: 0, slowGain: 0, fastLoss: 0, slowLoss: 0 };
  if (split !== null) for (const point of points) quadrants[classifyQuadrant(point, split)]++;
  const p90 = points.length ? [...points.map((point) => point.gapPct)].sort((a, b) => a - b)[Math.min(points.length - 1, Math.floor(points.length * 0.9))] : 0;
  const domainMax = niceCeil(Math.max(split === null ? 0 : split * 2, p90, 0.5));
  return { unit: scope === "week" ? "race" : "week", split, domainMax, points, quadrants, missing };
}

/** Histograma da fração da corrida já concluída quando cada perda grande aconteceu. Usa o
 * raceProgress (tempo em pista / corrida mais longa no mesmo carro+pista). */
export function lossTimingBins(progress: Array<{ delta: number; progressPct: number | null }>, threshold: number): { bins: number[]; sample: number; averagePct: number | null } {
  const bins = [0, 0, 0, 0];
  const values: number[] = [];
  for (const row of progress) {
    if (!(row.delta < -threshold) || row.progressPct === null) continue;
    const pct = Math.max(0, Math.min(100, row.progressPct));
    values.push(pct);
    bins[pct <= 25 ? 0 : pct <= 50 ? 1 : pct <= 75 ? 2 : 3]++;
  }
  const average = avg(values);
  return { bins, sample: values.length, averagePct: average === null ? null : round(average, 1) };
}

export type StreakInfo = { length: number; direction: "gain" | "loss" | null };

/** Sequência em aberto no fim da lista (corridas em ordem cronológica). Corrida com delta 0 encerra. */
export function currentStreak(deltas: number[]): StreakInfo {
  if (!deltas.length) return { length: 0, direction: null };
  const last = deltas[deltas.length - 1];
  if (last === 0) return { length: 0, direction: null };
  const direction = last > 0 ? "gain" : "loss";
  let length = 0;
  for (let index = deltas.length - 1; index >= 0; index--) {
    const value = deltas[index];
    if ((direction === "gain" && value > 0) || (direction === "loss" && value < 0)) length++;
    else break;
  }
  return { length, direction };
}

/** Maior sequência de corridas seguidas ganhando (ou perdendo) iRating. */
export function longestStreak(deltas: number[], kind: "gain" | "loss"): number {
  let best = 0, active = 0;
  for (const value of deltas) {
    if ((kind === "gain" && value > 0) || (kind === "loss" && value < 0)) { active++; best = Math.max(best, active); }
    else active = 0;
  }
  return best;
}

/** Consistência de um input em % (100 = idêntico volta a volta), a partir do coeficiente de
 * variação que lib/telemetry-input-profile.ts já calcula. */
export function inputConsistencyPct(cvPct: number | null): number | null {
  if (cvPct === null || !Number.isFinite(cvPct)) return null;
  return Math.round(Math.max(0, Math.min(100, 100 - cvPct)));
}
