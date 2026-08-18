import { NextRequest, NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Garage61Lap = {
  id: string;

  driver?: {
    id?: string;
    slug?: string;
    firstname?: string;
    lastname?: string;
    driverRating?: number;
  };

  event?: string;
  eventType?: number;

  session?: number;
  sessionType?: number;
  run?: number;

  season?: {
    id?: string;
    name?: string;
    shortName?: string;
    start?: string;
    end?: string;
  };

  car?: {
    id: number;
    name?: string;
    platform?: string;
    platform_id?: string;
  };

  track?: {
    id: number;
    name?: string;
    variant?: string;
    platform?: string;
    platform_id?: string;
  };

  startTime?: string;

  lapNumber?: number;
  lapTime?: number;

  clean?: boolean;
  joker?: boolean;
  discontinuity?: boolean;
  missing?: boolean;
  incomplete?: boolean;
  offtrack?: boolean;
  pitLane?: boolean;
  pitIn?: boolean;
  pitOut?: boolean;

  driverRating?: number;

  airPressure?: number;
  windVel?: number;
  windDir?: number;
  relativeHumidity?: number;
  fogLevel?: number;

  trackTemp?: number;
  trackUsage?: number;
  trackWetness?: number;

  sectors?: {
    sectorTime?: number;
    incomplete?: boolean;
  }[];

  fuelLevel?: number;
  fuelUsed?: number;
  fuelAdded?: number;

  weightPenalty?: number;
  powerAdjust?: number;
  tireCompound?: number;

  ghostAvailable?: boolean;
  canViewTelemetry?: boolean;
  canViewSetup?: boolean;
};

type Garage61LapsResponse = {
  items: Garage61Lap[];
  total?: number;
};

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const track = searchParams.get("track") ?? "418";

    const accounts = await garage61Get<{
      items: {
        platform: string;
        id: string;
      }[];
    }>("/me/accounts");

    const account = accounts.items.find(
      (item) => item.platform === "iracing"
    );

    if (!account) {
      throw new Error("Conta iRacing não encontrada");
    }

    const { data: driver, error: driverError } =
      await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("platform_driver_id", account.id)
        .single();

    if (driverError || !driver) {
      throw new Error(
        "Driver não encontrado no Supabase"
      );
    }

    const response =
      await garage61Get<Garage61LapsResponse>(
        "/laps",
        {
          tracks: track,
        }
      );

    const laps = response.items ?? [];

    let synced = 0;
    let sectorsSynced = 0;

    for (const lap of laps) {
      if (!lap.car?.id || !lap.track?.id) {
        continue;
      }

      const { data: session, error: sessionError } =
        await supabaseAdmin
          .from("sessions")
          .insert({
            garage61_event_id: lap.event ?? null,
            garage61_session_id:
              lap.session !== undefined
                ? String(lap.session)
                : null,

            driver_id: driver.id,
            car_id: lap.car.id,
            track_id: lap.track.id,

            season_id: lap.season?.id ?? null,
            season_name: lap.season?.name ?? null,

            event_type: lap.eventType ?? null,
            session_type: lap.sessionType ?? null,
            run: lap.run ?? null,

            started_at: lap.startTime ?? null,

            air_pressure: lap.airPressure ?? null,
            wind_velocity: lap.windVel ?? null,
            wind_direction: lap.windDir ?? null,
            relative_humidity:
              lap.relativeHumidity ?? null,
            fog_level: lap.fogLevel ?? null,

            track_temp: lap.trackTemp ?? null,
            track_usage: lap.trackUsage ?? null,
            track_wetness: lap.trackWetness ?? null,
          })
          .select("id")
          .single();

      if (sessionError) {
        throw sessionError;
      }

      const { error: lapError } =
        await supabaseAdmin
          .from("laps")
          .upsert(
            {
              id: lap.id,

              session_id: session.id,
              driver_id: driver.id,

              car_id: lap.car.id,
              track_id: lap.track.id,

              lap_number: lap.lapNumber ?? null,
              lap_time: lap.lapTime ?? null,

              clean: lap.clean ?? null,
              joker: lap.joker ?? null,
              discontinuity:
                lap.discontinuity ?? null,
              missing: lap.missing ?? null,
              incomplete: lap.incomplete ?? null,
              off_track: lap.offtrack ?? null,

              pit_lane: lap.pitLane ?? null,
              pit_in: lap.pitIn ?? null,
              pit_out: lap.pitOut ?? null,

              driver_rating:
                lap.driverRating ??
                lap.driver?.driverRating ??
                null,

              fuel_level: lap.fuelLevel ?? null,
              fuel_used: lap.fuelUsed ?? null,
              fuel_added: lap.fuelAdded ?? null,

              weight_penalty:
                lap.weightPenalty ?? null,

              power_adjust:
                lap.powerAdjust ?? null,

              tire_compound:
                lap.tireCompound ?? null,

              can_view_telemetry:
                lap.canViewTelemetry ?? false,

              can_view_setup:
                lap.canViewSetup ?? false,

              garage61_payload: lap,

              synced_at:
                new Date().toISOString(),
            },
            {
              onConflict: "id",
            }
          );

      if (lapError) {
        throw lapError;
      }

      synced++;

      if (
        lap.sectors &&
        Array.isArray(lap.sectors)
      ) {
        const sectorRows = lap.sectors.map(
          (sector, index) => ({
            lap_id: lap.id,
            sector_number: index + 1,
            sector_time:
              sector.sectorTime ?? null,
            incomplete:
              sector.incomplete ?? false,
          })
        );

        if (sectorRows.length > 0) {
          const { error: sectorError } =
            await supabaseAdmin
              .from("lap_sectors")
              .upsert(sectorRows, {
                onConflict:
                  "lap_id,sector_number",
              });

          if (sectorError) {
            throw sectorError;
          }

          sectorsSynced +=
            sectorRows.length;
        }
      }
    }

    return NextResponse.json({
      status: "ok",
      track,
      lapsReceived: laps.length,
      lapsSynced: synced,
      sectorsSynced,
      totalAvailable: response.total ?? null,
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
