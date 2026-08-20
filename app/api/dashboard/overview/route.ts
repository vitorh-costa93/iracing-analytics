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
  rating_category: "formula_car" | "sports_car";
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
  rating_category: "formula_car" | "sports_car";
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

type OfficialSeriesResultRow = {
  season_id: string | number;
  season_name: string;
  rating_category: "formula_car" | "sports_car";
  series_name: string;
  starts: number;
  wins: number;
  source: string;
  captured_at: string;
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

    const officialResultsResult = await supabaseAdmin
      .from("official_series_results")
      .select("season_id,season_name,rating_category,series_name,starts,wins,source,captured_at")
      .eq("driver_id", driver.id)
      .in("season_id", [Number(currentSeasonId), Number(previousSeasonId)])
      .order("wins", { ascending: false });

    if (officialResultsResult.error) {
      throwSupabaseError("official_series_results", officialResultsResult.error);
    }

    const officialResults = (officialResultsResult.data ?? []) as OfficialSeriesResultRow[];

    function winsFor(seasonId: string, category: "formula_car" | "sports_car") {
      return officialResults
        .filter((row) => normalizeSeasonId(row.season_id) === seasonId && row.rating_category === category)
        .reduce((total, row) => total + row.wins, 0);
    }

    const resultBreakdown = officialResults.map((row) => ({
      seasonId: normalizeSeasonId(row.season_id),
      seasonName: row.season_name,
      category: row.rating_category,
      series: row.series_name,
      starts: row.starts,
      wins: row.wins,
      source: row.source,
      capturedAt: row.captured_at,
    }));

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

      officialResults: {
        lastCapturedAt: resultBreakdown.reduce<string | null>((latest, row) =>
          !latest || row.capturedAt > latest ? row.capturedAt : latest, null),
        series: resultBreakdown,
      },

      featureAvailability: {
        wins: true,

        winsReason:
          "Resultados oficiais persistidos por temporada; atualização automática aguardando OAuth do iRacing.",
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
