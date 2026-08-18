import { NextRequest, NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    const eventId =
      request.nextUrl.searchParams.get("event");

    if (!eventId) {
      return NextResponse.json(
        {
          status: "error",
          message: "Informe ?event=GARAGE61_EVENT_ID",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------
    // LOCALIZAR O EVENTO NO NOSSO BANCO
    // ----------------------------------------

    const {
      data: session,
      error: sessionError,
    } = await supabaseAdmin
      .from("driving_sessions")
      .select(`
        id,
        garage61_event_id,
        garage61_session_id,
        track_id,
        car_id,
        started_at,
        ended_at
      `)
      .eq(
        "garage61_event_id",
        eventId
      )
      .order(
        "started_at",
        { ascending: true }
      )
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      throw sessionError;
    }

    if (!session) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Evento não encontrado em driving_sessions",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // PEGAR PLATFORM_ID DA PISTA
    // ----------------------------------------

    const {
      data: track,
      error: trackError,
    } = await supabaseAdmin
      .from("tracks")
      .select(
        "id, platform_id, name"
      )
      .eq(
        "id",
        session.track_id
      )
      .single();

    if (
      trackError ||
      !track
    ) {
      throw (
        trackError ??
        new Error(
          "Pista não encontrada"
        )
      );
    }

    // ----------------------------------------
    // TESTE 1
    //
    // Garage61 /laps exige tracks.
    // Aqui usamos o ID Garage61 da pista.
    // ----------------------------------------

    const data =
      await garage61Get(
        "/laps",
        {
          tracks:
            String(track.id),

          drivers:
            "me",

          group:
            "none",

          unclean:
            "true",

          lapTypes:
            "1,2,3,4",

          limit:
            1000,
        }
      );

    // ----------------------------------------
    // FILTRAR O EVENTO LOCALMENTE
    // ----------------------------------------

    const raw =
      data as any;

    const items =
      raw?.items ??
      raw?.data?.items ??
      [];

    const eventLaps =
      items.filter(
        (lap: any) => {
          const lapEventId =
            typeof lap.event ===
            "string"
              ? lap.event
              : lap.event?.id;

          return (
            lapEventId ===
            eventId
          );
        }
      );

    return NextResponse.json({
      status: "ok",

      requestedEvent:
        eventId,

      localSession:
        session,

      track: {
        id: track.id,
        platformId:
          track.platform_id,
        name: track.name,
      },

      lapsReturnedByTrack:
        items.length,

      eventLapsFound:
        eventLaps.length,

      eventLaps,
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
