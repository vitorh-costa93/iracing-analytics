import { estimateIratingDelta, type FieldEntry } from "@/lib/agent-ibt-result";

/**
 * Métricas dos Debriefs que vêm do campo completo da corrida (race_field_results, escrito pelo agente):
 * permanência (voltas concluídas contra o líder da classe), ritmo contra o grid (percentil da melhor
 * volta na classe), resultado contra o esperado (Δ iRating real menos o Δ que a fórmula comunitária
 * daria para a posição que o seu iRating previa) e a cascata de desfechos. Tudo puro: a rota lê poucas
 * colunas, chama estas funções e devolve só agregados (guard-rail de cota: nunca linhas do campo
 * para o navegador). Só corridas oficiais; a classe é a car_class_id do próprio piloto.
 */
export const EARLY_EXIT_RATIO = 0.9;
export const MIN_RATED_FOR_EXPECTED = 4;

export type FieldResultRow = {
  subsession_id: number;
  cust_id: number;
  car_class_id: number | null;
  laps_complete: number | null;
  best_lap_time: number | null;
  oldi_rating: number | null;
  newi_rating: number | null;
  finish_position_in_class: number | null;
  is_me: boolean;
};

export type RaceFieldMetric = {
  subsessionId: number;
  lapsComplete: number;
  classMaxLaps: number;
  /** laps_complete ÷ voltas do líder da classe; 1 = terminou com o líder. */
  lapsRatio: number | null;
  /** 0 = melhor volta da classe, 1 = a mais lenta (posição − 1) ÷ (corredores − 1). */
  pace: number | null;
  expectedDelta: number | null;
  realDelta: number | null;
  /** Δ real − Δ esperado; positivo = rendeu mais do que o iRating previa. */
  residual: number | null;
};

const isStarter = (row: FieldResultRow) => (row.laps_complete ?? 0) > 0 && row.finish_position_in_class !== null;

/** Posição prevista pelo iRating = quantos da classe têm iRating maior + 1; o Δ esperado é o que a
 * fórmula daria ao piloto terminando nessa posição, com o resto do grid nos lugares em que terminou. */
export function expectedDeltaFor(classRows: FieldResultRow[], me: FieldResultRow): number | null {
  if (!me.oldi_rating || me.oldi_rating <= 0 || !isStarter(me)) return null;
  const rated = classRows.filter((row) => (row.oldi_rating ?? 0) > 0);
  if (rated.length < MIN_RATED_FOR_EXPECTED) return null;
  const starters = classRows.filter(isStarter);
  const nonStarters = classRows.filter((row) => !isStarter(row));
  const expectedPosition = Math.min(rated.filter((row) => (row.oldi_rating ?? 0) > me.oldi_rating!).length + 1, starters.length);
  const others = starters.filter((row) => row !== me).sort((a, b) => a.finish_position_in_class! - b.finish_position_in_class!);
  const order = [...others.slice(0, expectedPosition - 1), me, ...others.slice(expectedPosition - 1)];
  const field: FieldEntry[] = [
    ...order.map((row, index) => ({ irating: row.oldi_rating ?? 0, started: true, position: index + 1 })),
    ...nonStarters.map((row) => ({ irating: row.oldi_rating ?? 0, started: false, position: null })),
  ];
  return estimateIratingDelta(field, order.indexOf(me));
}

