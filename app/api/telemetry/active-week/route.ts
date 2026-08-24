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
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (driverError || !driver) throw new Error("Driver não encontrado no Supabase");

    const { data: latestRace, error: latestRaceError } = await supabaseAdmin
      .from("race_results")
      .select("raced_at, season_week, category")
      .eq("driver_id", driver.id)
      .order("raced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRaceError) throw latestRaceError;
    if (!latestRace) {
      return NextResponse.json({ status: "ok", week: null, combinations: [] });
    }

    const { data: calendarRow, error: calendarError } = await supabaseAdmin
      .from("v_season_calendar")
      .select("season_id, season_name, season_start")
      .lte("season_start", latestRace.raced_at)
      .order("season_start", { ascending: false })
      .limit(1)
      .single();
    if (calendarError) throw calendarError;

    const weekNumber = latestRace.season_week ?? 1;
    const weekStart = new Date(new Date(calendarRow.season_start).getTime() + (weekNumber - 1) * 7 * 86_400_000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const week: WeekRow = {
      season_id: String(calendarRow.season_id),
      season_name: calendarRow.season_name,
      week_number: weekNumber,
      week_start: weekStart.toISOString(),
      week_end: weekEnd.toISOString(),
    };

    const { data: weekRaces, error: weekRacesError } = await supabaseAdmin
      .from("race_results")
      .select("car_id, track_id")
      .eq("driver_id", driver.id)
      .gte("raced_at", week.week_start)
      .lt("raced_at", week.week_end)
      .not("car_id", "is", null)
      .not("track_id", "is", null);
    if (weekRacesError) throw weekRacesError;

    const pairCounts = new Map<string, { carId: number; trackId: number; sessions: number }>();
    for (const race of weekRaces ?? []) {
      if (typeof race.car_id !== "number" || typeof race.track_id !== "number") continue;
      const key = `${race.car_id}:${race.track_id}`;
      const current = pairCounts.get(key);
      if (current) current.sessions += 1;
      else pairCounts.set(key, { carId: race.car_id, trackId: race.track_id, sessions: 1 });
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
      const eligibleLaps = currentWeekLaps
        .filter((lap) => isEligibleLap(lap, weekStart, weekEnd));
      const car = cars.get(pair.carId);
      const isSuperFormula = /super formula sf23/i.test(car?.name ?? "");
      const qualifyingLaps = isSuperFormula
        ? eligibleLaps.filter((lap) => lap.sessionType === 2)
        : [];
      const bestLap = (qualifyingLaps.length ? qualifyingLaps : eligibleLaps)
        .sort((a, b) => Number(a.lapTime) - Number(b.lapTime))[0];
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
          selectionReason: isSuperFormula && qualifyingLaps.length
            ? "qualifying_without_race_push_to_pass"
            : "fastest_clean_lap",
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
