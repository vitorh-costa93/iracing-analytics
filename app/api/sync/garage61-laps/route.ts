import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// 11/09/2026: "estou tentando a manhã toda atualizar, mas não consigo" / "extremamente lento" --
// sync/incremental's real bottleneck is DISCOVERING sessions/laps/sectors: it has to paginate
// Garage61's public, rate-limited /api/v1/laps endpoint per car/track pair. The exact same data is
// available, already structured as clean JSON, from Garage61's own INTERNAL api (garage61.net/api
// /internal/events/{id}) -- the same calls their own web app makes when you browse it, not subject to
// the public developer API's rate limit at all. public/garage61-import.js (already used for setups,
// same bookmarklet, same button) now ALSO walks that response for session/lap/sector data and posts it
// here. Same idea, same auth, same upsert targets as sync/incremental -- just a different (faster,
// browser-mediated) way to fill them. Telemetry (the actual per-sample CSV) stays on the server-side
// path deliberately: Garage61's internal telemetry format is an undocumented binary blob, not CSV, and
// guessing its layout risks silently wrong data feeding every downstream analysis in this app.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://garage61.net",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-import-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

type IncomingSession = {
  eventId: string; sessionId: string; carId: number; trackId: number;
  seasonId: string | null; sessionType: number | null; eventType: number | null;
  startedAt: string; endedAt: string; lapCount: number;
};

type IncomingLap = {
  id: string; carId: number; trackId: number; lapNumber: number | null; lapTime: number | null;
  clean: boolean | null; joker: boolean | null; discontinuity: boolean | null; missing: boolean | null;
  incomplete: boolean | null; offTrack: boolean | null; pitLane: boolean | null; pitIn: boolean | null; pitOut: boolean | null;
  driverRating: number | null; fuelLevel: number | null; fuelUsed: number | null; fuelAdded: number | null;
  weightPenalty: number | null; powerAdjust: number | null; tireCompound: number | null;
  canViewTelemetry: boolean; canViewSetup: boolean; payload: unknown;
};

type IncomingSector = { lapId: string; sectorNumber: number; sectorTime: number | null; incomplete: boolean };

const CHUNK = 500;

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.GARAGE61_IMPORT_SECRET;
    if (!secret || request.headers.get("x-import-key") !== secret) {
      return NextResponse.json({ status: "error", message: "Chave de importação inválida" }, { status: 401, headers: CORS_HEADERS });
    }

    const body = await request.json() as { sessions?: IncomingSession[]; laps?: IncomingLap[]; sectors?: IncomingSector[] };
    const sessions = body.sessions ?? [];
    const laps = body.laps ?? [];
    const sectors = body.sectors ?? [];
    if (!sessions.length && !laps.length) throw new Error("Nenhuma sessão/volta recebida");

    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    if (sessions.length) {
      const rows = sessions.map((s) => ({
        driver_id: driver.id, garage61_event_id: s.eventId, garage61_session_id: s.sessionId,
        car_id: s.carId, track_id: s.trackId, season_id: s.seasonId, season_name: null,
        session_type: s.sessionType, event_type: s.eventType, started_at: s.startedAt, ended_at: s.endedAt,
        lap_count: s.lapCount,
      }));
      for (let index = 0; index < rows.length; index += CHUNK) {
        const { error } = await supabaseAdmin.from("driving_sessions").upsert(rows.slice(index, index + CHUNK), {
          onConflict: "driver_id,garage61_event_id,garage61_session_id,car_id,track_id",
        });
        if (error) throw error;
      }
    }

    if (laps.length) {
      // 12/09/2026 fix: "sumiu a temperatura/borracha de todos, inclusive Silverstone que já
      // sincronizava antes" -- this is a plain upsert on id, so re-visiting a car/track pair the
      // bookmarklet has ALREADY discovered as "recent activity" (discoverAndVisitLapsEvents looks back
      // up to computeIncrementalCutoff's own window, days, not just today) replaces the WHOLE
      // garage61_payload column outright, including old laps that already had a real, richer payload
      // from the legacy sync/laps-era public-api sync (with trackTemp/trackWetness/etc). This
      // bookmarklet's own payload (public/garage61-import.js) deliberately doesn't know those weather
      // fields at all (Garage61's internal api never had a confirmed shape for them) -- so a lap that
      // already had good weather data silently lost it the moment the bookmarklet happened to re-touch
      // it, nothing to do with THAT lap's own sync being new or broken. Fetching the existing payload
      // first and merging (existing as the base, this run's own known fields winning) keeps whatever
      // this sync doesn't know about instead of erasing it.
      const existingPayloads = new Map<string, Record<string, unknown>>();
      for (let index = 0; index < laps.length; index += CHUNK) {
        const ids = laps.slice(index, index + CHUNK).map((l) => l.id);
        const { data, error } = await supabaseAdmin.from("laps").select("id,garage61_payload").in("id", ids);
        if (error) throw error;
        for (const row of data ?? []) {
          if (row.garage61_payload && typeof row.garage61_payload === "object") existingPayloads.set(row.id, row.garage61_payload as Record<string, unknown>);
        }
      }

      const rows = laps.map((l) => ({
        id: l.id, driver_id: driver.id, car_id: l.carId, track_id: l.trackId,
        lap_number: l.lapNumber, lap_time: l.lapTime, clean: l.clean, joker: l.joker,
        discontinuity: l.discontinuity, missing: l.missing, incomplete: l.incomplete,
        off_track: l.offTrack, pit_lane: l.pitLane, pit_in: l.pitIn, pit_out: l.pitOut,
        driver_rating: l.driverRating, fuel_level: l.fuelLevel, fuel_used: l.fuelUsed, fuel_added: l.fuelAdded,
        weight_penalty: l.weightPenalty, power_adjust: l.powerAdjust, tire_compound: l.tireCompound,
        can_view_telemetry: l.canViewTelemetry, can_view_setup: l.canViewSetup,
        garage61_payload: { ...(existingPayloads.get(l.id) ?? {}), ...(l.payload as Record<string, unknown>) },
        synced_at: new Date().toISOString(),
      }));
      for (let index = 0; index < rows.length; index += CHUNK) {
        const { error } = await supabaseAdmin.from("laps").upsert(rows.slice(index, index + CHUNK), { onConflict: "id" });
        if (error) throw error;
      }
    }

    if (sectors.length) {
      const rows = sectors.map((s) => ({ lap_id: s.lapId, sector_number: s.sectorNumber, sector_time: s.sectorTime, incomplete: s.incomplete }));
      for (let index = 0; index < rows.length; index += CHUNK) {
        const { error } = await supabaseAdmin.from("lap_sectors").upsert(rows.slice(index, index + CHUNK), { onConflict: "lap_id,sector_number" });
        if (error) throw error;
      }
    }

    // Recorded so /api/sync/status's freshness check (and the "Estado das fontes" banner) sees this
    // as a real Garage61 sync, the same way sync/incremental's own runs already do.
    const now = new Date().toISOString();
    await supabaseAdmin.from("sync_runs").insert({
      sync_type: "garage61_laps_bookmarklet", status: "completed", started_at: now, finished_at: now,
      records_found: sessions.length + laps.length, records_inserted: sessions.length + laps.length,
    });

    return NextResponse.json({
      status: "ok", sessionsUpserted: sessions.length, lapsUpserted: laps.length, sectorsUpserted: sectors.length,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400, headers: CORS_HEADERS });
  }
}
