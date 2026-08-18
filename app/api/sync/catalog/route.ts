import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
  try {
    const accounts = await garage61Get<{
      items: {
        platform: string;
        id: string;
        name: string;
      }[];
    }>("/me/accounts");

    const iracingAccount = accounts.items.find(
      (item) => item.platform === "iracing"
    );

    if (!iracingAccount) {
      throw new Error("Conta iRacing não encontrada");
    }

    const { data: driver, error: driverError } =
      await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq(
          "platform_driver_id",
          iracingAccount.id
        )
        .single();

    if (driverError || !driver) {
      throw new Error(
        "Driver não encontrado no Supabase. Rode o sync de profile primeiro."
      );
    }

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

      garage61Get<
        | Garage61StatisticsItem[]
        | Garage61List<Garage61StatisticsItem>
      >("/me/statistics"),
    ]);

    const cars = extractItems(carsResponse);
    const tracks = extractItems(tracksResponse);
    const statistics = extractItems(statsResponse);

    const carRows = cars.map((car) => ({
      id: car.id,
      platform: car.platform ?? "iracing",
      platform_id: car.platform_id ?? null,
      name: car.name,
      variant: car.variant ?? null,
    }));

    const trackRows = tracks.map((track) => ({
      id: track.id,
      platform: track.platform ?? "iracing",
      platform_id: track.platform_id ?? null,
      name: track.name,
      variant: track.variant ?? null,
    }));

    if (carRows.length > 0) {
      const { error } = await supabaseAdmin
        .from("cars")
        .upsert(carRows, {
          onConflict: "id",
        });

      if (error) throw error;
    }

    if (trackRows.length > 0) {
      const { error } = await supabaseAdmin
        .from("tracks")
        .upsert(trackRows, {
          onConflict: "id",
        });

      if (error) throw error;
    }

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
      const { error } = await supabaseAdmin
        .from("daily_statistics")
        .upsert(statisticRows, {
          onConflict:
            "driver_id,statistic_date,car_id,track_id,session_type",
        });

      if (error) throw error;
    }

    return NextResponse.json({
      status: "ok",
      carsSynced: carRows.length,
      tracksSynced: trackRows.length,
      statisticsSynced: statisticRows.length,
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
      { status: 500 }
    );
  }
}
