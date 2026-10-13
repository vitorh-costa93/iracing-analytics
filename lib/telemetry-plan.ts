import { parseLapTimeSeconds } from "@/lib/winner-gap";

/**
 * Lógica pura da subaba "Plano e volta" do Telemetry Lab (sem Supabase aqui; a rota
 * app/api/telemetry/plan/route.ts só busca as linhas e chama estas funções).
 * Tudo é calculado de dados reais já guardados; sem dado suficiente o resultado é null/vazio e a tela
 * mostra uma linha de estado vazio em vez de inventar número.
 */

/** Voltas completas abaixo desta fração das voltas da classe = saída antecipada. */
export const EARLY_EXIT_RATIO = 0.9;
/** Quantas voltas limpas mais rápidas entram na volta ideal e no desvio por setor. */
export const IDEAL_LAP_COUNT = 12;
/** Mínimo de voltas limpas para ideal/σ terem sentido. */
export const MIN_IDEAL_LAPS = 5;
/** Corridas mínimas no histórico de carreira antes de recomendar por Δ/saídas. */
export const MIN_HISTORY_RACES = 5;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

// ---------------------------------------------------------------------------------------------
// Permanência / saída antecipada (campo completo: race_field_results)
// ---------------------------------------------------------------------------------------------

export type FieldRow = {
  subsession_id: number;
  car_class_id: number | null;
  laps_complete: number | null;
  finish_position_in_class: number | null;
  is_me: boolean;
};

/**
 * Saída antecipada por corrida: voltas do piloto < 90% das voltas da classe. As voltas da classe
 * vêm do líder da classe (finish_position_in_class = 0, que em iRacing completa o máximo de voltas da
 * classe; conferido em todos os 1.940 grupos subsessão+classe do banco: líder = máximo). Corrida sem
 * linha própria, sem classe ou sem líder fica fora (undefined) em vez de virar "permanência".
 */
export function earlyExitBySubsession(rows: FieldRow[]): Map<number, boolean> {
  const classLaps = new Map<string, number>();
  for (const row of rows) {
    if (row.laps_complete === null || row.car_class_id === null) continue;
    const key = row.subsession_id + "|" + row.car_class_id;
    classLaps.set(key, Math.max(classLaps.get(key) ?? 0, row.laps_complete));
  }
  const result = new Map<number, boolean>();
  for (const row of rows) {
    if (!row.is_me || row.laps_complete === null || row.car_class_id === null) continue;
    const max = classLaps.get(row.subsession_id + "|" + row.car_class_id) ?? 0;
    if (max <= 0) continue;
    result.set(row.subsession_id, row.laps_complete < EARLY_EXIT_RATIO * max);
  }
  return result;
}

export type RaceRow = {
  irstats_race_id: number;
  raced_at: string;
  series_name: string;
  track_name: string;
  car_name: string;
  car_id: number | null;
  track_id: number | null;
  season_week: number | null;
  irating_delta: number;
  fastest_lap_time: string | null;
  race_fastest_lap_time: string | null;
  class_fastest_lap_time: string | null;
};

export type SeasonInfo = { id: string; name: string; start: string };
const WEEK_MS = 7 * 86_400_000;

export function seasonForDate(date: string, seasons: SeasonInfo[]): SeasonInfo | null {
  const time = new Date(date).getTime();
  return seasons.find((season) => {
    const start = new Date(season.start).getTime();
    return time >= start && time < start + 12 * WEEK_MS;
  }) ?? null;
}

export function weekOfDate(date: string, season: SeasonInfo): number {
  return Math.floor((new Date(date).getTime() - new Date(season.start).getTime()) / WEEK_MS) + 1;
}

export type ExitLeak = {
  carKey: string;
  carName: string;
  carId: number | null;
  /** Soma do irating_delta das corridas com saída antecipada (negativa = iRating perdido). */
  leakIrating: number;
  races: number;
  exits: number;
  exitRate: number;
};

/**
 * Vazamento por carro: soma do irating_delta das corridas com saída antecipada na season atual
 * (todas as semanas até agora) e na anterior até a mesma semana. Só entram corridas com campo
 * conhecido. Devolve o carro com mais iRating perdido (soma < 0), ou null.
 */
