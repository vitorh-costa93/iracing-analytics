import { NextRequest, NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

const TRACK_BATCH_SIZE = 10;

// Reduzi para 250 de propósito.
// 1000 laps em uma única função pode estourar timeout.
const PAGE_SIZE = 250;

function chunkArray<T>(
  items: T[],
  size: number
): T[][] {
  const chunks: T[][] = [];

  for (
    let i = 0;
    i < items.length;
    i += size
  ) {
    chunks.push(
      items.slice(i, i + size)
    );
  }

  return chunks;
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request
        .json()
        .catch(() => ({}));

    const batchIndex =
      Number(body.batch ?? 0);

    const offset =
      Number(body.offset ?? 0);

    // ----------------------------------------
    // DRIVER
    // ----------------------------------------

    const accounts =
      await garage61Get<{
        items: {
          platform: string;
          id: string;
        }[];
      }>("/me/accounts");

    const account =
      accounts.items.find(
        (item) =>
          item.platform ===
          "iracing"
      );

    if (!account) {
      throw new Error(
        "Conta iRacing não encontrada"
      );
    }

    const {
      data: driver,
      error: driverError,
    } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq(
        "platform_driver_id",
        account.id
      )
      .single();

    if (
      driverError ||
      !driver
    ) {
      throw new Error(
        "Driver não encontrado no Supabase"
      );
    }

    // ----------------------------------------
    // TRACKS USADAS
    // ----------------------------------------

    const {
      data: stats,
      error: statsError,
    } = await supabaseAdmin
      .from("daily_statistics")
      .select("track_id")
      .eq(
        "driver_id",
        driver.id
      )
      .not(
        "track_id",
        "is",
        null
      );

    if (statsError) {
      throw statsError;
    }

    const trackIds =
      Array.from(
        new Set(
          (stats ?? [])
            .map(
              (row) =>
                row.track_id
            )
            .filter(
              (
                id
              ): id is number =>
                typeof id ===
                "number"
            )
        )
      );

    const trackBatches =
      chunkArray(
        trackIds,
        TRACK_BATCH_SIZE
      );

    if (
      batchIndex >=
      trackBatches.length
    ) {
      return NextResponse.json({
        status: "ok",
        completed: true,
        tracksUsed:
          trackIds.length,
        totalBatches:
          trackBatches.length,
      });
    }

    const batch =
      trackBatches[batchIndex];

    const tracksParam =
      batch.join(",");

    // ----------------------------------------
    // GARAGE61 PAGE
    // ----------------------------------------

    const response =
      await garage61Get<Garage61LapsResponse>(
        "/laps",
        {
          tracks:
            tracksParam,

          drivers:
            "me",

          group:
            "none",

          unclean:
            "true",

          lapTypes:
            "1,2,3,4",

          limit:
            PAGE_SIZE,

          offset,
        }
      );

    const laps =
      response.items ?? [];

    let lapsSynced = 0;
    let sectorsSynced = 0;
    let telemetryAvailable = 0;

    // ----------------------------------------
    // PROCESSAR LAPS
    // ----------------------------------------

    for (const lap of laps) {
      if (
        !lap.car?.id ||
        !lap.track?.id
      ) {
        continue;
      }

      if (
        lap.canViewTelemetry
      ) {
        telemetryAvailable++;
      }

      // --------------------------------------
      // SESSION
      // --------------------------------------

      let sessionQuery =
        supabaseAdmin
          .from("sessions")
          .select("id")
          .eq(
            "garage61_event_id",
            lap.event ?? ""
          )
          .eq(
            "garage61_session_id",
            lap.session !==
              undefined
              ? String(
                  lap.session
                )
              : ""
          )
          .eq(
            "driver_id",
            driver.id
          )
          .eq(
            "car_id",
            lap.car.id
          )
          .eq(
            "track_id",
            lap.track.id
          );

      if (lap.startTime) {
        sessionQuery =
          sessionQuery.eq(
            "started_at",
            lap.startTime
          );
      } else {
        sessionQuery =
          sessionQuery.is(
            "started_at",
            null
          );
      }

      const {
        data:
          existingSession,
        error:
          findSessionError,
      } =
        await sessionQuery
          .maybeSingle();

      if (
        findSessionError
      ) {
        throw findSessionError;
      }

      let sessionId: string;

      if (
        existingSession
      ) {
        sessionId =
          existingSession.id;
      } else {
        const {
          data:
            createdSession,
          error:
            sessionError,
        } =
          await supabaseAdmin
            .from("sessions")
            .insert({
              garage61_event_id:
                lap.event ?? "",

              garage61_session_id:
                lap.session !==
                  undefined
                  ? String(
                      lap.session
                    )
                  : "",

              driver_id:
                driver.id,

              car_id:
                lap.car.id,

              track_id:
                lap.track.id,

              season_id:
                lap.season
                  ?.id ??
                null,

              season_name:
                lap.season
                  ?.name ??
                null,

              event_type:
                lap.eventType ??
                null,

              session_type:
                lap.sessionType ??
                null,

              run:
                lap.run ??
                null,

              started_at:
                lap.startTime ??
                null,

              air_pressure:
                lap.airPressure ??
                null,

              wind_velocity:
                lap.windVel ??
                null,

              wind_direction:
                lap.windDir ??
                null,

              relative_humidity:
                lap.relativeHumidity ??
                null,

              fog_level:
                lap.fogLevel ??
                null,

              track_temp:
                lap.trackTemp ??
                null,

              track_usage:
                lap.trackUsage ??
                null,

              track_wetness:
                lap.trackWetness ??
                null,
            })
            .select("id")
            .single();

        if (
          sessionError ||
          !createdSession
        ) {
          throw (
            sessionError ??
            new Error(
              "Erro ao criar sessão"
            )
          );
        }

        sessionId =
          createdSession.id;
      }

      // --------------------------------------
      // LAP EXISTENTE
      // --------------------------------------

      const {
        data:
          existingLap,
        error:
          existingLapError,
      } =
        await supabaseAdmin
          .from("laps")
          .select(
            "id, telemetry_path"
          )
          .eq(
            "id",
            lap.id
          )
          .maybeSingle();

      if (
        existingLapError
      ) {
        throw existingLapError;
      }

      // --------------------------------------
      // UPSERT LAP
      // --------------------------------------

      const {
        error:
          lapError,
      } =
        await supabaseAdmin
          .from("laps")
          .upsert(
            {
              id:
                lap.id,

              session_id:
                sessionId,

              driver_id:
                driver.id,

              car_id:
                lap.car.id,

              track_id:
                lap.track.id,

              lap_number:
                lap.lapNumber ??
                null,

              lap_time:
                lap.lapTime ??
                null,

              clean:
                lap.clean ??
                null,

              joker:
                lap.joker ??
                null,

              discontinuity:
                lap.discontinuity ??
                null,

              missing:
                lap.missing ??
                null,

              incomplete:
                lap.incomplete ??
                null,

              off_track:
                lap.offtrack ??
                null,

              pit_lane:
                lap.pitLane ??
                null,

              pit_in:
                lap.pitIn ??
                null,

              pit_out:
                lap.pitOut ??
                null,

              driver_rating:
                lap.driverRating ??
                lap.driver
                  ?.driverRating ??
                null,

              fuel_level:
                lap.fuelLevel ??
                null,

              fuel_used:
                lap.fuelUsed ??
                null,

              fuel_added:
                lap.fuelAdded ??
                null,

              weight_penalty:
                lap.weightPenalty ??
                null,

              power_adjust:
                lap.powerAdjust ??
                null,

              tire_compound:
                lap.tireCompound ??
                null,

              can_view_telemetry:
                lap.canViewTelemetry ??
                false,

              can_view_setup:
                lap.canViewSetup ??
                false,

              telemetry_path:
                existingLap
                  ?.telemetry_path ??
                null,

              garage61_payload:
                lap,

              synced_at:
                new Date()
                  .toISOString(),
            },
            {
              onConflict:
                "id",
            }
          );

      if (lapError) {
        throw lapError;
      }

      lapsSynced++;

      // --------------------------------------
      // SECTORS
      // --------------------------------------

      if (
        lap.sectors &&
        Array.isArray(
          lap.sectors
        )
      ) {
        const sectorRows =
          lap.sectors.map(
            (
              sector,
              index
            ) => ({
              lap_id:
                lap.id,

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

        if (
          sectorRows.length >
          0
        ) {
          const {
            error:
              sectorError,
          } =
            await supabaseAdmin
              .from(
                "lap_sectors"
              )
              .upsert(
                sectorRows,
                {
                  onConflict:
                    "lap_id,sector_number",
                }
              );

          if (
            sectorError
          ) {
            throw sectorError;
          }

          sectorsSynced +=
            sectorRows.length;
        }
      }
    }

    // ----------------------------------------
    // DEFINIR PRÓXIMO CHECKPOINT
    // ----------------------------------------

    let nextBatch =
      batchIndex;

    let nextOffset =
      offset +
      PAGE_SIZE;

    let completed =
      false;

    if (
      laps.length <
      PAGE_SIZE
    ) {
      nextBatch =
        batchIndex + 1;

      nextOffset = 0;
    }

    if (
      nextBatch >=
      trackBatches.length
    ) {
      completed = true;
    }

    return NextResponse.json({
      status: "ok",

      completed,

      tracksUsed:
        trackIds.length,

      totalBatches:
        trackBatches.length,

      currentBatch:
        batchIndex,

      currentBatchTracks:
        batch,

      offset,

      pageSize:
        PAGE_SIZE,

      lapsReceived:
        laps.length,

      lapsSynced,

      sectorsSynced,

      telemetryAvailable,

      totalAvailableForBatch:
        response.total ?? null,

      nextBatch,

      nextOffset,
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
