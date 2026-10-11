import { estimateIratingDelta, type FieldEntry } from "@/lib/agent-ibt-result";

/**
 * Agregados puros do "Campo da corrida" (Race Debrief). Entrada: linhas de race_field_results do
 * agente (tempos em ticks de 1/10000 s; posições cruas do iRacing, base 0). Nada aqui toca o banco: a
 * rota app/api/telemetry/race-field/route.ts lê poucas colunas, chama estas funções e devolve só os
 * agregados (guard-rail de cota: nunca linhas brutas para o navegador).
 * Só sessão de corrida (sim_session_type = 'race') entra nas comparações de ritmo/iRating; a
 * classificação é usada apenas como fallback do tempo de qualificação.
 */
export const TICKS_PER_SECOND = 10000;
export const MIN_RIVAL_ENCOUNTERS = 3;
export const MAX_RIVALS = 25;
export const INCIDENT_RISK_THRESHOLD = 8;

export type FieldRow = {
  sim_session_type: "practice" | "qualify" | "race";
  cust_id: number; display_name: string | null; country_code: string | null;
  car_class_id: number | null; car_class_name: string | null;
  starting_position_in_class: number | null; finish_position_in_class: number | null;
  laps_complete: number | null; laps_lead: number | null; incidents: number | null;
  best_lap_time: number | null; average_lap: number | null; qual_lap_time: number | null;
  oldi_rating: number | null; newi_rating: number | null; reason_out: string | null; is_me: boolean;
};
export type FieldEvent = {
  subsession_id: number; track_id?: number | null; sof: number | null; num_drivers: number | null; num_cautions: number | null;
  num_caution_laps: number | null; num_lead_changes: number | null;
  weather: Record<string, unknown> | null; session_splits: { subsession_id: number }[] | null;
};

const sec = (ticks: number | null) => (ticks === null ? null : ticks / TICKS_PER_SECOND);
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
/** Posição 1-based de `value` entre `values` (menor = melhor); empate divide a melhor posição. */
const rankAsc = (values: number[], value: number) => values.filter((other) => other < value).length + 1;

/** Linhas da corrida na classe do piloto (is_me). Sem is_me na corrida, devolve a maior classe. */
export function raceClassRows(rows: FieldRow[]): { me: FieldRow | null; classRows: FieldRow[] } {
  const race = rows.filter((row) => row.sim_session_type === "race");
  const me = race.find((row) => row.is_me) ?? null;
  if (!me) return { me: null, classRows: race };
  return { me, classRows: race.filter((row) => row.car_class_id === me.car_class_id) };
}

