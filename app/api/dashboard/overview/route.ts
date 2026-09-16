import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// 31/08/2026: "o iRating segue desatualizado... a tabela no fim dessa aba já contém as duas corridas
// que fiz hoje" -- without this, the route has no dynamic-only API call to force Next.js to treat it
// as request-time, so it's a real candidate for being cached/ISR'd and serving a stale snapshot to
// the KPI cards while a since-regenerated fetch (or a differently-cached one, like the races list)
// shows fresher data. Every other route in this app that must never go stale (sync/irstats,
// sync/irstats/ingest) already declares this explicitly; this one -- which computes the driver's
// headline iRating for right now -- should have from the start.
export const dynamic = "force-dynamic";

// 11/09/2026: "rating_history safety_rating: Gateway Timeout" live on the Overview page -- this route
// never had its own maxDuration, so it ran on Vercel's platform default (10s on Hobby). Same failure
// mode already documented and fixed elsewhere in this codebase (app/api/sync/all/route.ts's own
// comment): as rating_history accumulates more safety_rating rows over months of daily syncs, an
// unbounded ORDER BY across the whole per-driver history (needed as-is -- see its own comment further
// down, candidates are matched against arbitrary past cutoffs, so truncating rows here would silently
// break historical weeks) got slow enough to blow that 10s budget under real load, not because of
// anything wrong with the query's SHAPE. 60s matches the actual cost of a dashboard read (several
// Supabase queries + in-memory computation, no telemetry download), well under this route's own
// OVERVIEW_CACHE_TTL_MS-bounded need to ever run this often.
export const maxDuration = 60;

let overviewCache: { expiresAt: number; payload: unknown } | null = null;
const OVERVIEW_CACHE_TTL_MS = 120_000;

function overviewCacheExpiresAt(calendar: SeasonCalendarRow[], now: number) {
  // The regular cache is intentionally short, but it must never straddle an iRacing reset.
  // A response calculated at 20:59 BRT cannot keep S3/W12 on screen after 21:00 BRT.
  const nextBoundary = calendar.flatMap((season) => {
    const start = new Date(season.season_start).getTime();
    return Array.from({ length: 13 }, (_, week) => start + week * 7 * 86_400_000);
  }).filter((boundary) => boundary > now).sort((left, right) => left - right)[0];
  return Math.min(now + OVERVIEW_CACHE_TTL_MS, nextBoundary ?? Number.POSITIVE_INFINITY);
}

type SeasonSummaryRow = {
  season_id: string | number;
  season_name: string;
  race_sessions: number | null;
  total_laps: number | null;
};

type CategorySummaryRow = {
  season_id: string | number;
  season_name: string;
  rating_category: "formula_car" | "sports_car" | "road";
  corridas: number | null;
  delta_irating: number | null;
  delta_medio: number | null;
  mediana: number | null;
  pct_positivas: number | null;
};

type WeeklyRow = {
  season_id: string | number;
  season_name: string;
  rating_category: "formula_car" | "sports_car";
  week_number: number;
  week_start: string;
  week_end: string;

  irating_before_week: number | null;
  irating_first: number | null;
  irating_end_of_week: number | null;
  weekly_delta: number | null;

  irating_min: number | null;
  irating_max: number | null;

  rating_changes: number | null;

  races: number | null;
  cars: string[] | null;
  tracks: string[] | null;
};

type HistoricalRow = {
  rating_category: "formula_car" | "sports_car" | "road";
  car_class: string | null;
  car: string;
  track: string;
  races: number | null;
  delta_irating: number | null;
  avg_delta_irating: number | null;
};

type RatingRow = {
  category: string;
  rating_type: string;
  rating: number | null;
  rating_display: string | null;
  recorded_at: string;
};

type SafetyHistoryRow = RatingRow;

type RaceResultRow = {
  irstats_race_id: number;
  raced_at: string;
  series_name: string;
  track_name: string;
  car_name: string;
  category: "formula_car" | "sports_car";
  season_week: number | null;
  grid_position: number | null;
  finish_position: number;
  position_change: number | null;
  fastest_lap_time: string | null;
  race_fastest_lap_time: string | null;
  laps: number | null;
  irating_after: number;
  irating_before: number;
};

