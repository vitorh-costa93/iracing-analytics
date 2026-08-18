import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

const GARAGE61_BASE_URL = "https://garage61.net/api/v1";

type Garage61Lap = {
  id: string;

  driver?: {
    id?: string;
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
  };

  car?: {
    id: number;
  };

  track?: {
    id: number;
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

  canViewTelemetry?: boolean;
  canViewSetup?: boolean;
};

type Garage61LapsResponse = {
  items: Garage61Lap[];
  total?: number;
};

function getGarage61Token() {
  const token = process.env.GARAGE61_API_TOKEN;

  if (!token) {
    throw new Error("GARAGE61_API_TOKEN não configurado");
  }

  return token;
}

async function getTelemetryCsv(lapId: string) {
  const response = await fetch(
    `${GARAGE61_BASE_URL}/laps/${encodeURIComponent(lapId)}/csv`,
    {
      headers: {
        Authorization: `Bearer ${getGarage61Token()}`,
        Accept: "text/csv",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Falha ao buscar telemetria ${lapId}: ${response.status} ${text}`
    );
  }

  return await response.arrayBuffer();
}

export async function POST() {
  const startedAt = new Date().toISOString();

  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({
      sync_type: "laps_all",
      status: "running",
      started_at: startedAt,
    })
    .select()
    .single();

  try {
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
      throw new Error("Driver não encontrado no Supabase");
    }

    const { data: statistics, error: statsError } =
      await supabaseAdmin
        .from("daily_statistics")
        .select("track_id")
        .eq("driver_id", driver.id)
        .not("track_id", "is", null);

    if (statsError) {
      throw statsError;
    }

    const trackIds = Array.from(
      new Set(
        (statistics ?? [])
          .map((row) => row.track_id)
          .filter((id): id is number => typeof id === "number")
      )
    );

    let tracksProcessed = 0;
    let lapsReceived = 0;
    let lapsSynced = 0;
    let sectorsSynced = 0;
    let telemetrySynced = 0;
    let telemetrySkippedExisting = 0;
    let telemetryFailed = 0;

    for (const trackId of trackIds) {
      const response =
        await garage61Get<Garage61LapsResponse>(
          "/laps",
          {
            tracks: trackId,
          }
        );

      const laps = response.items ?? [];

      tracksProcessed++;
      lapsReceived += laps.length;

      for (const lap of laps) {
        if (!lap.car?.id || !lap.track?.id) {
          continue;
        }

        // SESSION
        let sessionQuery = supabaseAdmin
          .from("sessions")
          .select("id")
          .eq(
            "garage61_event_id",
            lap.event ?? ""
          )
          .eq(
            "garage61_session_id",
            lap.session !== undefined
              ? String(lap.session)
              : ""
          )
          .eq("driver_id", driver.id)
          .eq("car_id", lap.car.id)
          .eq("track_id", lap.track.id);

        if (lap.startTime) {
          sessionQuery = sessionQuery.eq(
            "started_at",
            lap.startTime
          );
        } else {
          sessionQuery = sessionQuery.is(
            "started_at",
            null
          );
        }

        const {
          data: existingSession,
          error: findSessionError,
        } = await sessionQuery.maybeSingle();

        if (findSessionError) {
          throw findSessionError;
        }

        let sessionId: string;

        if (existingSession) {
          sessionId = existingSession.id;
        } else {
          const {
            data: createdSession,
            error: sessionError,
          } = await supabaseAdmin
            .from("sessions")
            .insert({
              garage61_event_id:
                lap.event ?? "",

              garage61_session_id:
                lap.session !== undefined
                  ? String(lap.session)
                  : "",

              driver_id: driver.id,
              car_id: lap.car.id,
              track_id: lap.track.id,

              season_id:
                lap.season?.id ?? null,

              season_name:
                lap.season?.name ?? null,

              event_type:
                lap.eventType ?? null,

              session_type:
                lap.sessionType ?? null,

              run:
                lap.run ?? null,

              started_at:
                lap.startTime ?? null,

              air_pressure:
                lap.airPressure ?? null,

              wind_velocity:
                lap.windVel ?? null,

              wind_direction:
                lap.windDir ?? null,

              relative_humidity:
                lap.relativeHumidity ?? null,

              fog_level:
                lap.fogLevel ?? null,

              track_temp:
                lap.trackTemp ?? null,

              track_usage:
                lap.trackUsage ?? null,

              track_wetness:
                lap.trackWetness ?? null,
            })
            .select("id")
            .single();

          if (sessionError || !createdSession) {
            throw sessionError ??
              new Error("Erro ao criar sessão");
          }

          sessionId = createdSession.id;
        }

        // Verifica se lap já existe e se telemetria já foi salva
        const {
          data: existingLap,
          error: existingLapError,
        } = await supabaseAdmin
          .from("laps")
          .select("id, telemetry_path")
          .eq("id", lap.id)
          .maybeSingle();

        if (existingLapError) {
          throw existingLapError;
        }

        let telemetryPath =
          existingLap?.telemetry_path ?? null;

        if (
          lap.canViewTelemetry &&
          !telemetryPath
        ) {
          const path =
            `laps/${lap.track.id}/${lap.id}.csv`;

          try {
            const csv =
              await getTelemetryCsv(lap.id);

            const { error: uploadError } =
              await supabaseAdmin.storage
                .from("telemetry")
                .upload(
                  path,
                  csv,
                  {
                    contentType:
                      "text/csv; charset=utf-8",
                    upsert: true,
                  }
                );

            if (uploadError) {
              throw uploadError;
            }

            telemetryPath = path;
            telemetrySynced++;
          } catch (telemetryError) {
            console.error(
              `Erro na telemetria ${lap.id}:`,
              telemetryError
            );

            telemetryFailed++;
          }
        } else if (
          lap.canViewTelemetry &&
          telemetryPath
        ) {
          telemetrySkippedExisting++;
        }

        // LAP
        const { error: lapError } =
          await supabaseAdmin
            .from("laps")
            .upsert(
              {
                id: lap.id,

                session_id: sessionId,
                driver_id: driver.id,

                car_id: lap.car.id,
                track_id: lap.track.id,

                lap_number:
                  lap.lapNumber ?? null,

                lap_time:
                  lap.lapTime ?? null,

                clean:
                  lap.clean ?? null,

                joker:
                  lap.joker ?? null,

                discontinuity:
                  lap.discontinuity ?? null,

                missing:
                  lap.missing ?? null,

                incomplete:
                  lap.incomplete ?? null,

                off_track:
                  lap.offtrack ?? null,

                pit_lane:
                  lap.pitLane ?? null,

                pit_in:
                  lap.pitIn ?? null,

                pit_out:
                  lap.pitOut ?? null,

                driver_rating:
                  lap.driverRating ??
                  lap.driver?.driverRating ??
                  null,

                fuel_level:
                  lap.fuelLevel ?? null,

                fuel_used:
                  lap.fuelUsed ?? null,

                fuel_added:
                  lap.fuelAdded ?? null,

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

                telemetry_path:
                  telemetryPath,

                garage61_payload:
                  lap,

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

        lapsSynced++;

        // SECTORS
        if (
          lap.sectors &&
          Array.isArray(lap.sectors)
        ) {
          const sectorRows =
            lap.sectors.map(
              (sector, index) => ({
                lap_id: lap.id,

                sector_number:
                  index + 1,

                sector_time:
                  sector.sectorTime ??
                  null,

                incomplete:
                  sector.incomplete ??
                  false,
              })
            );

          if (sectorRows.length > 0) {
            const {
              error: sectorError,
            } = await supabaseAdmin
              .from("lap_sectors")
              .upsert(
                sectorRows,
                {
                  onConflict:
                    "lap_id,sector_number",
                }
              );

            if (sectorError) {
              throw sectorError;
            }

            sectorsSynced +=
              sectorRows.length;
          }
        }
      }
    }

    if (syncRun?.id) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "completed",
          finished_at:
            new Date().toISOString(),
          records_found:
            lapsReceived,
          records_inserted:
            lapsSynced,
        })
        .eq("id", syncRun.id);
    }

    return NextResponse.json({
      status: "ok",

      tracksFound:
        trackIds.length,

      tracksProcessed,

      lapsReceived,

      lapsSynced,

      sectorsSynced,

      telemetrySynced,

      telemetrySkippedExisting,

      telemetryFailed,
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
          finished_at:
            new Date().toISOString(),
          error_message:
            message,
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
