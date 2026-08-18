import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type RatingRow = {
  category: string;
  rating_type: string;
  rating: number | null;
  rating_display: string | null;
  recorded_at: string;
};

type StatisticRow = {
  statistic_date: string;
  car_id: number | null;
  track_id: number | null;
  session_type: number | null;
  events: number | null;
  time_on_track: number | null;
  laps_driven: number | null;
  clean_laps_driven: number | null;
};

type CatalogRow = {
  id: number;
  name: string;
  variant: string | null;
};

type LapRow = {
  id: string;
  car_id: number | null;
  track_id: number | null;
  lap_number: number | null;
  lap_time: number | null;
  clean: boolean | null;
  driver_rating: number | null;
  telemetry_path: string | null;
};

function catalogName(
  item: CatalogRow | undefined
) {
  if (!item) return "Desconhecido";

  if (item.variant) {
    return `${item.name} — ${item.variant}`;
  }

  return item.name;
}

export async function GET() {
  try {
    // DRIVER
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
      throw driverError;
    }

    if (!driver) {
      throw new Error(
        "Nenhum piloto encontrado no Supabase"
      );
    }

    // CONSULTAS
    const [
      ratingsResult,
      statisticsResult,
      carsResult,
      tracksResult,
      lapsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("ratings")
        .select(
          "category, rating_type, rating, rating_display, recorded_at"
        )
        .eq("driver_id", driver.id)
        .order("recorded_at", {
          ascending: false,
        }),

      supabaseAdmin
        .from("daily_statistics")
        .select(
          `
          statistic_date,
          car_id,
          track_id,
          session_type,
          events,
          time_on_track,
          laps_driven,
          clean_laps_driven
          `
        )
        .eq("driver_id", driver.id)
        .order("statistic_date", {
          ascending: true,
        }),

      supabaseAdmin
        .from("cars")
        .select("id, name, variant"),

      supabaseAdmin
        .from("tracks")
        .select("id, name, variant"),

      supabaseAdmin
        .from("laps")
        .select(
          `
          id,
          car_id,
          track_id,
          lap_number,
          lap_time,
          clean,
          driver_rating,
          telemetry_path
          `
        )
        .eq("driver_id", driver.id),
    ]);

    if (ratingsResult.error) {
      throw ratingsResult.error;
    }

    if (statisticsResult.error) {
      throw statisticsResult.error;
    }

    if (carsResult.error) {
      throw carsResult.error;
    }

    if (tracksResult.error) {
      throw tracksResult.error;
    }

    if (lapsResult.error) {
      throw lapsResult.error;
    }

    const ratings =
      (ratingsResult.data ?? []) as RatingRow[];

    const statistics =
      (statisticsResult.data ??
        []) as StatisticRow[];

    const cars =
      (carsResult.data ?? []) as CatalogRow[];

    const tracks =
      (tracksResult.data ??
        []) as CatalogRow[];

    const laps =
      (lapsResult.data ?? []) as LapRow[];

    // MAPAS
    const carMap = new Map(
      cars.map((car) => [car.id, car])
    );

    const trackMap = new Map(
      tracks.map((track) => [
        track.id,
        track,
      ])
    );

    // ÚLTIMO RATING DE CADA CATEGORIA
    const latestRatings: Record<
      string,
      {
        irating?: {
          value: number | null;
          display: string | null;
        };
        safety_rating?: {
          value: number | null;
          display: string | null;
        };
      }
    > = {};

    for (const rating of ratings) {
      if (!latestRatings[rating.category]) {
        latestRatings[rating.category] = {};
      }

      const category =
        latestRatings[rating.category];

      if (
        rating.rating_type === "irating" &&
        !category.irating
      ) {
        category.irating = {
          value: rating.rating,
          display: rating.rating_display,
        };
      }

      if (
        rating.rating_type ===
          "safety_rating" &&
        !category.safety_rating
      ) {
        category.safety_rating = {
          value: rating.rating,
          display: rating.rating_display,
        };
      }
    }

    // TOTAIS
    let totalEvents = 0;
    let totalLaps = 0;
    let cleanLaps = 0;
    let timeOnTrack = 0;

    const drivenTracks = new Set<number>();

    const carPerformance = new Map<
      number,
      {
        events: number;
        laps: number;
        cleanLaps: number;
        seconds: number;
      }
    >();

    const trackPerformance = new Map<
      number,
      {
        events: number;
        laps: number;
        cleanLaps: number;
        seconds: number;
      }
    >();

    const monthlyActivity = new Map<
      string,
      {
        events: number;
        laps: number;
        cleanLaps: number;
        seconds: number;
      }
    >();

    for (const row of statistics) {
      const events = row.events ?? 0;
      const rowLaps = row.laps_driven ?? 0;
      const rowClean =
        row.clean_laps_driven ?? 0;
      const seconds =
        row.time_on_track ?? 0;

      totalEvents += events;
      totalLaps += rowLaps;
      cleanLaps += rowClean;
      timeOnTrack += seconds;

      if (row.track_id !== null) {
        drivenTracks.add(row.track_id);

        const current =
          trackPerformance.get(
            row.track_id
          ) ?? {
            events: 0,
            laps: 0,
            cleanLaps: 0,
            seconds: 0,
          };

        current.events += events;
        current.laps += rowLaps;
        current.cleanLaps += rowClean;
        current.seconds += seconds;

        trackPerformance.set(
          row.track_id,
          current
        );
      }

      if (row.car_id !== null) {
        const current =
          carPerformance.get(
            row.car_id
          ) ?? {
            events: 0,
            laps: 0,
            cleanLaps: 0,
            seconds: 0,
          };

        current.events += events;
        current.laps += rowLaps;
        current.cleanLaps += rowClean;
        current.seconds += seconds;

        carPerformance.set(
          row.car_id,
          current
        );
      }

      const month =
        row.statistic_date.slice(0, 7);

      const currentMonth =
        monthlyActivity.get(month) ?? {
          events: 0,
          laps: 0,
          cleanLaps: 0,
          seconds: 0,
        };

      currentMonth.events += events;
      currentMonth.laps += rowLaps;
      currentMonth.cleanLaps += rowClean;
      currentMonth.seconds += seconds;

      monthlyActivity.set(
        month,
        currentMonth
      );
    }

    // TOP CARS
    const topCars = Array.from(
      carPerformance.entries()
    )
      .map(([id, value]) => ({
        id,
        name: catalogName(
          carMap.get(id)
        ),
        ...value,
      }))
      .sort((a, b) => b.laps - a.laps)
      .slice(0, 8);

    // TOP TRACKS
    const topTracks = Array.from(
      trackPerformance.entries()
    )
      .map(([id, value]) => ({
        id,
        name: catalogName(
          trackMap.get(id)
        ),
        ...value,
      }))
      .sort((a, b) => b.laps - a.laps)
      .slice(0, 8);

    // ATIVIDADE POR MÊS
    const activity = Array.from(
      monthlyActivity.entries()
    )
      .map(([month, value]) => ({
        month,
        ...value,
      }))
      .sort((a, b) =>
        a.month.localeCompare(b.month)
      )
      .slice(-12);

    // MELHORES LAPS DISPONÍVEIS
    const bestLaps = laps
      .filter(
        (lap) =>
          lap.lap_time !== null &&
          lap.lap_time > 0
      )
      .sort(
        (a, b) =>
          (a.lap_time ?? Infinity) -
          (b.lap_time ?? Infinity)
      )
      .slice(0, 10)
      .map((lap) => ({
        id: lap.id,

        car:
          lap.car_id !== null
            ? catalogName(
                carMap.get(lap.car_id)
              )
            : "Desconhecido",

        track:
          lap.track_id !== null
            ? catalogName(
                trackMap.get(
                  lap.track_id
                )
              )
            : "Desconhecido",

        lapNumber:
          lap.lap_number,

        lapTime:
          lap.lap_time,

        clean:
          lap.clean,

        driverRating:
          lap.driver_rating,

        telemetryAvailable:
          Boolean(
            lap.telemetry_path
          ),
      }));

    return NextResponse.json({
      status: "ok",

      driver: {
        id: driver.id,
        name: driver.name,
        iracingId:
          driver.platform_driver_id,
      },

      ratings:
        latestRatings,

      totals: {
        events:
          totalEvents,

        laps:
          totalLaps,

        cleanLaps,

        cleanPercentage:
          totalLaps > 0
            ? (cleanLaps /
                totalLaps) *
              100
            : 0,

        timeOnTrackSeconds:
          timeOnTrack,

        drivenTracks:
          drivenTracks.size,

        telemetryLaps:
          laps.filter(
            (lap) =>
              lap.telemetry_path
          ).length,
      },

      activity,

      topCars,

      topTracks,

      bestLaps,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",

        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