/** Parses irstats' "M:SS.mmm" lap-time text (e.g. "1:27.305") into seconds. */
function parseLapTimeSeconds(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * irstats.com exposes no session-duration field, only lap counts and lap times — so this is an
 * ESTIMATE (laps completed × a reference pace), not a real duration. Uses the race's overall
 * fastest lap (any driver) rather than this driver's own: a driver who DNFs before completing a
 * single timed lap has laps=0 and no personal reference pace, but 0 laps × any pace still
 * correctly yields ~0 minutes — showing up as an early exit on the Race Survival chart instead of
 * being silently dropped for lacking a fastest lap at all. Falls back to the driver's own fastest
 * lap only if the race-wide one wasn't captured (older imports, or the block was absent).
 */
function estimateDurationMinutes(row: RaceResultRow, fallbackPaceSecondsByCar: Map<string, number>): number | null {
  if (row.laps === null) return null;
  // Zero completed laps is ~0 minutes by definition — no pace reference needed or possible (the
  // driver never set a timed lap), and older imports predating race_fastest_lap_time would
  // otherwise have no pace source at all here, wrongly dropping a real early-DNF point.
  if (row.laps === 0) return 0;
  // Some race pages don't expose either fastest-lap field at all (seen on a 10th-place, 3-lap
  // result — likely a short/incomplete race page layout irstats renders differently; not fully
  // diagnosed since irstats.com can't be re-fetched from here to compare the raw HTML). Rather than
  // silently dropping a real result from the Race Survival chart for a parsing gap on ONE field,
  // fall back to this driver's own best known pace with that car this season.
  const paceSeconds = parseLapTimeSeconds(row.race_fastest_lap_time) ?? parseLapTimeSeconds(row.fastest_lap_time) ?? fallbackPaceSecondsByCar.get(row.car_name ?? "") ?? null;
  if (paceSeconds === null) return null;
  return (paceSeconds * row.laps) / 60;
}

type SeasonCalendarRow = {
  season_id: string | number;
  season_name: string;
  season_start: string;
};

type SeasonWeekContextRow = {
  season_id: string;
  week_number: number;
  context_key: "sf23" | "imsa" | "gt3";
  series_name: string;
  track_name: string;
  track_match_terms: string[];
};

function normalizeSeasonId(value: string | number) {
  return String(value);
}

function seasonNumber(value: string | number) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : -1;
}