export function raceFieldMetrics(rows: FieldResultRow[]): Map<number, RaceFieldMetric> {
  const bySession = new Map<number, FieldResultRow[]>();
  for (const row of rows) bySession.set(row.subsession_id, [...(bySession.get(row.subsession_id) ?? []), row]);
  const out = new Map<number, RaceFieldMetric>();
  for (const [subsessionId, sessionRows] of bySession) {
    const me = sessionRows.find((row) => row.is_me);
    if (!me) continue;
    const classRows = sessionRows.filter((row) => row.car_class_id === me.car_class_id);
    const classMaxLaps = Math.max(0, ...classRows.map((row) => row.laps_complete ?? 0));
    const lapsComplete = me.laps_complete ?? 0;
    const bests = classRows.map((row) => row.best_lap_time).filter((value): value is number => typeof value === "number" && value > 0);
    const pace = me.best_lap_time && me.best_lap_time > 0 && bests.length >= 2 ? bests.filter((value) => value < me.best_lap_time!).length / (bests.length - 1) : null;
    const expectedDelta = expectedDeltaFor(classRows, me);
    const realDelta = me.oldi_rating && me.newi_rating && me.oldi_rating > 0 && me.newi_rating > 0 ? me.newi_rating - me.oldi_rating : null;
    out.set(subsessionId, {
      subsessionId, lapsComplete, classMaxLaps,
      lapsRatio: classMaxLaps > 0 ? lapsComplete / classMaxLaps : null,
      pace, expectedDelta, realDelta,
      residual: expectedDelta !== null && realDelta !== null ? realDelta - expectedDelta : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ agregados por recorte */
export type RaceForField = {
  subsessionId: number | null;
  date: string;
  car: string;
  track: string;
  delta: number;
  classFinish: number | null;
  /** Garage61/agente não tem as voltas: a classificação da causa fica "sem dados". */
  cause?: ExitCause | null;
};
export type CascadeKey = "completed" | "lapOne" | "under25" | "to50" | "to75" | "to90";
export type Bucket = { count: number; delta: number };
export type FieldSide = {
  races: number;
  net: number;
  kept: number;
  /** % de corridas com ≥ 90% das voltas da classe; null sem campo importado. */
  permanencePct: number | null;
  early: number;
  residualAvg: number | null;
  residualRaces: number;
  /** Média do percentil de ritmo (0 = melhor), em %, arredondada. */
  paceTopPct: number | null;
  paceRaces: number;
  podiums: number;
  wins: number;
  cascade: Record<CascadeKey, Bucket>;
};
export const CASCADE_ORDER: CascadeKey[] = ["completed", "lapOne", "under25", "to50", "to75", "to90"];

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const emptyBucket = (): Bucket => ({ count: 0, delta: 0 });

export function cascadeKey(metric: RaceFieldMetric | undefined): CascadeKey | null {
  if (!metric || metric.lapsRatio === null) return null;
  if (metric.lapsRatio >= EARLY_EXIT_RATIO) return "completed";
  if (metric.lapsComplete <= 1) return "lapOne";
  if (metric.lapsRatio < 0.25) return "under25";
  if (metric.lapsRatio < 0.5) return "to50";
  if (metric.lapsRatio < 0.75) return "to75";
  return "to90";
}

export function summarizeField(races: RaceForField[], metrics: Map<number, RaceFieldMetric>): FieldSide {
  const cascade = Object.fromEntries(CASCADE_ORDER.map((key) => [key, emptyBucket()])) as Record<CascadeKey, Bucket>;
  const known = races.filter((race) => race.subsessionId !== null && metrics.get(race.subsessionId)?.lapsRatio !== null && metrics.has(race.subsessionId));
  for (const race of known) {
    const key = cascadeKey(metrics.get(race.subsessionId!));
    if (!key) continue;
    cascade[key].count += 1;
    cascade[key].delta += race.delta;
  }
  const residuals = races.map((race) => (race.subsessionId === null ? null : metrics.get(race.subsessionId)?.residual ?? null)).filter((value): value is number => value !== null);
  const paces = races.map((race) => (race.subsessionId === null ? null : metrics.get(race.subsessionId)?.pace ?? null)).filter((value): value is number => value !== null);
  const kept = cascade.completed.count;
  return {
    races: races.length,
    net: sum(races.map((race) => race.delta)),
    kept,
    permanencePct: known.length ? Math.round((kept / known.length) * 100) : null,
    early: known.length - kept,
    residualAvg: residuals.length ? Number((sum(residuals) / residuals.length).toFixed(1)) : null,
    residualRaces: residuals.length,
    paceTopPct: paces.length ? Math.round((sum(paces) / paces.length) * 100) : null,
    paceRaces: paces.length,
    podiums: races.filter((race) => race.classFinish !== null && race.classFinish <= 3).length,
    wins: races.filter((race) => race.classFinish === 1).length,
    cascade,
  };
}

/* ------------------------------------------------------------------ causa provável da saída */
export type ExitCause = "lapOne" | "abrupt" | "damage" | "offTrack";
export type ExitLap = { lap_number: number | null; lap_time: number | null; off_track: boolean | null; pit_in: boolean | null; pit_out: boolean | null };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Regra automática (evidência média): pela assinatura das voltas da corrida que terminou cedo.
 * Volta 1 = saiu em até uma volta; fora da pista = a última volta está marcada fora da pista; dano =
 * alguma das 3 voltas anteriores à última ficou > 15% mais lenta que a mediana; senão, parada brusca
 * com o ritmo normal até o fim. Sem voltas do Garage61/agente devolve null. */
export function classifyExit(lapsComplete: number, laps: ExitLap[]): ExitCause | null {
  if (lapsComplete <= 1) return "lapOne";
  const ordered = [...laps].sort((a, b) => (a.lap_number ?? 0) - (b.lap_number ?? 0));
  if (!ordered.length) return null;
  const pace = ordered.filter((lap) => (lap.lap_time ?? 0) > 0 && !lap.pit_in && !lap.pit_out).map((lap) => lap.lap_time as number);
  if (!pace.length) return null;
  const typical = median(pace);
  if (ordered[ordered.length - 1].off_track === true) return "offTrack";
  const slow = ordered.slice(-4, -1).some((lap) => (lap.lap_time ?? 0) > typical * 1.15 && (lap.lap_time ?? 0) < typical * 3 && !lap.pit_in && !lap.pit_out);
  return slow ? "damage" : "abrupt";
}

export const CAUSE_ORDER: ExitCause[] = ["abrupt", "lapOne", "damage", "offTrack"];
export type CauseTally = Record<ExitCause | "unknown", Bucket>;
export function tallyCauses(races: RaceForField[], metrics: Map<number, RaceFieldMetric>): CauseTally {
  const out: CauseTally = { abrupt: emptyBucket(), lapOne: emptyBucket(), damage: emptyBucket(), offTrack: emptyBucket(), unknown: emptyBucket() };
  for (const race of races) {
    const metric = race.subsessionId === null ? undefined : metrics.get(race.subsessionId);
    if (!metric || metric.lapsRatio === null || metric.lapsRatio >= EARLY_EXIT_RATIO) continue;
    const key = metric.lapsComplete <= 1 ? "lapOne" : race.cause ?? "unknown";
    out[key].count += 1;
    out[key].delta += race.delta;
  }
  return out;
}

/* ------------------------------------------------------------------ dispersão e por carro */
export type ScatterPoint = { date: string; car: string; pacePct: number; delta: number; exitLap: number | null; classLaps: number | null };
export function scatterPoints(races: RaceForField[], metrics: Map<number, RaceFieldMetric>): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (const race of races) {
    const metric = race.subsessionId === null ? undefined : metrics.get(race.subsessionId);
    if (!metric || metric.pace === null) continue;
    const early = metric.lapsRatio !== null && metric.lapsRatio < EARLY_EXIT_RATIO;
    points.push({ date: race.date, car: race.car, pacePct: Math.round(metric.pace * 100), delta: race.delta, exitLap: early ? metric.lapsComplete : null, classLaps: early ? metric.classMaxLaps : null });
  }
  return points;
}

export type CarRow = FieldSide & { car: string };
export function byCar(races: RaceForField[], metrics: Map<number, RaceFieldMetric>): CarRow[] {
  const groups = new Map<string, RaceForField[]>();
  for (const race of races) groups.set(race.car, [...(groups.get(race.car) ?? []), race]);
  return [...groups.entries()].map(([car, items]) => ({ car, ...summarizeField(items, metrics) })).sort((a, b) => b.races - a.races || a.car.localeCompare(b.car));
}
