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
  pushToPass?: boolean | number;
  p2pStatus?: boolean | number;
  p2pCount?: number;
};

type Garage61LapsResponse = { items?: Garage61Lap[] };

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/** Garage61 does not reliably include P2P flags in every lap listing. On SF23, exclude only a
 * clearly implausible low-time outlier so an overtake-assisted lap cannot become the selected lap. */
function withoutLikelyOvertakeLaps(laps: Garage61Lap[]) {
  if (laps.length < 5) return laps;
  const times = laps.map((lap) => Number(lap.lapTime)).filter(Number.isFinite);
  const center = median(times);
  const mad = median(times.map((time) => Math.abs(time - center)));
  const threshold = Math.max(0.45, mad * 3.5);
  return laps.filter((lap) => Number(lap.lapTime) >= center - threshold);
}

async function fetchWeekLaps(carId: number, trackId: number, weekStart: Date, weekEnd: Date) {
  const laps: Garage61Lap[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await garage61Get<Garage61LapsResponse>("/laps", { cars: carId, tracks: trackId, drivers: "me", group: "none", unclean: "true", lapTypes: "1,2,3,4", limit: PAGE_SIZE, offset });
    const page = response.items ?? [];
    laps.push(...page);
    if (page.length < PAGE_SIZE) break;
    const oldest = page.reduce<Date | null>((value, lap) => {
      const date = lap.startTime ? new Date(lap.startTime) : null;
      return date && Number.isFinite(date.getTime()) && (!value || date < value) ? date : value;
    }, null);
    if (oldest && oldest < weekStart) break;
  }
  return laps.filter((lap) => {
    const date = lap.startTime ? new Date(lap.startTime) : null;
    return !!date && Number.isFinite(date.getTime()) && date >= weekStart && date < weekEnd;
  });
}

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

    // The active telemetry workspace must remain useful before the first race: practice is
    // training data, so include every tracked session type in the official week window. A race
    // still wins later when choosing the representative lap below.
    const { data: weekSessions, error: weekSessionsError } = await supabaseAdmin
      .from("driving_sessions")
      .select("car_id, track_id, session_type")
      .eq("driver_id", driver.id)
      .gte("started_at", week.week_start)
      .lt("started_at", week.week_end)
      .in("session_type", [1, 2, 3])
      .not("car_id", "is", null)
      .not("track_id", "is", null);
    if (weekSessionsError) throw weekSessionsError;

    const pairCounts = new Map<string, { carId: number; trackId: number; sessions: number; sessionTypes: Set<number> }>();
    for (const session of weekSessions ?? []) {
      if (typeof session.car_id !== "number" || typeof session.track_id !== "number") continue;
      const key = `${session.car_id}:${session.track_id}`;
      const current = pairCounts.get(key);
      if (current) {
        current.sessions += 1;
        if (typeof session.session_type === "number") current.sessionTypes.add(session.session_type);
      } else {
        pairCounts.set(key, { carId: session.car_id, trackId: session.track_id, sessions: 1, sessionTypes: new Set(typeof session.session_type === "number" ? [session.session_type] : []) });
      }
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
      const currentWeekLaps = await fetchWeekLaps(pair.carId, pair.trackId, weekStart, weekEnd);
      const eligibleLaps = currentWeekLaps
        .filter((lap) => isEligibleLap(lap, weekStart, weekEnd));
      const car = cars.get(pair.carId);
      const isSuperFormula = /super formula sf23/i.test(car?.name ?? "");
      const usedOvertake = (lap: Garage61Lap) => Boolean(lap.pushToPass) || Boolean(lap.p2pStatus) || Number(lap.p2pCount ?? 0) > 0;
      const rawRaceLaps = eligibleLaps.filter((lap) => lap.sessionType === 3 && (!isSuperFormula || !usedOvertake(lap)));
      const raceLaps = isSuperFormula ? withoutLikelyOvertakeLaps(rawRaceLaps) : rawRaceLaps;
      const practiceLaps = eligibleLaps.filter((lap) => lap.sessionType === 1);
      // Race pace is the representative reference once a race exists; otherwise practice is the
      // best way to prepare for a scheduled race. Qualifying is only a last-resort fallback.
      const chosenPool = raceLaps.length ? raceLaps : practiceLaps.length ? practiceLaps : eligibleLaps;
      const bestLap = chosenPool
        .sort((a, b) => Number(a.lapTime) - Number(b.lapTime))[0];
      const track = tracks.get(pair.trackId);

      return {
        key: `${pair.carId}:${pair.trackId}`,
        label: `${car?.name ?? `Carro ${pair.carId}`} — ${track?.name ?? `Pista ${pair.trackId}`}${track?.variant ? ` (${track.variant})` : ""}`,
        car: { id: pair.carId, name: car?.name ?? `Carro ${pair.carId}`, variant: car?.variant ?? null },
        track: { id: pair.trackId, name: track?.name ?? `Pista ${pair.trackId}`, variant: track?.variant ?? null },
        sessions: pair.sessions,
        sessionTypes: [...pair.sessionTypes],
        lapsFound: currentWeekLaps.length,
        bestLap: bestLap ? {
          id: bestLap.id,
          lapTime: Number(bestLap.lapTime),
          startTime: bestLap.startTime,
          sessionType: bestLap.sessionType ?? null,
          selectionReason: raceLaps.length ? (isSuperFormula ? "race_best_lap_without_p2p" : "race_best_lap") : practiceLaps.length ? "practice_best_lap" : "fastest_clean_lap",
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
