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

type Garage61List<T> = {
  items: T[];
  total?: number;
};

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
    const accountsResponse = await garage61Get<{
      items: Garage61Account[];
      total: number;
    }>("/me/accounts");

    const account = accountsResponse.items.find(
      (item) => item.platform === "iracing"
    );

    if (!account) {
      throw new Error("Conta iRacing não encontrada no Garage61");
    }

    const { data: driver, error: driverError } = await supabaseAdmin
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

    const [carsResponse, tracksResponse, statsResponse] = await Promise.all([
      garage61Get<Garage61List<Garage61Car>>("/cars"),
      garage61Get<Garage61List<Garage61Track>>("/tracks"),
      garage61Get<Garage61StatisticsItem[]>("/me/statistics"),
    ]);

    const carRows = carsResponse.items.map((car) => ({
      id: car.id,
      platform: car.platform ?? "iracing",
      platform_id: car.platform_id ?? null,
      name: car.name,
      variant: car.variant ?? null,
    }));

    const trackRows = tracksResponse.items.map((track) => ({
      id: track.id,
      platform: track.platform ?? "iracing",
      platform_id: track.platform_id ?? null,
      name: track.name,
      variant: track.variant ?? null,
    }));

    const { error: carsError } = await supabaseAdmin
      .from("cars")
      .upsert(carRows, {
        onConflict: "id",
      });

    if (carsError) {
      throw carsError;
    }

    const { error: tracksError } = await supabaseAdmin
      .from("tracks")
      .upsert(trackRows, {
        onConflict: "id",
      });

    if (tracksError) {
      throw tracksError;
    }

    const statisticRows = statsResponse.map((item) => ({
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

    const { error: statsError } = await supabaseAdmin
      .from("daily_statistics")
      .upsert(statisticRows, {
        onConflict:
          "driver_id,statistic_date,car_id,track_id,session_type",
      });

    if (statsError) {
      throw statsError;
    }

    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          records_found:
            ratingRows.length +
            carRows.length +
            trackRows.length +
            statisticRows.length,
          records_inserted:
            ratingRows.length +
            carRows.length +
            trackRows.length +
            statisticRows.length,
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
    });
  } catch (error) {
    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message:
            error instanceof Error ? error.message : String(error),
        })
        .eq("id", syncRun.id);
    }

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
