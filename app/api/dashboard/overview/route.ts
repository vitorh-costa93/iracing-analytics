import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SeasonSummaryRow = {
  season_id: string;
  season_name: string;
  race_sessions: number | null;
  total_laps: number | null;
};

type CategorySummaryRow = {
  season_id: string;
  season_name: string;
  rating_category: "formula_car" | "sports_car";
  corridas: number | null;
  delta_irating: number | null;
  delta_medio: number | null;
  mediana: number | null;
  pct_positivas: number | null;
};

type WeeklyRow = {
  season_id: string;
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

function seasonNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

export async function GET() {
  try {
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, name, platform_driver_id, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (driverError) throw driverError;
    if (!driver) throw new Error("Nenhum piloto encontrado no Supabase");

    const [
      seasonsResult,
      categoriesResult,
      weeklyResult,
      historicalResult,
      ratingsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("v_season_summary")
        .select("season_id, season_name, race_sessions, total_laps"),

      supabaseAdmin
        .from("v_season_category_summary")
        .select(
          "season_id, season_name, rating_category, corridas, delta_irating, delta_medio, mediana, pct_positivas"
        ),

      supabaseAdmin
        .from("v_season_weekly_irating")
        .select(
          "season_id, season_name, rating_category, week_number, week_start, week_end, irating_before_week, irating_first, irating_end_of_week, weekly_delta, irating_min, irating_max, rating_changes, races, cars, tracks"
        )
        .order("week_number", { ascending: true }),

      supabaseAdmin
        .from("v_historical_performance")
        .select(
          "rating_category, car_class, car, track, races, delta_irating, avg_delta_irating"
        ),

      supabaseAdmin
        .from("ratings")
        .select("category, rating_type, rating, rating_display, recorded_at")
        .eq("driver_id", driver.id)
        .eq("rating_type", "irating")
        .order("recorded_at", { ascending: false }),
    ]);

    if (seasonsResult.error) throw seasonsResult.error;
    if (categoriesResult.error) throw categoriesResult.error;
    if (weeklyResult.error) throw weeklyResult.error;
    if (historicalResult.error) throw historicalResult.error;
    if (ratingsResult.error) throw ratingsResult.error;

    const seasons = (seasonsResult.data ?? []) as SeasonSummaryRow[];
    const categories = (categoriesResult.data ?? []) as CategorySummaryRow[];
    const weekly = (weeklyResult.data ?? []) as WeeklyRow[];
    const historical = (historicalResult.data ?? []) as HistoricalRow[];
    const ratings = (ratingsResult.data ?? []) as RatingRow[];

    const orderedSeasons = [...seasons].sort(
      (a, b) => seasonNumber(b.season_id) - seasonNumber(a.season_id)
    );

    const currentSeason = orderedSeasons[0];
    const previousSeason = orderedSeasons[1];

    if (!currentSeason || !previousSeason) {
      throw new Error("São necessárias pelo menos duas seasons para o comparativo");
    }

    const latestRatings: Record<string, number | null> = {
      formula_car: null,
      sports_car: null,
    };

    for (const row of ratings) {
      if (
        (row.category === "formula_car" || row.category === "sports_car") &&
        latestRatings[row.category] === null
      ) {
        latestRatings[row.category] = row.rating;
      }
    }

    function categoryMetric(
      seasonId: string,
      category: "formula_car" | "sports_car"
    ) {
      const row = categories.find(
        (item) =>
          item.season_id === seasonId && item.rating_category === category
      );

      return {
        delta: row?.delta_irating ?? 0,
        races: row?.corridas ?? 0,
        avgDelta: row?.delta_medio ?? null,
        medianDelta: row?.mediana ?? null,
        positivePct: row?.pct_positivas ?? null,
      };
    }

    function weeklyFor(
      seasonId: string,
      category: "formula_car" | "sports_car"
    ) {
      return weekly
        .filter(
          (row) =>
            row.season_id === seasonId && row.rating_category === category
        )
        .sort((a, b) => a.week_number - b.week_number)
        .map((row) => ({
          week: row.week_number,
          weekStart: row.week_start,
          weekEnd: row.week_end,
          iratingBeforeWeek: row.irating_before_week,
          iratingFirst: row.irating_first,
          iratingEnd: row.irating_end_of_week,
          delta: row.weekly_delta,
          min: row.irating_min,
          max: row.irating_max,
          ratingChanges: row.rating_changes ?? 0,
          races: row.races ?? 0,
          cars: row.cars ?? [],
          tracks: row.tracks ?? [],
        }));
    }

    return NextResponse.json({
      status: "ok",
      driver: {
        id: driver.id,
        name: driver.name,
        iracingId: driver.platform_driver_id,
      },
      season: {
        current: {
          id: currentSeason.season_id,
          name: currentSeason.season_name,
          races: currentSeason.race_sessions ?? 0,
          laps: currentSeason.total_laps ?? 0,
        },
        previous: {
          id: previousSeason.season_id,
          name: previousSeason.season_name,
          races: previousSeason.race_sessions ?? 0,
          laps: previousSeason.total_laps ?? 0,
        },
      },
      ratings: latestRatings,
      kpis: {
        formula: {
          current: categoryMetric(currentSeason.season_id, "formula_car"),
          previous: categoryMetric(previousSeason.season_id, "formula_car"),
          wins: { current: null, previous: null },
        },
        sports: {
          current: categoryMetric(currentSeason.season_id, "sports_car"),
          previous: categoryMetric(previousSeason.season_id, "sports_car"),
          wins: { current: null, previous: null },
        },
      },
      weekly: {
        formula: {
          current: weeklyFor(currentSeason.season_id, "formula_car"),
          previous: weeklyFor(previousSeason.season_id, "formula_car"),
        },
        sports: {
          current: weeklyFor(currentSeason.season_id, "sports_car"),
          previous: weeklyFor(previousSeason.season_id, "sports_car"),
        },
      },
      historical: historical.map((row) => ({
        ratingCategory: row.rating_category,
        carClass: row.car_class,
        car: row.car,
        track: row.track,
        races: row.races ?? 0,
        delta: row.delta_irating ?? 0,
        avgDelta: row.avg_delta_irating ?? 0,
      })),
      featureAvailability: {
        wins: false,
        winsReason: "Aguardando endpoint público de resultados do Garage61",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
