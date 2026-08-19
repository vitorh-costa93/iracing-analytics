import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

const PAGE_SIZE = 250;

type WeekRow = {
  season_id: string;
  season_name: string;
  week_number: number;
  week_start: string;
  week_end: string;
};

type SessionRow = {
  car_id: number | null;
  track_id: number | null;
};

type CatalogRow = { id: number; name: string; variant: string | null };

type Garage61Lap = {
  id: string;
  startTime?: string;
  lapTime?: number;
  sessionType?: number;
  car?: { id?: number };
  track?: { id?: number };
  clean?: boolean;
  joker?: boolean;
  discontinuity?: boolean;
  missing?: boolean;
  incomplete?: boolean;
  offtrack?: boolean;
  pitLane?: boolean;
  pitIn?: boolean;
  pitOut?: boolean;
  canViewTelemetry?: boolean;
};

type Garage61LapsResponse = { items?: Garage61Lap[] };

function isEligibleLap(lap: Garage61Lap, weekStart: Date, weekEnd: Date) {
  if (!lap.startTime || !lap.clean || !lap.canViewTelemetry) return false;
  const startedAt = new Date(lap.startTime);
  if (!Number.isFinite(startedAt.getTime()) || startedAt < weekStart || startedAt >= weekEnd) return false;
  if (!Number.isFinite(lap.lapTime) || Number(lap.lapTime) <= 0) return false;
  return !(
    lap.joker || lap.discontinuity || lap.missing || lap.incomplete || lap.offtrack ||
    lap.pitLane || lap.pitIn || lap.pitOut
  );
}

export async function GET() {
  try {
    const nowIso = new Date().toISOString();
    const { data: weekRows, error: weekError } = await supabaseAdmin
      .from("v_season_weekly_irating")
      .select("season_id, season_name, week_number, week_start, week_end")
      .lte("week_start", nowIso)
      .gt("week_end", nowIso)
      .order("week_start", { ascending: false })
      .limit(1);

    if (weekError) throw weekError;
    const week = (weekRows?.[0] ?? null) as WeekRow | null;
    if (!week) {
      return NextResponse.json({ status: "ok", week: null, combinations: [] });
    }

    const accounts = await garage61Get<{ items?: { platform?: string; id?: string }[] }>("/me/accounts");
    const account = accounts.items?.find((item) => item.platform === "iracing");
    if (!account?.id) throw new Error("Conta iRacing não encontrada no Garage61");

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("platform_driver_id", account.id)
      .single();
    if (driverError || !driver) throw new Error("Driver não encontrado no Supabase");

    const { data: sessionData, error: sessionsError } = await supabaseAdmin
      .from("driving_sessions")
      .select("car_id, track_id")
      .eq("driver_id", driver.id)
      .gte("started_at", week.week_start)
      .lt("started_at", week.week_end)
      .not("car_id", "is", null)
      .not("track_id", "is", null);
    if (sessionsError) throw sessionsError;

    const sessions = (sessionData ?? []) as SessionRow[];
    const pairCounts = new Map<string, { carId: number; trackId: number; sessions: number }>();
    for (const session of sessions) {
      if (typeof session.car_id !== "number" || typeof session.track_id !== "number") continue;
      const key = `${session.car_id}:${session.track_id}`;
      const current = pairCounts.get(key);
      if (current) current.sessions += 1;
      else pairCounts.set(key, { carId: session.car_id, trackId: session.track_id, sessions: 1 });
    }

    const pairs = [...pairCounts.values()];
    const carIds = [...new Set(pairs.map((pair) => pair.carId))];
    const trackIds = [...new Set(pairs.map((pair) => pair.trackId))];
    const [carsResult, tracksResult] = await Promise.all([
      carIds.length ? supabaseAdmin.from("cars").select("id, name, variant").in("id", carIds) : Promise.resolve({ data: [], error: null }),
      trackIds.length ? supabaseAdmin.from("tracks").select("id, name, variant").in("id", trackIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (carsResult.error) throw carsResult.error;
    if (tracksResult.error) throw tracksResult.error;

    const cars = new Map(((carsResult.data ?? []) as CatalogRow[]).map((item) => [item.id, item]));
    const tracks = new Map(((tracksResult.data ?? []) as CatalogRow[]).map((item) => [item.id, item]));
    const weekStart = new Date(week.week_start);
    const weekEnd = new Date(week.week_end);

    const combinations = await Promise.all(pairs.map(async (pair) => {
      const response = await garage61Get<Garage61LapsResponse>("/laps", {
        cars: pair.carId,
        tracks: pair.trackId,
        drivers: "me",
        group: "none",
        unclean: "true",
        lapTypes: "1,2,3,4",
        limit: PAGE_SIZE,
        offset: 0,
      });
      const currentWeekLaps = (response.items ?? []).filter((lap) => {
        if (!lap.startTime) return false;
        const date = new Date(lap.startTime);
        return Number.isFinite(date.getTime()) && date >= weekStart && date < weekEnd;
      });
      const bestLap = currentWeekLaps
        .filter((lap) => isEligibleLap(lap, weekStart, weekEnd))
        .sort((a, b) => Number(a.lapTime) - Number(b.lapTime))[0];
      const car = cars.get(pair.carId);
      const track = tracks.get(pair.trackId);

      return {
        key: `${pair.carId}:${pair.trackId}`,
        label: `${car?.name ?? `Carro ${pair.carId}`} — ${track?.name ?? `Pista ${pair.trackId}`}${track?.variant ? ` (${track.variant})` : ""}`,
        car: { id: pair.carId, name: car?.name ?? `Carro ${pair.carId}`, variant: car?.variant ?? null },
        track: { id: pair.trackId, name: track?.name ?? `Pista ${pair.trackId}`, variant: track?.variant ?? null },
        sessions: pair.sessions,
        lapsFound: currentWeekLaps.length,
        bestLap: bestLap ? {
          id: bestLap.id,
          lapTime: Number(bestLap.lapTime),
          startTime: bestLap.startTime,
          sessionType: bestLap.sessionType ?? null,
          telemetryUrl: `/api/garage61/laps/${encodeURIComponent(bestLap.id)}/telemetry`,
        } : null,
      };
    }));

    combinations.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return NextResponse.json({
      status: "ok",
      week: { seasonId: week.season_id, seasonName: week.season_name, number: week.week_number, start: week.week_start, end: week.week_end },
      combinations,
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