/* ------------------------------------------------------------------ 1 · Ritmo contra o grid */
export type PaceStat = { rank: number; of: number; gap: number; medianGap: number; percentile: number; fastest: number; value: number };
export type PaceVsGrid = {
  size: number;
  best: PaceStat | null;
  average: PaceStat | null;
  /** As 5 melhores voltas do campo (uma por piloto) e quanto o piloto está de cada uma (meu − dele, s). */
  top5: { rank: number; name: string; lap: number; diff: number; me: boolean }[];
  /** volta média − melhor volta, em s: quão perto do melhor tempo o piloto sustenta o ritmo. */
  spread: { mine: number; median: number } | null;
  dots: { name: string; gapBest: number | null; gapAvg: number | null; me: boolean }[];
};
function paceStat(values: { value: number; me: boolean }[]): PaceStat | null {
  const mine = values.find((item) => item.me);
  if (!mine) return null;
  const all = values.map((item) => item.value);
  const fastest = Math.min(...all);
  const rank = rankAsc(all, mine.value);
  return {
    rank, of: all.length, gap: round((mine.value - fastest) / TICKS_PER_SECOND), medianGap: round((median(all)! - fastest) / TICKS_PER_SECOND),
    percentile: all.length > 1 ? Math.round(((all.length - rank) / (all.length - 1)) * 100) : 100,
    fastest: fastest / TICKS_PER_SECOND, value: mine.value / TICKS_PER_SECOND,
  };
}
export function topFive(classRows: FieldRow[], me: FieldRow): PaceVsGrid["top5"] {
  if (me.best_lap_time === null) return [];
  return classRows.filter((row) => row.best_lap_time !== null)
    .sort((a, b) => a.best_lap_time! - b.best_lap_time!).slice(0, 5)
    .map((row, index) => ({ rank: index + 1, name: row.display_name ?? "Piloto", lap: row.best_lap_time! / TICKS_PER_SECOND, diff: round((me.best_lap_time! - row.best_lap_time!) / TICKS_PER_SECOND), me: row.is_me }));
}
/** Volta média só vale para quem completou pelo menos metade das voltas do líder da classe. */
export function paceVsGrid(classRows: FieldRow[]): PaceVsGrid | null {
  const me = classRows.find((row) => row.is_me);
  if (!me || me.best_lap_time === null) return null;
  const maxLaps = Math.max(0, ...classRows.map((row) => row.laps_complete ?? 0));
  const bests = classRows.filter((row) => row.best_lap_time !== null).map((row) => ({ value: row.best_lap_time!, me: row.is_me }));
  const avgRows = classRows.filter((row) => row.average_lap !== null && (row.laps_complete ?? 0) >= maxLaps / 2);
  const averages = avgRows.map((row) => ({ value: row.average_lap!, me: row.is_me }));
  const best = paceStat(bests), average = paceStat(averages);
  const fastestBest = best ? best.fastest * TICKS_PER_SECOND : 0, fastestAvg = average ? average.fastest * TICKS_PER_SECOND : 0;
  const spreads = avgRows.filter((row) => row.best_lap_time !== null).map((row) => (row.average_lap! - row.best_lap_time!) / TICKS_PER_SECOND);
  const mySpread = me.average_lap !== null && avgRows.includes(me) ? (me.average_lap - me.best_lap_time) / TICKS_PER_SECOND : null;
  return {
    size: classRows.length, best, average, top5: topFive(classRows, me),
    spread: mySpread !== null && spreads.length ? { mine: round(mySpread), median: round(median(spreads)!) } : null,
    dots: classRows
      .filter((row) => row.best_lap_time !== null || row.average_lap !== null)
      .map((row) => ({
        name: row.display_name ?? "Piloto", me: row.is_me,
        gapBest: row.best_lap_time !== null && best ? round((row.best_lap_time - fastestBest) / TICKS_PER_SECOND) : null,
        gapAvg: row.average_lap !== null && average && avgRows.includes(row) ? round((row.average_lap - fastestAvg) / TICKS_PER_SECOND) : null,
      })),
  };
}
export function paceSentence(pace: PaceVsGrid): string {
  const { best, average } = pace;
  if (!best) return "";
  if (!average) return `Sua melhor volta foi a ${best.rank}ª de ${best.of} na classe (${signedSeconds(best.gap)} da mais rápida).`;
  const sustained = `Seu ritmo sustentado (volta média) foi o ${average.rank}º de ${average.of}`;
  if (average.rank - best.rank >= 3) return `${sustained}, bem abaixo da sua melhor volta (${best.rank}ª): o potencial de uma volta ainda não virou ritmo de corrida.`;
  if (best.rank - average.rank >= 3) return `${sustained}, acima da sua melhor volta (${best.rank}ª): rendimento constante, sem depender de uma volta isolada.`;
  return `${sustained}, alinhado com a melhor volta (${best.rank}ª). A volta média também carrega tráfego, bandeiras e box, então vale como referência e não como ritmo puro.`;
}
export function signedSeconds(value: number, digits = 3) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(digits).replace(".", ",")} s`;
}

/* ------------------------------------------------------------------ 2 · Classificação × corrida */
export type QualiVsRace = {
  size: number;
  points: { start: number; finish: number; me: boolean }[];
  mine: { start: number; finish: number; gained: number; qualGap: number | null; raceGap: number | null; retention: number | null } | null;
  field: { medianQualGap: number | null; medianRaceGap: number | null; medianRetention: number | null; gainers: number; losers: number; same: number };
};
export function qualiVsRace(classRows: FieldRow[], qualifyRows: FieldRow[] = []): QualiVsRace | null {
  const classified = classRows.filter((row) => row.starting_position_in_class !== null && row.finish_position_in_class !== null);
  if (classified.length < 2) return null;
  // Re-ranqueia 1..n pela ordem (linhas filtradas pelo agente deixam buracos nas posições cruas).
  const starts = classified.map((row) => row.starting_position_in_class!), finishes = classified.map((row) => row.finish_position_in_class!);
  const startRank = (row: FieldRow) => rankAsc(starts, row.starting_position_in_class!), finishRank = (row: FieldRow) => rankAsc(finishes, row.finish_position_in_class!);
  const qualifyBest = new Map(qualifyRows.filter((row) => row.best_lap_time !== null).map((row) => [row.cust_id, row.best_lap_time!]));
  const qualOf = (row: FieldRow) => row.qual_lap_time ?? qualifyBest.get(row.cust_id) ?? null;
  const quals = classRows.map(qualOf).filter((value): value is number => value !== null);
  const bests = classRows.map((row) => row.best_lap_time).filter((value): value is number => value !== null);
  const poleTime = quals.length ? Math.min(...quals) : null, fastestRace = bests.length ? Math.min(...bests) : null;
  const gaps = (row: FieldRow) => {
    const q = qualOf(row), r = row.best_lap_time;
    const qualGap = q !== null && poleTime !== null ? (q - poleTime) / TICKS_PER_SECOND : null;
    const raceGap = r !== null && fastestRace !== null ? (r - fastestRace) / TICKS_PER_SECOND : null;
    return { qualGap, raceGap, retention: qualGap !== null && raceGap !== null ? raceGap - qualGap : null };
  };
  const rows = classified.map((row) => ({ row, ...gaps(row), gained: startRank(row) - finishRank(row) }));
  const definedMedian = (pick: (item: (typeof rows)[number]) => number | null) => {
    const value = median(rows.map(pick).filter((v): v is number => v !== null));
    return value === null ? null : round(value);
  };
  const me = rows.find((item) => item.row.is_me);
  return {
    size: classified.length,
    points: rows.map((item) => ({ start: startRank(item.row), finish: finishRank(item.row), me: item.row.is_me })),
    mine: me ? {
      start: startRank(me.row), finish: finishRank(me.row), gained: me.gained,
      qualGap: me.qualGap === null ? null : round(me.qualGap), raceGap: me.raceGap === null ? null : round(me.raceGap), retention: me.retention === null ? null : round(me.retention),
    } : null,
    field: {
      medianQualGap: definedMedian((item) => item.qualGap), medianRaceGap: definedMedian((item) => item.raceGap), medianRetention: definedMedian((item) => item.retention),
      gainers: rows.filter((item) => item.gained > 0).length, losers: rows.filter((item) => item.gained < 0).length, same: rows.filter((item) => item.gained === 0).length,
    },
  };
}

/* ------------------------------------------------------------------ 3 · Contexto do Δ iRating */
export type IratingContext = {
  sof: number | null;
  entrants: number;
  myIrating: number;
  leaderIrating: number;
  /** posição esperada = ordem de iRating na entrada dentro da classe (1 = maior iRating). */
  expectedPosition: number;
  actualPosition: number;
  realDelta: number | null;
  expectedDelta: number | null;
  modelAtActual: number | null;
  /** Δ real − Δ esperado (positivo = rendeu acima do que o iRating de entrada previa). */
  aboveExpected: number | null;
  scenarios: { position: number; delta: number; tag: "expected" | "actual" | null }[];
  rows: { name: string; me: boolean; irating: number; expected: number; start: number | null; finish: number | null; delta: number | null }[];
};
/** Δ estimado se `me` terminasse em `position` (1-based entre os que largaram), mantendo a ordem dos demais. */
function modelDeltaAt(starters: FieldRow[], nonStarters: FieldRow[], me: FieldRow, position: number): number {
  const others = starters.filter((row) => row !== me).sort((a, b) => a.finish_position_in_class! - b.finish_position_in_class!);
  const order = [...others.slice(0, position - 1), me, ...others.slice(position - 1)];
  const field: FieldEntry[] = [
    ...order.map((row, index) => ({ irating: row.oldi_rating ?? 0, started: true, position: index + 1 })),
    ...nonStarters.map((row) => ({ irating: row.oldi_rating ?? 0, started: false, position: null })),
  ];
  return estimateIratingDelta(field, order.indexOf(me));
}
export function iratingContext(classRows: FieldRow[], sof: number | null): IratingContext | null {
  const me = classRows.find((row) => row.is_me);
  if (!me || me.oldi_rating === null || me.oldi_rating <= 0) return null;
  const rated = classRows.filter((row) => row.oldi_rating !== null && row.oldi_rating > 0);
  if (rated.length < 2) return null;
  const expectedPosition = rated.filter((row) => row.oldi_rating! > me.oldi_rating!).length + 1;
  const isStarter = (row: FieldRow) => (row.laps_complete ?? 0) > 0 && row.finish_position_in_class !== null;
  const starters = classRows.filter(isStarter), nonStarters = classRows.filter((row) => !isStarter(row));
  const startedMe = isStarter(me);
  const actualPosition = startedMe ? rankAsc(starters.map((row) => row.finish_position_in_class!), me.finish_position_in_class!) : classRows.length;
  const model = (position: number) => (startedMe && position >= 1 && position <= starters.length ? modelDeltaAt(starters, nonStarters, me, position) : null);
  const expectedDelta = model(Math.min(expectedPosition, starters.length));
  const modelAtActual = model(actualPosition);
  const realDelta = me.newi_rating !== null ? me.newi_rating - me.oldi_rating : null;
  const wanted = [...new Set([1, 2, 3, expectedPosition, actualPosition, actualPosition - 1, actualPosition + 1].filter((p) => p >= 1 && p <= starters.length))].sort((a, b) => a - b);
  const scenarios = wanted.map((position) => ({ position, delta: model(position)!, tag: position === actualPosition ? "actual" as const : position === expectedPosition ? "expected" as const : null }));
  const ordered = [...starters].sort((a, b) => a.finish_position_in_class! - b.finish_position_in_class!);
  const shown = ordered.slice(0, 8);
  if (!shown.includes(me) && startedMe) shown.push(me);
  const startsOf = classRows.map((row) => row.starting_position_in_class).filter((v): v is number => v !== null);
  return {
    sof, entrants: classRows.length, myIrating: me.oldi_rating, leaderIrating: Math.max(...rated.map((row) => row.oldi_rating!)),
    expectedPosition, actualPosition, realDelta, expectedDelta, modelAtActual,
    aboveExpected: realDelta !== null && expectedDelta !== null ? realDelta - expectedDelta : null,
    scenarios,
    rows: shown.map((row) => ({
      name: row.display_name ?? "Piloto", me: row.is_me, irating: row.oldi_rating ?? 0,
      expected: rated.includes(row) ? rated.filter((other) => other.oldi_rating! > row.oldi_rating!).length + 1 : 0,
      start: row.starting_position_in_class === null ? null : rankAsc(startsOf, row.starting_position_in_class),
      finish: rankAsc(starters.map((s) => s.finish_position_in_class!), row.finish_position_in_class!),
      delta: row.oldi_rating && row.newi_rating !== null ? row.newi_rating - row.oldi_rating : null,
    })),
  };
}

/* ------------------------------------------------------------------ 4 · Caráter da corrida */
export type RaceCharacter = {
  verdict: { tone: "clean" | "moderate" | "messy"; label: string; reason: string };
  drivers: number;
  cautions: number | null; cautionLaps: number | null; leadChanges: number | null;
  retired: number; retiredReasons: { reason: string; count: number }[];
  incidents: { median: number | null; mine: number | null; highCount: number; threshold: number };
  weather: { skies: string | null; temperature: string | null; humidity: string | null; rain: string | null };
};
const SKIES = ["céu limpo", "parcialmente nublado", "muito nublado", "encoberto"];
export function weatherSummary(weather: Record<string, unknown> | null): RaceCharacter["weather"] {
  const num = (key: string) => (weather && typeof weather[key] === "number" ? (weather[key] as number) : null);
  const skies = num("skies"), temp = num("temp_value"), units = num("temp_units"), humidity = num("rel_humidity"), rain = num("precip_time_pct");
  return {
    skies: skies !== null && SKIES[skies] ? SKIES[skies] : null,
    // temp_units do iRacing: 0 = imperial (°F), 1 = métrico (°C); sem unidade conhecida a temperatura não é exibida.
    temperature: temp !== null && (units === 0 || units === 1) ? `${Math.round(temp)} °${units === 1 ? "C" : "F"}` : null,
    humidity: humidity !== null ? `${Math.round(humidity)}%` : null,
    rain: rain !== null && rain > 0 ? `chuva em ${Math.round(rain)}% do tempo` : null,
  };
}
export function raceCharacter(event: FieldEvent, raceRows: FieldRow[]): RaceCharacter {
  const retiredRows = raceRows.filter((row) => row.reason_out !== null && row.reason_out.trim().toLowerCase() !== "running");
  const reasons = new Map<string, number>();
  for (const row of retiredRows) reasons.set(row.reason_out!, (reasons.get(row.reason_out!) ?? 0) + 1);
  const incidents = raceRows.map((row) => row.incidents).filter((v): v is number => v !== null);
  const drivers = raceRows.length, retired = retiredRows.length, cautions = event.num_cautions;
  const retiredShare = drivers ? retired / drivers : 0;
  let verdict: RaceCharacter["verdict"];
  if ((cautions ?? 0) >= 3 || retiredShare >= 0.25) verdict = { tone: "messy", label: "corrida bagunçada", reason: `${cautions ?? 0} bandeira(s) amarela(s) e ${retired} abandono(s) em ${drivers} pilotos.` };
  else if ((cautions ?? 0) === 0 && retiredShare <= 0.1) verdict = { tone: "clean", label: "corrida limpa", reason: `Sem bandeira amarela e ${retired} abandono(s) em ${drivers} pilotos.` };
  else verdict = { tone: "moderate", label: "corrida com interrupções", reason: `${cautions ?? 0} bandeira(s) amarela(s) e ${retired} abandono(s) em ${drivers} pilotos.` };
  return {
    verdict, drivers, cautions, cautionLaps: event.num_caution_laps, leadChanges: event.num_lead_changes,
    retired, retiredReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 4),
    incidents: { median: median(incidents), mine: raceRows.find((row) => row.is_me)?.incidents ?? null, highCount: incidents.filter((v) => v >= INCIDENT_RISK_THRESHOLD).length, threshold: INCIDENT_RISK_THRESHOLD },
    weather: weatherSummary(event.weather),
  };
}

/* ------------------------------------------------------------------ Rivais recorrentes */
export type RivalEvent = { subsession_id: number; start_time: string; track_name: string };
export type RivalRow = Pick<FieldRow, "cust_id" | "display_name" | "country_code" | "car_class_id" | "starting_position_in_class" | "finish_position_in_class" | "laps_complete" | "incidents" | "best_lap_time" | "oldi_rating" | "newi_rating" | "is_me"> & { subsession_id: number };
export type Rival = {
  custId: number; name: string; country: string | null; encounters: number; ahead: number; behind: number;
  /** meu melhor tempo − o dele, média dos encontros (s). Negativo = você mais rápido. */
  paceDiff: number | null; irating: number | null; last: string; tracks: string[];
  avgStart: number | null; avgIncidents: number | null; avgIratingDelta: number | null;
  recent: { ahead: boolean | null; track: string; date: string }[];
};
export type RivalsSummary = {
  rivals: Rival[]; rivalsCount: number; opponentsTotal: number; races: number;
  ahead: number; behind: number; mostFrequent: Rival | null; hardest: Rival | null;
};
const started = (row: RivalRow) => (row.laps_complete ?? 0) > 0 && row.finish_position_in_class !== null;
/** Encontros = corridas da mesma classe em que os dois largaram. Placar = quem terminou à frente na classe. */
export function recurringRivals(events: RivalEvent[], mine: RivalRow[], others: RivalRow[], minEncounters = MIN_RIVAL_ENCOUNTERS): RivalsSummary {
  const eventOf = new Map(events.map((event) => [event.subsession_id, event]));
  const myBySub = new Map(mine.filter((row) => row.is_me).map((row) => [row.subsession_id, row]));
  const perRival = new Map<number, { row: RivalRow; me: RivalRow; event: RivalEvent }[]>();
  for (const row of others) {
    const me = myBySub.get(row.subsession_id), event = eventOf.get(row.subsession_id);
    if (!me || !event || row.is_me || row.cust_id === me.cust_id || row.car_class_id !== me.car_class_id) continue;
    const list = perRival.get(row.cust_id) ?? [];
    list.push({ row, me, event });
    perRival.set(row.cust_id, list);
  }
  const all: Rival[] = [];
  for (const [custId, list] of perRival) {
    const encounters = list.filter(({ row, me }) => started(row) && started(me)).sort((a, b) => a.event.start_time.localeCompare(b.event.start_time));
    if (!encounters.length) continue;
    const results = encounters.map(({ row, me }) => ({ ahead: me.finish_position_in_class! < row.finish_position_in_class! }));
    const paces = encounters.filter(({ row, me }) => row.best_lap_time !== null && me.best_lap_time !== null).map(({ row, me }) => (me.best_lap_time! - row.best_lap_time!) / TICKS_PER_SECOND);
    const latest = encounters[encounters.length - 1];
    const named = [...encounters].reverse().find(({ row }) => row.display_name);
    const delta = encounters.filter(({ row }) => row.oldi_rating && row.newi_rating !== null).map(({ row }) => row.newi_rating! - row.oldi_rating!);
    const startsRival = encounters.map(({ row }) => row.starting_position_in_class).filter((v): v is number => v !== null).map((v) => v + 1);
    const incidents = encounters.map(({ row }) => row.incidents).filter((v): v is number => v !== null);
    const tracks = new Map<string, number>();
    for (const { event } of encounters) tracks.set(event.track_name, (tracks.get(event.track_name) ?? 0) + 1);
    all.push({
      custId, name: named?.row.display_name ?? `Piloto ${custId}`, country: latest.row.country_code,
      encounters: encounters.length, ahead: results.filter((r) => r.ahead).length, behind: results.filter((r) => !r.ahead).length,
      paceDiff: paces.length ? round(mean(paces)!) : null, irating: latest.row.oldi_rating, last: latest.event.start_time,
      tracks: [...tracks].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name),
      avgStart: startsRival.length ? round(mean(startsRival)!, 1) : null, avgIncidents: incidents.length ? round(mean(incidents)!, 1) : null,
      avgIratingDelta: delta.length ? Math.round(mean(delta)!) : null,
      recent: encounters.slice(-8).map(({ event }, index, arr) => ({ ahead: results[encounters.length - arr.length + index].ahead, track: event.track_name, date: event.start_time })),
    });
  }
  const recurring = all.filter((rival) => rival.encounters >= minEncounters).sort((a, b) => b.encounters - a.encounters || b.last.localeCompare(a.last));
  // "Mais difícil": pior placar proporcional (desempate: quem tem mais ritmo sobre você, depois mais encontros).
  const hardest = [...recurring].sort((a, b) => a.ahead / a.encounters - b.ahead / b.encounters || (b.paceDiff ?? -Infinity) - (a.paceDiff ?? -Infinity) || b.encounters - a.encounters)[0] ?? null;
  return {
    rivals: recurring.slice(0, MAX_RIVALS), rivalsCount: recurring.length, opponentsTotal: all.length, races: myBySub.size,
    ahead: recurring.reduce((sum, r) => sum + r.ahead, 0), behind: recurring.reduce((sum, r) => sum + r.behind, 0),
    mostFrequent: recurring[0] ?? null, hardest: hardest && hardest.behind > hardest.ahead ? hardest : null,
  };
}

/* ------------------------------------------------------------------ Ritmo por pista (histórico) */
export type TrackEvent = { subsession_id: number; start_time: string; race_week: number | null };
export type TrackRow = Pick<FieldRow, "cust_id" | "car_class_id" | "best_lap_time" | "is_me"> & { subsession_id: number };
export type TrackHistoryPoint = { subsessionId: number; date: string; week: number | null; mine: number; top1: number; top5Mean: number | null; gapTop1: number; gapTop5: number | null; rank: number; of: number };
export type TrackHistory = { points: TrackHistoryPoint[]; trend: { slope: number; label: "melhorando" | "estável" | "piorando" } | null };
export const TREND_EPSILON_S = 0.02;
/** Mesma pista e classe, uma linha por corrida (cronológica): sua melhor volta contra o top-5 do campo. */
export function trackHistory(events: TrackEvent[], rows: TrackRow[], classId: number): TrackHistory {
  const bySub = new Map<number, TrackRow[]>();
  for (const row of rows) { if (row.best_lap_time === null || row.car_class_id !== classId) continue; const list = bySub.get(row.subsession_id) ?? []; list.push(row); bySub.set(row.subsession_id, list); }
  const points: TrackHistoryPoint[] = [];
  for (const event of [...events].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    const list = bySub.get(event.subsession_id) ?? [], me = list.find((row) => row.is_me);
    if (!me || list.length < 2) continue;
    const times = list.map((row) => row.best_lap_time!).sort((a, b) => a - b), top = times.slice(0, 5);
    const top5Mean = top.length >= 5 ? top.reduce((a, b) => a + b, 0) / 5 : null;
    points.push({
      subsessionId: event.subsession_id, date: event.start_time, week: event.race_week, mine: me.best_lap_time! / TICKS_PER_SECOND, top1: times[0] / TICKS_PER_SECOND,
      top5Mean: top5Mean === null ? null : round(top5Mean / TICKS_PER_SECOND), gapTop1: round((me.best_lap_time! - times[0]) / TICKS_PER_SECOND),
      gapTop5: top5Mean === null ? null : round((me.best_lap_time! - top5Mean) / TICKS_PER_SECOND), rank: rankAsc(times, me.best_lap_time!), of: times.length,
    });
  }
  // Tendência = inclinação (mínimos quadrados) do gap para o top-5 por corrida; negativo = aproximando.
  const series = points.map((p, i) => ({ x: i, y: p.gapTop5 ?? p.gapTop1 }));
  if (series.length < 3) return { points, trend: null };
  const mx = mean(series.map((p) => p.x))!, my = mean(series.map((p) => p.y))!;
  const slope = series.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / series.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return { points, trend: { slope: round(slope), label: slope < -TREND_EPSILON_S ? "melhorando" : slope > TREND_EPSILON_S ? "piorando" : "estável" } };
}

/* ------------------------------------------------------------------ Resposta por corrida */
export type RaceFieldView = {
  status: "ok"; subsessionId: number; drivers: number; classLabel: string | null; classSize: number;
  split: { index: number; total: number } | null; sof: number | null;
  pace: PaceVsGrid | null; paceText: string; trackName?: string | null; trackHistory?: TrackHistory | null; quali: QualiVsRace | null; irating: IratingContext | null; character: RaceCharacter;
};
export function buildRaceFieldView(event: FieldEvent, rows: FieldRow[]): RaceFieldView {
  const { classRows } = raceClassRows(rows);
  const raceRows = rows.filter((row) => row.sim_session_type === "race");
  const pace = paceVsGrid(classRows);
  const splits = event.session_splits ?? [];
  const splitIndex = splits.findIndex((split) => split.subsession_id === event.subsession_id);
  return {
    status: "ok", subsessionId: event.subsession_id, drivers: raceRows.length, classLabel: classRows.find((row) => row.is_me)?.car_class_name ?? null, classSize: classRows.length,
    split: splitIndex >= 0 && splits.length > 1 ? { index: splitIndex + 1, total: splits.length } : null, sof: event.sof,
    pace, paceText: pace ? paceSentence(pace) : "",
    quali: qualiVsRace(classRows, rows.filter((row) => row.sim_session_type === "qualify")),
    irating: iratingContext(classRows, event.sof), character: raceCharacter(event, raceRows),
  };
}
