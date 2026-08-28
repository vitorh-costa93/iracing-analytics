import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

export async function GET() {
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

    // =====================================================
    // SEASONS
    // =====================================================

    const orderedSeasons = [
      ...seasons,
    ].sort(
      (a, b) =>
        seasonNumber(
          b.season_id
        ) -
        seasonNumber(
          a.season_id
        )
    );

    const currentSeason =
      orderedSeasons[0];

    const previousSeason =
      orderedSeasons[1];

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

    const { data: seasonCalendarRows, error: calendarError } = await supabaseAdmin
      .from("v_season_calendar")
      .select("season_id, season_name, season_start")
      .in("season_id", [currentSeasonId, previousSeasonId]);
    if (calendarError) throwSupabaseError("v_season_calendar", calendarError);

    const seasonCalendar = (seasonCalendarRows ?? []) as SeasonCalendarRow[];
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

    for (const row of ratings) {
      if (row.rating_type !== "irating") continue;
      if (
        row.category !==
          "formula_car" &&
        row.category !==
          "sports_car"
      ) {
        continue;
      }

      if (
        latestRatings[
          row.category
        ] === null
      ) {
        latestRatings[
          row.category
        ] = row.rating;
      }
    }

    // iRStats results arrive through the browser bridge before Garage61's rating-history poll
    // necessarily catches up. v_race_results_irating exposes the exact chained value for each
    // imported result, so let the most recent official result win for the headline KPI.
    for (const category of ["formula_car", "sports_car"] as const) {
      const latestResult = seasonRaces.find((row) => row.category === category && Number.isFinite(row.irating_after));
      if (latestResult) latestRatings[category] = latestResult.irating_after;
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

    return NextResponse.json({
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

      races,

      featureAvailability: {
        wins: true,

        winsReason:
          "Wins vêm automaticamente de irstats.com, sem necessidade de captura manual.",
      },
    });
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