export function biggestExitLeak(races: RaceRow[], exits: Map<number, boolean>, seasons: SeasonInfo[], currentSeasonId: string, currentWeek: number): ExitLeak | null {
  const ordered = [...seasons].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const currentIndex = ordered.findIndex((season) => season.id === currentSeasonId);
  if (currentIndex < 0) return null;
  const previousId = ordered[currentIndex + 1]?.id ?? null;
  const groups = new Map<string, ExitLeak>();
  for (const race of races) {
    const exited = exits.get(race.irstats_race_id);
    if (exited === undefined) continue;
    const season = seasonForDate(race.raced_at, seasons);
    if (!season) continue;
    const week = race.season_week ?? weekOfDate(race.raced_at, season);
    const inWindow = season.id === currentSeasonId || (season.id === previousId && week <= currentWeek);
    if (!inWindow) continue;
    const carKey = race.car_id !== null ? "id:" + race.car_id : "name:" + race.car_name;
    const group = groups.get(carKey) ?? { carKey, carName: race.car_name, carId: race.car_id, leakIrating: 0, races: 0, exits: 0, exitRate: 0 };
    group.races += 1;
    if (exited) { group.exits += 1; group.leakIrating += race.irating_delta; }
    groups.set(carKey, group);
  }
  let best: ExitLeak | null = null;
  for (const group of groups.values()) {
    group.exitRate = group.races ? group.exits / group.races : 0;
    if (group.leakIrating < 0 && (best === null || group.leakIrating < best.leakIrating)) best = group;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Volta ideal e repetibilidade por setor
// ---------------------------------------------------------------------------------------------

export type CleanLap = { id: string; lapTime: number; sectors: number[] };

export type SectorRow = { sector: number; best: number; own: number; lost: number; sigma: number; mean: number };
export type IdealLap = {
  lapsUsed: number;
  bestLapTime: number;
  /** Soma dos setores da melhor volta (referência do "perdido"; difere de lapTime só por arredondamento). */
  ownSectorSum: number;
  idealTime: number;
  gap: number;
  sectors: SectorRow[];
};

/** Mantém só voltas com o mesmo número de setores (o mais comum) e todos os tempos válidos. */
function consistentLaps(laps: CleanLap[]): CleanLap[] {
  const usable = laps.filter((lap) => lap.lapTime > 0 && lap.sectors.length > 0 && lap.sectors.every((time) => Number.isFinite(time) && time > 0));
  const counts = new Map<number, number>();
  for (const lap of usable) counts.set(lap.sectors.length, (counts.get(lap.sectors.length) ?? 0) + 1);
  let size = 0, top = 0;
  for (const [length, count] of counts) if (count > top || (count === top && length > size)) { size = length; top = count; }
  return usable.filter((lap) => lap.sectors.length === size);
}

/**
 * Volta ideal = soma dos melhores setores entre as IDEAL_LAP_COUNT voltas limpas mais rápidas.
 * "Sua volta" é a melhor delas; perdido = setor da sua volta − melhor do setor; σ = desvio padrão
 * amostral do setor nessas voltas. Menos de MIN_IDEAL_LAPS voltas -> null.
 */
export function idealLap(laps: CleanLap[]): IdealLap | null {
  const base = consistentLaps(laps).sort((a, b) => a.lapTime - b.lapTime).slice(0, IDEAL_LAP_COUNT);
  if (base.length < MIN_IDEAL_LAPS) return null;
  const own = base[0];
  const sectors: SectorRow[] = own.sectors.map((time, index) => {
    const values = base.map((lap) => lap.sectors[index]);
    const best = Math.min(...values);
    return { sector: index + 1, best, own: time, lost: Math.max(0, time - best), sigma: stdDev(values) ?? 0, mean: mean(values) };
  });
  const ownSectorSum = sectors.reduce((sum, row) => sum + row.own, 0);
  const idealTime = sectors.reduce((sum, row) => sum + row.best, 0);
  return { lapsUsed: base.length, bestLapTime: own.lapTime, ownSectorSum, idealTime, gap: Math.max(0, ownSectorSum - idealTime), sectors };
}

export const leastRepeatableSector = (ideal: IdealLap): SectorRow | null =>
  ideal.sectors.reduce<SectorRow | null>((worst, row) => (worst === null || row.sigma > worst.sigma ? row : worst), null);

export const biggestLostSector = (ideal: IdealLap): SectorRow | null =>
  ideal.sectors.reduce<SectorRow | null>((worst, row) => (row.lost > 0 && (worst === null || row.lost > worst.lost) ? row : worst), null);

// ---------------------------------------------------------------------------------------------
// Plano de treino (até 3 exercícios)
// ---------------------------------------------------------------------------------------------

export type PlanExercise = {
  kind: "start" | "repeatability" | "ideal";
  /** Texto do chip com o ganho em jogo. */
  chip: string;
  title: string;
  text: string;
  goal: string;
  /** Prioridade usada só na ordenação: iR em jogo vem antes; setores ordenam por fração do tempo do setor. */
  weight: number;
};

const fmt = (value: number, decimals: number) => value.toFixed(decimals).replace(".", ",");
export const formatSeconds = (value: number, decimals = 3) => fmt(value, decimals);
export function formatLap(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes + ":" + fmt(seconds - minutes * 60, 3).padStart(6, "0");
}
const sectorWords = (row: SectorRow) => "Setor " + row.sector;

export type PlanInput = {
  leak: ExitLeak | null;
  shortCar: string;
  /** Pista da semana para esse carro (contexto ativo com o mesmo carro), se houver. */
  weekTrack: string | null;
  contextLabel: string | null;
  ideal: IdealLap | null;
  classLeaderLap: number | null;
};

/** Ordena: vazamento de iRating primeiro (valor medido em iR); depois os dois exercícios de setor
 * pela fração do tempo do setor em jogo (σ/média ou perdido/melhor), do maior para o menor. */
export function buildTrainingPlan(input: PlanInput): PlanExercise[] {
  const cards: PlanExercise[] = [];
  const { leak, ideal } = input;
  if (leak && leak.leakIrating < 0) {
    const percent = Math.round(leak.exitRate * 100);
    const target = percent > 25 ? 25 : Math.max(0, Math.floor(percent / 2));
    cards.push({
      kind: "start",
      chip: "−" + Math.abs(leak.leakIrating) + " iR no " + input.shortCar,
      title: "Largada e volta 1 no " + input.shortCar,
      text: leak.races + " corridas medidas na S4 e na S3 no mesmo ponto, " + leak.exits + " saídas antecipadas (" + percent + "%)."
        + " Treine largadas e a primeira volta" + (input.weekTrack ? ", começando por " + input.weekTrack + ", a pista da semana" : "") + ".",
      goal: "Meta: saída abaixo de " + target + "% nas próximas 10 corridas",
      weight: Number.MAX_SAFE_INTEGER,
    });
  }
  if (ideal) {
    const spread = leastRepeatableSector(ideal);
    if (spread && spread.sigma > 0) {
      const others = ideal.sectors.filter((row) => row.sector !== spread.sector && row.sigma > 0);
      const lowest = others.length ? others.reduce((low, row) => (row.sigma < low.sigma ? row : low)) : null;
      const times = lowest && lowest.sigma > 0 ? ", " + fmt(spread.sigma / lowest.sigma, 1) + " vezes o do S" + lowest.sector : "";
      cards.push({
        kind: "repeatability",
        chip: "σ " + fmt(spread.sigma, 3) + " s",
        title: sectorWords(spread) + (input.contextLabel ? " de " + input.contextLabel : ""),
        text: "É o setor menos repetível: σ de " + fmt(spread.sigma, 3) + " s" + times + ", nas " + ideal.lapsUsed + " voltas limpas mais rápidas. Repita voltas só com foco nesse setor.",
        goal: "Meta: σ do S" + spread.sector + " abaixo de " + fmt(Math.round(spread.sigma * 0.6 * 200) / 200, 3) + " s",
        weight: spread.mean > 0 ? spread.sigma / spread.mean : 0,
      });
    }
    const lost = biggestLostSector(ideal);
    if (lost) {
      const leader = input.classLeaderLap !== null ? " Compare frenagem e ponto de saída com a volta do líder da classe (" + formatLap(input.classLeaderLap) + ")." : " Compare frenagem e ponto de saída com a sua melhor volta nesse trecho.";
      cards.push({
        kind: "ideal",
        chip: fmt(lost.lost, 3) + " s em jogo",
        title: sectorWords(lost) + (input.contextLabel ? " de " + input.contextLabel : ""),
        text: "É onde sua melhor volta fica mais longe da ideal (" + fmt(lost.lost, 3) + " s)." + leader,
        goal: "Meta: S" + lost.sector + " de até " + fmt(lost.best, 3) + " s",
        weight: lost.best > 0 ? lost.lost / lost.best : 0,
      });
    }
  }
  return cards.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

// ---------------------------------------------------------------------------------------------
// Meta de volta e preparo do calendário
// ---------------------------------------------------------------------------------------------

/** Gap em % da sua volta contra a da classe; null se algum lado não existe ou o tempo é inválido. */
export function gapPercent(own: string | null, classBest: string | null): { pct: number; seconds: number; own: number; classBest: number } | null {
  const mine = parseLapTimeSeconds(own), best = parseLapTimeSeconds(classBest);
  if (mine === null || best === null || best <= 0) return null;
  return { pct: (mine - best) / best * 100, seconds: mine - best, own: mine, classBest: best };
}

/** Melhor volta da classe: class_fastest_lap_time, senão race_fastest_lap_time (corrida de classe única). */
export function classReferenceLap(row: Pick<RaceRow, "class_fastest_lap_time" | "race_fastest_lap_time">): string | null {
  return row.class_fastest_lap_time ?? row.race_fastest_lap_time ?? null;
}

export type GapPoint = { raceId: number; date: string; own: number; classBest: number; pct: number };

/** Últimas corridas (mais antigas primeiro) com gap calculável. */
export function gapEvolution(rows: RaceRow[], limit = 6): GapPoint[] {
  return [...rows]
    .sort((a, b) => new Date(a.raced_at).getTime() - new Date(b.raced_at).getTime())
    .flatMap((row) => {
      const gap = gapPercent(row.fastest_lap_time, classReferenceLap(row));
      return gap ? [{ raceId: row.irstats_race_id, date: row.raced_at, own: gap.own, classBest: gap.classBest, pct: gap.pct }] : [];
    })
    .slice(-limit);
}

export type History = { races: number; avgDelta: number | null; recentAvgDelta: number | null; measured: number; exits: number; exitRate: number | null };

export function summarizeHistory(rows: RaceRow[], exits: Map<number, boolean>): History {
  const ordered = [...rows].sort((a, b) => new Date(a.raced_at).getTime() - new Date(b.raced_at).getTime());
  const deltas = ordered.map((row) => row.irating_delta);
  const measured = ordered.filter((row) => exits.has(row.irstats_race_id));
  const exited = measured.filter((row) => exits.get(row.irstats_race_id)).length;
  return {
    races: ordered.length,
    avgDelta: deltas.length ? round(mean(deltas), 1) : null,
    recentAvgDelta: deltas.length >= 3 ? round(mean(deltas.slice(-3)), 1) : null,
    measured: measured.length,
    exits: exited,
    exitRate: measured.length ? exited / measured.length : null,
  };
}

export type Recommendation = { label: "Correr" | "Cautela" | "Preparar" | "Neutro" | "Sem base" | "Pista nova"; tone: "gain" | "loss" | "brand" | "neutral"; hints: string[] };

/**
 * Regras simples, na ordem:
 *  - Pista nova: nenhuma corrida no histórico (carro+pista).
 *  - Sem base: menos de 5 corridas.
 *  - Correr: Δ médio ≥ +10 e saídas ≤ 25% (ou sem medição de saída).
 *  - Preparar: histórico ruim (Δ ≤ −10 ou saídas ≥ 30%) mas as 3 últimas com Δ médio ≥ +10.
 *  - Cautela: Δ médio ≤ −10 ou saídas ≥ 30%.
 *  - Neutro: o resto.
 * Dicas extras: "sem treino" e "sem setup" quando a contagem é zero.
 */
export function recommend(history: History, practiceLaps: number, setups: number): Recommendation {
  const hints: string[] = [];
  if (practiceLaps === 0) hints.push("sem treino");
  if (setups === 0) hints.push("sem setup");
  if (history.races === 0) return { label: "Pista nova", tone: "neutral", hints };
  if (history.races < MIN_HISTORY_RACES || history.avgDelta === null) return { label: "Sem base", tone: "neutral", hints };
  const exitRate = history.exitRate;
  const bad = history.avgDelta <= -10 || (exitRate !== null && exitRate >= 0.3);
  if (history.avgDelta >= 10 && (exitRate === null || exitRate <= 0.25)) return { label: "Correr", tone: "gain", hints };
  if (bad && history.recentAvgDelta !== null && history.recentAvgDelta >= 10) return { label: "Preparar", tone: "brand", hints };
  if (bad) return { label: "Cautela", tone: "loss", hints };
  return { label: "Neutro", tone: "neutral", hints };
}

// ---------------------------------------------------------------------------------------------
// Casamento calendário <-> carro/pista (mesmas regras do Overview, app/page.tsx)
// ---------------------------------------------------------------------------------------------

export type ContextKind = "sf23" | "imsa" | "gt3";

export function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mesmo critério de app/page.tsx (scheduledContextMatches): termo com 3+ letras contido no nome. */
export function trackMatches(trackName: string, terms: string[]) {
  const track = normalizeText(trackName);
  return terms.some((term) => {
    const normalized = normalizeText(term);
    return normalized.length >= 3 && (track.includes(normalized) || normalized.includes(track));
  });
}

/** SF23 por nome; IMSA = GTP/LMP2; GT3 = GT3. Classe nunca é série. */
export function carMatchesKind(kind: ContextKind, carName: string, carClass: string | null) {
  if (kind === "sf23") return /super formula/i.test(carName) && !/lights/i.test(carName);
  if (kind === "imsa") return carClass === "GTP" || carClass === "LMP2";
  return carClass === "GT3";
}

export const KIND_LABEL: Record<ContextKind, string> = { sf23: "SF23", imsa: "IMSA", gt3: "GT3" };
