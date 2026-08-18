import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Garage61Account = {
  platform: string;
  id: string;
  name: string;
  ratings: {
    category: string;
    type: string;
    rating: number;
    ratingDisplayAs: string;
  }[];
};

type Garage61Car = {
  id: number;
  platform?: string;
  platform_id?: string;
  name: string;
  variant?: string;
};

type Garage61Track = {
  id: number;
  platform?: string;
  platform_id?: string;
  name: string;
  variant?: string;
};

type Garage61StatisticsItem = {
  day: string;
  car: number;
  track: number;
  sessionType: number;
  events: number;
  timeOnTrack: number;
  lapsDriven: number;
  cleanLapsDriven: number;
};

type Garage61StatisticsResponse = {
  drivingStatistics: Garage61StatisticsItem[];
};

type Garage61List<T> = {
  items: T[];
  total?: number;
};

function extractItems<T>(
  response: T[] | Garage61List<T>
): T[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (
    response &&
    typeof response === "object" &&
    Array.isArray(response.items)
  ) {
    return response.items;
  }

  return [];
}

export async function POST() {
  const startedAt = new Date().toISOString();

  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({
      sync_type: "full",
      status: "running",
      started_at: startedAt,
    })
    .select()
    .single();

  try {
    // PROFILE / DRIVER
    const accountsResponse = await garage61Get<{
      items: Garage61Account[];
      total: number;
    }>("/me/accounts");

    const account = accountsResponse.items.find(
      (item) => item.platform === "iracing"
    );

    if (!account) {
      throw new Error(
        "Conta iRacing não encontrada no Garage61"
      );
    }

    const { data: driver, error: driverError } =
      await supabaseAdmin
        .from("drivers")
        .upsert(
          {
            platform: account.platform,
            platform_driver_id: account.id,
            name: account.name,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "platform_driver_id",
          }
        )
        .select()
        .single();

    if (driverError) {
      throw driverError;
    }

    // RATINGS
    const ratingRows = account.ratings.map((rating) => ({
      driver_id: driver.id,
      category: rating.category,
      rating_type: rating.type,
      rating: rating.rating,
      rating_display: rating.ratingDisplayAs,
      recorded_at: new Date().toISOString(),
    }));

    const { error: ratingsError } = await supabaseAdmin
      .from("ratings")
      .insert(ratingRows);

    if (ratingsError) {
      throw ratingsError;
    }

    // GARAGE61 DATA
    const [
      carsResponse,
      tracksResponse,
      statsResponse,
    ] = await Promise.all([
      garage61Get<
        Garage61Car[] | Garage61List<Garage61Car>
      >("/cars"),

      garage61Get<
        Garage61Track[] | Garage61List<Garage61Track>
      >("/tracks"),

      garage61Get<Garage61StatisticsResponse>(
        "/me/statistics"
      ),
    ]);

    const cars = extractItems(carsResponse);
    const tracks = extractItems(tracksResponse);
    const statistics =
      statsResponse.drivingStatistics ?? [];

    // CARS
    const carRows = cars.map((car) => ({
      id: car.id,
      platform: car.platform ?? "iracing",
      platform_id: car.platform_id ?? null,
      name: car.name,
      variant: car.variant ?? null,
    }));

    if (carRows.length > 0) {
      const { error: carsError } = await supabaseAdmin
        .from("cars")
        .upsert(carRows, {
          onConflict: "id",
        });

      if (carsError) {
        throw carsError;
      }
    }

    // TRACKS
    const trackRows = tracks.map((track) => ({
      id: track.id,
      platform: track.platform ?? "iracing",
      platform_id: track.platform_id ?? null,
      name: track.name,
      variant: track.variant ?? null,
    }));

    if (trackRows.length > 0) {
      const { error: tracksError } = await supabaseAdmin
        .from("tracks")
        .upsert(trackRows, {
          onConflict: "id",
        });

      if (tracksError) {
        throw tracksError;
      }
    }

    // DAILY STATISTICS
    const statisticRows = statistics.map((item) => ({
      driver_id: driver.id,
      statistic_date: item.day,
      car_id: item.car,
      track_id: item.track,
      session_type: item.sessionType,
      events: item.events,
      time_on_track: item.timeOnTrack,
      laps_driven: item.lapsDriven,
      clean_laps_driven: item.cleanLapsDriven,
    }));

    if (statisticRows.length > 0) {
      const { error: statsError } = await supabaseAdmin
        .from("daily_statistics")
        .upsert(statisticRows, {
          onConflict:
            "driver_id,statistic_date,car_id,track_id,session_type",
        });

      if (statsError) {
        throw statsError;
      }
    }

    // SYNC LOG
    const totalRecords =
      ratingRows.length +
      carRows.length +
      trackRows.length +
      statisticRows.length;

    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          records_found: totalRecords,
          records_inserted: totalRecords,
        })
        .eq("id", syncRun.id);
    }

    return NextResponse.json({
      status: "ok",

      driver: {
        id: driver.id,
        name: driver.name,
      },

      ratingsInserted: ratingRows.length,
      carsSynced: carRows.length,
      tracksSynced: trackRows.length,
      statisticsSynced: statisticRows.length,

      debug: {
        carsReceived: cars.length,
        tracksReceived: tracks.length,
        statisticsReceived: statistics.length,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", syncRun.id);
    }

    return NextResponse.json(
      {
        status: "error",
        message,
      },
      { status: 500 }
    );
  }
}
