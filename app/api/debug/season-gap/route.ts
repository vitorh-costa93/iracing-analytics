import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Temporary diagnostic route -- 29/08/2026, checking why Algarve GT3 only shows 2 seasons
// (2026 S1, 2025 S4) in car-comparison when the driver expects more. Delete after use.
export async function GET(request: Request) {
  try {
    const trackId = Number(new URL(request.url).searchParams.get("trackId"));
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("driver not found");

    const { data: laps, error } = await supabaseAdmin
      .from("laps")
      .select("id,car_id,lap_time,session_id,sessions(season_id,season_name,started_at)")
      .eq("driver_id", driver.id).eq("track_id", trackId);
    if (error) throw error;

    const rows = (laps ?? []) as unknown as { id: string; car_id: number; lap_time: number; session_id: string | null; sessions: { season_id: string | null; season_name: string | null; started_at: string | null } | null }[];
    const total = rows.length;
    const noSessionId = rows.filter((r) => !r.session_id).length;
    const sessionIdButNoJoin = rows.filter((r) => r.session_id && !r.sessions).length;
    const joinButNoSeason = rows.filter((r) => r.sessions && !r.sessions.season_id).length;
    const withSeason = rows.filter((r) => r.sessions?.season_id).length;

    const bySeason = new Map<string, number>();
    for (const r of rows) {
      const key = r.sessions?.season_id ? `${r.sessions.season_id}:${r.sessions.season_name}` : "NO_SEASON";
      bySeason.set(key, (bySeason.get(key) ?? 0) + 1);
    }

    // Sample a few of the no-season rows to inspect their session_id / sessions row directly.
    const noSeasonSample = rows.filter((r) => !r.sessions?.season_id).slice(0, 5);
    const sampleSessionIds = noSeasonSample.map((r) => r.session_id).filter((v): v is string => !!v);
    const { data: rawSessions } = sampleSessionIds.length ? await supabaseAdmin.from("sessions").select("*").in("id", sampleSessionIds) : { data: [] };

    // Which cars are affected by NO_SEASON, and by NO_SESSION_ID specifically?
    const noSeasonByCar = new Map<number, number>();
    const noSessionIdByCar = new Map<number, number>();
    for (const r of rows) {
      if (!r.sessions?.season_id) noSeasonByCar.set(r.car_id, (noSeasonByCar.get(r.car_id) ?? 0) + 1);
      if (!r.session_id) noSessionIdByCar.set(r.car_id, (noSessionIdByCar.get(r.car_id) ?? 0) + 1);
    }
    const affectedCarIds = [...new Set([...noSeasonByCar.keys(), ...noSessionIdByCar.keys()])];
    const { data: affectedCars } = affectedCarIds.length ? await supabaseAdmin.from("cars").select("id,name").in("id", affectedCarIds) : { data: [] };
    const carNames = new Map((affectedCars ?? []).map((c) => [c.id, c.name]));

    return NextResponse.json({
      status: "ok", total, noSessionId, sessionIdButNoJoin, joinButNoSeason, withSeason,
      bySeason: Object.fromEntries(bySeason),
      noSeasonSample: noSeasonSample.map((r) => ({ id: r.id, carId: r.car_id, sessionId: r.session_id })),
      rawSessionsForSample: rawSessions,
      noSeasonByCar: [...noSeasonByCar.entries()].map(([carId, count]) => ({ carId, carName: carNames.get(carId) ?? `Carro ${carId}`, count })),
      noSessionIdByCar: [...noSessionIdByCar.entries()].map(([carId, count]) => ({ carId, carName: carNames.get(carId) ?? `Carro ${carId}`, count })),
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