function throwSupabaseError(
  source: string,
  error: unknown
): never {
  if (
    error &&
    typeof error === "object"
  ) {
    const obj = error as Record<
      string,
      unknown
    >;

    const message =
      typeof obj.message === "string"
        ? obj.message
        : JSON.stringify(obj);

    const code =
      typeof obj.code === "string"
        ? ` [${obj.code}]`
        : "";

    const details =
      typeof obj.details === "string" &&
      obj.details
        ? ` | ${obj.details}`
        : "";

    const hint =
      typeof obj.hint === "string" &&
      obj.hint
        ? ` | Hint: ${obj.hint}`
        : "";

    throw new Error(
      `${source}${code}: ${message}${details}${hint}`
    );
  }

  throw new Error(
    `${source}: ${String(error)}`
  );
}

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.has("refresh");
  if (!refresh && overviewCache && overviewCache.expiresAt > Date.now()) {
    return NextResponse.json(overviewCache.payload, { headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" } });
  }
  try {
    // =====================================================
    // PILOTO
    // =====================================================

    const {
      data: driver,
      error: driverError,
    } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, name, platform_driver_id, updated_at"
      )
      .order("updated_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (driverError) {
      throwSupabaseError(
        "drivers",
        driverError
      );
    }

    if (!driver) {
      throw new Error(
        "Nenhum piloto encontrado no Supabase"
      );
    }

    // =====================================================
    // CONSULTAS ANALÍTICAS
    // =====================================================

    const [
      seasonsResult,
      categoriesResult,
      weeklyResult,
      historicalResult,
      ratingsResult,
      safetyHistoryResult,
      calendarResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("v_season_summary")
        .select(
          `
          season_id,
          season_name,
          race_sessions,
          total_laps
          `
        ),

      supabaseAdmin
        .from(
          "v_season_category_summary"
        )
        .select(
          `
          season_id,
          season_name,
          rating_category,
          corridas,
          delta_irating,
          delta_medio,
          mediana,
          pct_positivas
          `
        ),

      supabaseAdmin
        .from(
          "v_season_weekly_irating"
        )
        .select(
          `
          season_id,
          season_name,
          rating_category,
          week_number,
          week_start,
          week_end,
          irating_before_week,
          irating_first,
          irating_end_of_week,
          weekly_delta,
          irating_min,
          irating_max,
          rating_changes,
          races,
          cars,
          tracks
          `
        )
        .order("week_number", {
          ascending: true,
        }),

      supabaseAdmin
        .from(
          "v_historical_performance"
        )
        .select(
          `
          rating_category,
          car_class,
          car,
          track,
          races,
          delta_irating,
          avg_delta_irating
          `
        ),

      supabaseAdmin
        .from("ratings")
        .select(
          `
          category,
          rating_type,
          rating,
          rating_display,
          recorded_at
          `
        )
        .eq(
          "driver_id",
          driver.id
        )
        .order("recorded_at", {
          ascending: false,
        }),

      supabaseAdmin
        .from("rating_history")
        .select("category,rating_type,rating,rating_display,recorded_at")
        .eq("driver_id", driver.id)
        .eq("rating_type", "safety_rating")
        .in("category", ["formula_car", "sports_car"])
        .order("recorded_at", { ascending: true }),

      supabaseAdmin
        .from("v_season_calendar")
        .select("season_id, season_name, season_start"),
    ]);

    // =====================================================
    // ERROS — AGORA IDENTIFICAMOS A VIEW EXATA
    // =====================================================

    if (seasonsResult.error) {
      throwSupabaseError(
        "v_season_summary",
        seasonsResult.error
      );
    }

    if (categoriesResult.error) {
      throwSupabaseError(
        "v_season_category_summary",
        categoriesResult.error
      );
    }

    if (weeklyResult.error) {
      throwSupabaseError(
        "v_season_weekly_irating",
        weeklyResult.error
      );
    }

    if (historicalResult.error) {
      throwSupabaseError(
        "v_historical_performance",
        historicalResult.error
      );
    }

    if (ratingsResult.error) {
      throwSupabaseError(
        "ratings",
        ratingsResult.error
      );
    }
    if (safetyHistoryResult.error) throwSupabaseError("rating_history safety_rating", safetyHistoryResult.error);
    if (calendarResult.error) throwSupabaseError("v_season_calendar", calendarResult.error);

    // =====================================================
    // DADOS
    // =====================================================

    const seasons =
      (seasonsResult.data ??
        []) as SeasonSummaryRow[];

    const categories =
      (categoriesResult.data ??
        []) as CategorySummaryRow[];

    const weekly =
      (weeklyResult.data ??
        []) as WeeklyRow[];

    const historical =
      (historicalResult.data ??
        []) as HistoricalRow[];

    const ratings =
      (ratingsResult.data ??
        []) as RatingRow[];
    const safetyHistory = (safetyHistoryResult.data ?? []) as SafetyHistoryRow[];
    const seasonCalendar = (calendarResult.data ?? []) as SeasonCalendarRow[];

    // =====================================================
    // SEASONS
    // =====================================================

    // The current season belongs to the calendar, not to the most recently driven session.
    // At 21:00 Monday in Brasilia (00:00 UTC Tuesday) a new iRacing week/season must become
    // visible even before the driver has recorded a lap or the first iRStats result exists.
    const now = Date.now();
    const orderedCalendar = [...seasonCalendar].sort(
      (a, b) => new Date(b.season_start).getTime() - new Date(a.season_start).getTime()
    );
    const activeCalendarSeason = orderedCalendar.find((row) => {
      const start = new Date(row.season_start).getTime();
      return now >= start && now < start + 84 * 86_400_000;
    });
    const previousCalendarSeason = activeCalendarSeason
      ? orderedCalendar.find((row) => new Date(row.season_start).getTime() < new Date(activeCalendarSeason.season_start).getTime())
      : undefined;

    const summariesById = new Map(seasons.map((row) => [normalizeSeasonId(row.season_id), row]));
    const currentSeason = activeCalendarSeason
      ? summariesById.get(normalizeSeasonId(activeCalendarSeason.season_id)) ?? {
        season_id: activeCalendarSeason.season_id,
        season_name: activeCalendarSeason.season_name,
        race_sessions: 0,
        total_laps: 0,
      }
      : [...seasons].sort((a, b) => seasonNumber(b.season_id) - seasonNumber(a.season_id))[0];
    const previousSeason = previousCalendarSeason
      ? summariesById.get(normalizeSeasonId(previousCalendarSeason.season_id)) ?? {
        season_id: previousCalendarSeason.season_id,
        season_name: previousCalendarSeason.season_name,
        race_sessions: 0,
        total_laps: 0,
      }
      : [...seasons].sort((a, b) => seasonNumber(b.season_id) - seasonNumber(a.season_id))[1];

    if (
      !currentSeason ||
      !previousSeason
    ) {
      throw new Error(
        "São necessárias pelo menos duas seasons para o comparativo"
      );
    }

    const currentSeasonId =
      normalizeSeasonId(
        currentSeason.season_id
      );

    const previousSeasonId =
      normalizeSeasonId(
        previousSeason.season_id
      );

    const calendarById = new Map(seasonCalendar.map((row) => [normalizeSeasonId(row.season_id), row]));
    const currentSeasonStart = calendarById.get(currentSeasonId)?.season_start;
    const previousSeasonStart = calendarById.get(previousSeasonId)?.season_start;

    if (!currentSeasonStart || !previousSeasonStart) {
      throw new Error("v_season_calendar não contém season_start para a season atual/anterior");
    }

    const currentSeasonEnd = new Date(new Date(currentSeasonStart).getTime() + 84 * 86_400_000).toISOString();

    const { data: seasonRaceRows, error: racesError } = await supabaseAdmin
      .from("v_race_results_irating")
      .select(
        "irstats_race_id, raced_at, series_name, track_name, car_name, category, season_week, grid_position, finish_position, position_change, fastest_lap_time, race_fastest_lap_time, laps, irating_after, irating_before"
      )
      .eq("driver_id", driver.id)
      .gte("raced_at", previousSeasonStart)
      .lt("raced_at", currentSeasonEnd)
      .order("raced_at", { ascending: false });
    if (racesError) throwSupabaseError("v_race_results_irating", racesError);

    const seasonRaces = (seasonRaceRows ?? []) as RaceResultRow[];
    const currentSeasonStartMs = new Date(currentSeasonStart).getTime();
    const currentSeasonRaces = seasonRaces.filter(
      (row) => new Date(row.raced_at).getTime() >= currentSeasonStartMs
    );

    // Best known pace per car this season, used only when a specific race's own fastest-lap fields
    // are both missing (see estimateDurationMinutes) -- built from whichever rows DO have a pace.
    const fallbackPaceSecondsByCar = new Map<string, number>();
    for (const row of currentSeasonRaces) {
      const pace = parseLapTimeSeconds(row.race_fastest_lap_time) ?? parseLapTimeSeconds(row.fastest_lap_time);
      if (pace === null) continue;
      const existing = fallbackPaceSecondsByCar.get(row.car_name);
      if (existing === undefined || pace < existing) fallbackPaceSecondsByCar.set(row.car_name, pace);
    }

    const races = currentSeasonRaces.map((row) => ({
      id: row.irstats_race_id,
      startedAt: row.raced_at,
      endedAt: row.raced_at,
      durationMinutes: estimateDurationMinutes(row, fallbackPaceSecondsByCar),
      delta: row.irating_after - row.irating_before,
      ratingCategory: row.category,
      car: row.car_name,
      track: row.track_name,
      seasonWeek: row.season_week,
      bestLap: row.fastest_lap_time,
      series: row.series_name,
      startPosition: row.grid_position,
      finishPosition: row.finish_position,
    }));

    // =====================================================
    // SEQUÊNCIA DE CORRIDAS GANHANDO IRATING (05/09/2026: "corridas seguidas ganhando iRating...
    // embaixo, como Secondary KPI, mostrar o meu recorde all-time") -- substitui o card de
    // Contexto de Corrida (SoF/incidentes) da varredura anterior. Streak atual = corridas
    // consecutivas MAIS RECENTES com irating_delta > 0, contando pra trás a partir de agora (para
    // no primeiro delta <= 0); recorde all-time = a maior sequência já feita, em qualquer season.
    // Precisa da carreira INTEIRA por carteira (não só seasonRaces, que só cobre 2 seasons) --
    // iRStats cobre desde a primeira season deste piloto (1.153 corridas formula+sports na
    // carreira toda). Um .range(0, 4999) sozinho NÃO basta -- o PostgREST tem seu próprio
    // max_rows=1000 no servidor, que corta a resposta em 1000 linhas silenciosamente (sem erro)
    // *independente* do range pedido pelo cliente -- confirmado ao vivo: a "sequência atual"
    // saía errada (13/5 em vez de 0/0) porque a página cortada parava em abril/2026, nunca
    // alcançando as corridas de setembro. Paginado em blocos de 1000, mesmo padrão já usado no
    // backfill de app/api/sync/irstats/route.ts pelo mesmo motivo.
    const career: { raced_at: string; irating_delta: number; category: "formula_car" | "sports_car" }[] = [];
    {
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error: pageError } = await supabaseAdmin
          .from("race_results")
          .select("raced_at,irating_delta,category")
          .eq("driver_id", driver.id)
          .in("category", ["formula_car", "sports_car"])
          .order("raced_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (pageError) throwSupabaseError("race_results (streaks)", pageError);
        career.push(...((page ?? []) as typeof career));
        if (!page || page.length < pageSize) break;
      }
    }

    function streakStats(rows: { irating_delta: number }[]) {
      let current = 0;
      let best = 0;
      for (const row of rows) {
        if (row.irating_delta > 0) {
          current += 1;
          if (current > best) best = current;
        } else {
          current = 0;
        }
      }
      return { current, best };
    }
    const streaks = {
      formula_car: streakStats(career.filter((row) => row.category === "formula_car")),
      sports_car: streakStats(career.filter((row) => row.category === "sports_car")),
    };
    function seasonIdForRace(racedAt: string) {
      const t = new Date(racedAt).getTime();
      for (const row of seasonCalendar) {
        const start = new Date(row.season_start).getTime();
        const end = start + 84 * 86_400_000;
        if (t >= start && t < end) return normalizeSeasonId(row.season_id);
      }
      return null;
    }

    const winsBySeasonCategory = new Map<string, number>();
    for (const row of seasonRaces) {
      if (row.finish_position !== 1) continue;
      const seasonId = seasonIdForRace(row.raced_at);
      if (!seasonId) continue;
      const key = `${seasonId}:${row.category}`;
      winsBySeasonCategory.set(key, (winsBySeasonCategory.get(key) ?? 0) + 1);
    }

    function winsFor(seasonId: string, category: "formula_car" | "sports_car") {
      return winsBySeasonCategory.get(`${normalizeSeasonId(seasonId)}:${category}`) ?? 0;
    }

    // =====================================================
    // IRATING ATUAL
    // =====================================================

    const latestRatings: Record<
      "formula_car" | "sports_car",
      number | null
    > = {
      formula_car: null,
      sports_car: null,
    };

    // 03/09/2026, driver-confirmed live: "acredito que esteja havendo... delay por parte da
    // ferramenta do irstats, porque meu irating atual é de 3463, ou seja, 3522-59 (da sessão de
    // ontem em Le Mans)... usar os resultados individuais de cada sessão para calcular o irating
    // atual". This route showed 3522, missing yesterday's -59. Root cause: the previous fix here
    // (see git history) took the MAX across every recent Garage61 `ratings` snapshot, reasoning a
    // lagging snapshot's own delta-sum could never beat an already-caught-up one's -- true for a
    // missed GAIN, but backwards for a missed LOSS, since max() then keeps the stale (higher, wrong)
    // candidate. The deeper problem: a snapshot's recorded_at (when OUR cron polled Garage61) does
    // not prove Garage61's own backend had processed a given race yet -- so no amount of comparing
    // recorded_at to raced_at, or taking best-of-several, can reliably tell a caught-up snapshot
    // from a lagging one recorded minutes apart.
    //
    // Fix, exactly as the driver described: never trust a Garage61 `ratings` snapshot from the last
    // 24h as an anchor -- by then Garage61 has reliably caught up in practice (hourly cron, and
    // every previously-diagnosed lag here resolved within hours, not a full day) -- then reconstruct
    // "now" purely from individual session results: anchor.rating + the exact sum of every
    // race_results (iRStats) irating_delta for races strictly after that anchor. No comparison, no
    // best-of-N guessing — deterministic and correct for gains and losses alike.
    const irRatingRows = ratings.filter((row) => row.rating_type === "irating" && row.rating !== null);
    const anchorCutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const anchors: Record<"formula_car" | "sports_car", { rating: number; recordedAt: string } | null> = {
      formula_car: null,
      sports_car: null,
    };
    for (const category of ["formula_car", "sports_car"] as const) {
      const rows = irRatingRows.filter((row) => row.category === category); // already sorted recorded_at desc
      const settled = rows.find((row) => new Date(row.recorded_at).getTime() <= anchorCutoffMs);
      const chosen = settled ?? rows[0] ?? null;
      if (chosen) anchors[category] = { rating: chosen.rating as number, recordedAt: chosen.recorded_at };
    }

    const anchorTimes = ([anchors.formula_car, anchors.sports_car].filter(Boolean) as { rating: number; recordedAt: string }[])
      .map((a) => new Date(a.recordedAt).getTime());
    if (anchorTimes.length) {
      const earliestAnchorIso = new Date(Math.min(...anchorTimes)).toISOString();
      const { data: sinceAnchorRows, error: sinceAnchorError } = await supabaseAdmin
        .from("race_results")
        .select("category,raced_at,irating_delta")
        .eq("driver_id", driver.id)
        .gt("raced_at", earliestAnchorIso);
      if (sinceAnchorError) throwSupabaseError("race_results (irating reconstruction since anchor)", sinceAnchorError);
      const deltasSinceEarliestAnchor = (sinceAnchorRows ?? []) as { category: string; raced_at: string; irating_delta: number }[];

      for (const category of ["formula_car", "sports_car"] as const) {
        const anchor = anchors[category];
        if (!anchor) continue;
        const anchorTime = new Date(anchor.recordedAt).getTime();
        const deltaSum = deltasSinceEarliestAnchor
          .filter((row) => row.category === category && new Date(row.raced_at).getTime() > anchorTime)
          .reduce((sum, row) => sum + row.irating_delta, 0);
        latestRatings[category] = anchor.rating + deltaSum;
      }
    }

    const categoriesMissingRating = (["formula_car", "sports_car"] as const).filter((category) => latestRatings[category] === null);
    if (categoriesMissingRating.length) {
      const fallbackResults = await Promise.all(categoriesMissingRating.map((category) =>
        supabaseAdmin.from("v_race_results_irating").select("irating_after")
          .eq("driver_id", driver.id).eq("category", category)
          .order("raced_at", { ascending: false }).limit(1).maybeSingle()
      ));
      categoriesMissingRating.forEach((category, index) => {
        const value = fallbackResults[index].data?.irating_after;
        if (Number.isFinite(value)) latestRatings[category] = value as number;
      });
    }

    const safetyScore = (row: RatingRow) => {
      const displayed = row.rating_display?.match(/([0-9]+(?:\.[0-9]+)?)$/)?.[1];
      return displayed ? Number(displayed) : row.rating === null ? null : row.rating % 1000 / 100;
    };
    const latestSafety = { formula_car: null, sports_car: null } as Record<"formula_car" | "sports_car", number | null>;
    const latestSafetyDisplay = { formula_car: null, sports_car: null } as Record<"formula_car" | "sports_car", string | null>;
    for (const row of ratings) {
      if (row.rating_type !== "safety_rating" || (row.category !== "formula_car" && row.category !== "sports_car")) continue;
      if (latestSafety[row.category] === null) {
        latestSafety[row.category] = safetyScore(row);
        latestSafetyDisplay[row.category] = row.rating_display;
      }
    }

    function safetyAt(category: "formula_car" | "sports_car", at: string) {
      const cutoff = new Date(at).getTime();
      const candidates = safetyHistory.filter((row) => row.category === category && new Date(row.recorded_at).getTime() <= cutoff);
      return candidates.length ? safetyScore(candidates[candidates.length - 1]) : null;
    }

    function safetyWeeklyFor(seasonId: string, category: "formula_car" | "sports_car") {
      return weeklyFor(seasonId, category).map((point) => ({
        ...point,
        safetyRatingEnd: safetyAt(category, point.weekEnd),
      }));
    }

    const elapsedWeek = Math.max(1, Math.min(12, weeklyFor(currentSeasonId, "formula_car").findLast((point) => new Date(point.weekStart) <= new Date())?.week ?? 1));
    // This comes from the imported official calendar rather than a client-side hardcoded Season 4
    // array. It makes "Essa semana no iRacing" switch at the official Monday 21:00 BRT boundary
    // as soon as a new PDF is applied, including before the first race of that season exists.
    const { data: importedContextRows, error: importedContextError } = await supabaseAdmin
      .from("season_week_contexts")
      .select("season_id,week_number,context_key,series_name,track_name,track_match_terms")
      .eq("season_id", currentSeasonId)
      .eq("week_number", elapsedWeek)
      .order("context_key", { ascending: true });
    if (importedContextError) throwSupabaseError("season_week_contexts", importedContextError);
    const weeklyContexts = (importedContextRows ?? []) as SeasonWeekContextRow[];
    function iratingAtSameWeek(category: "formula_car" | "sports_car") {
      return weeklyFor(previousSeasonId, category).find((point) => point.week === elapsedWeek)?.iratingEnd ?? null;
    }

    // =====================================================
    // KPI POR CATEGORIA
    // =====================================================

    function categoryMetric(
      seasonId: string,
      category:
        | "formula_car"
        | "sports_car"
    ) {
      const row =
        categories.find(
          (item) =>
            normalizeSeasonId(
              item.season_id
            ) === seasonId &&
            item.rating_category ===
              category
        );

      return {
        delta:
          row?.delta_irating ??
          0,

        races:
          row?.corridas ?? 0,

        avgDelta:
          row?.delta_medio ??
          null,

        medianDelta:
          row?.mediana ??
          null,

        positivePct:
          row?.pct_positivas ??
          null,
      };
    }

    // =====================================================
    // DADOS SEMANAIS
    // =====================================================

    function weeklyFor(
      seasonId: string,
      category:
        | "formula_car"
        | "sports_car"
    ) {
      return weekly
        .filter(
          (row) =>
            normalizeSeasonId(
              row.season_id
            ) === seasonId &&
            row.rating_category ===
              category
        )
        .sort(
          (a, b) =>
            a.week_number -
            b.week_number
        )
        .map((row) => ({
          week:
            row.week_number,

          weekStart:
            row.week_start,

          weekEnd:
            row.week_end,

          iratingBeforeWeek:
            row.irating_before_week,

          iratingFirst:
            row.irating_first,

          iratingEnd:
            row.irating_end_of_week,

          delta:
            row.weekly_delta,

          min:
            row.irating_min,

          max:
            row.irating_max,

          ratingChanges:
            row.rating_changes ??
            0,

          races:
            row.races ?? 0,

          cars:
            row.cars ?? [],

          tracks:
            row.tracks ?? [],
        }));
    }

    // =====================================================
    // RESPONSE
    // =====================================================

    const payload = {
      status: "ok",

      driver: {
        id:
          driver.id,

        name:
          driver.name,

        iracingId:
          driver.platform_driver_id,
      },

      season: {
        current: {
          id:
            currentSeasonId,

          name:
            currentSeason.season_name,

          races:
            currentSeason.race_sessions ??
            0,

          laps:
            currentSeason.total_laps ??
            0,
        },

        previous: {
          id:
            previousSeasonId,

          name:
            previousSeason.season_name,

          races:
            previousSeason.race_sessions ??
            0,

          laps:
            previousSeason.total_laps ??
            0,
        },
      },

      ratings:
        latestRatings,

      safetyRatings: latestSafety,

      kpis: {
        formula: {
          irating: { current: latestRatings.formula_car, previousSameWeek: iratingAtSameWeek("formula_car"), week: elapsedWeek },
          current:
            categoryMetric(
              currentSeasonId,
              "formula_car"
            ),

          previous:
            categoryMetric(
              previousSeasonId,
              "formula_car"
            ),

          wins: {
            current: winsFor(currentSeasonId, "formula_car"),
            previous: winsFor(previousSeasonId, "formula_car"),
          },
          safetyRating: {
            current: latestSafety.formula_car,
            currentDisplay: latestSafetyDisplay.formula_car,
            previous: safetyAt("formula_car", weeklyFor(previousSeasonId, "formula_car").at(-1)?.weekEnd ?? new Date(0).toISOString()),
          },
        },

        sports: {
          irating: { current: latestRatings.sports_car, previousSameWeek: iratingAtSameWeek("sports_car"), week: elapsedWeek },
          current:
            categoryMetric(
              currentSeasonId,
              "sports_car"
            ),

          previous:
            categoryMetric(
              previousSeasonId,
              "sports_car"
            ),

          wins: {
            current: winsFor(currentSeasonId, "sports_car"),
            previous: winsFor(previousSeasonId, "sports_car"),
          },
          safetyRating: {
            current: latestSafety.sports_car,
            currentDisplay: latestSafetyDisplay.sports_car,
            previous: safetyAt("sports_car", weeklyFor(previousSeasonId, "sports_car").at(-1)?.weekEnd ?? new Date(0).toISOString()),
          },
        },
      },

      weekly: {
        formula: {
          current:
            safetyWeeklyFor(
              currentSeasonId,
              "formula_car"
            ),

          previous:
            safetyWeeklyFor(
              previousSeasonId,
              "formula_car"
            ),
        },

        sports: {
          current:
            safetyWeeklyFor(
              currentSeasonId,
              "sports_car"
            ),

          previous:
            safetyWeeklyFor(
              previousSeasonId,
              "sports_car"
            ),
        },
      },

      historical:
        historical.map(
          (row) => ({
            ratingCategory:
              row.rating_category,

            carClass:
              row.car_class,

            car:
              row.car,

            track:
              row.track,

            races:
              row.races ??
              0,

            delta:
              row.delta_irating ??
              0,

            avgDelta:
              row.avg_delta_irating ??
              0,
          })
        ),

      weeklyContexts: weeklyContexts.map((context) => ({
        kind: context.context_key,
        series: context.series_name,
        track: context.track_name,
        trackMatchTerms: context.track_match_terms,
      })),

      races,

      streaks,

      featureAvailability: {
        wins: true,

        winsReason:
          "Wins vêm automaticamente de irstats.com, sem necessidade de captura manual.",
      },
    };
    overviewCache = { expiresAt: overviewCacheExpiresAt(seasonCalendar, Date.now()), payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" } });
  } catch (error) {
    console.error(
      "Dashboard overview error:",
      error
    );

    let message =
      "Erro desconhecido no dashboard";

    if (
      error instanceof Error
    ) {
      message =
        error.message;
    } else if (
      error &&
      typeof error === "object"
    ) {
      const obj =
        error as Record<
          string,
          unknown
        >;

      if (
        typeof obj.message ===
        "string"
      ) {
        message =
          obj.message;
      } else {
        try {
          message =
            JSON.stringify(
              error
            );
        } catch {
          message =
            String(error);
        }
      }
    } else {
      message =
        String(error);
    }

    return NextResponse.json(
      {
        status: "error",
        message,
      },
      {
        status: 500,
      }
    );
  }
}
