import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type WeekRow = {
  season_id: string;
  season_name: string;
  week_number: number;
  week_start: string;
  week_end: string;
};

type CatalogRow = { id: number; name: string; variant: string | null };

type Garage61LapPayload = {
  id: string;
  startTime?: string;
  lapTime?: number;
  sessionType?: number;
  clean?: boolean;
  joker?: boolean;
  discontinuity?: boolean;
  missing?: boolean;
  incomplete?: boolean;
  offtrack?: boolean;
  pitlane?: boolean;
  pitIn?: boolean;
  pitOut?: boolean;
  canViewTelemetry?: boolean;
  pushToPass?: boolean | number;
  p2pStatus?: boolean | number;
  p2pCount?: number;
};

type LapRow = { id: string; car_id: number | null; track_id: number | null; garage61_payload: Garage61LapPayload | null };

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/** Garage61 does not reliably include P2P flags in every lap listing. On SF23, exclude only a
 * clearly implausible low-time outlier so an overtake-assisted lap cannot become the selected lap. */
function withoutLikelyOvertakeLaps(laps: Garage61LapPayload[]) {
  if (laps.length < 5) return laps;
  const times = laps.map((lap) => Number(lap.lapTime)).filter(Number.isFinite);
  const center = median(times);
  const mad = median(times.map((time) => Math.abs(time - center)));
  const threshold = Math.max(0.45, mad * 3.5);
  return laps.filter((lap) => Number(lap.lapTime) >= center - threshold);
}

function isEligibleLap(lap: Garage61LapPayload, weekStart: Date, weekEnd: Date) {
  if (!lap.startTime || !lap.clean || !lap.canViewTelemetry) return false;
  const startedAt = new Date(lap.startTime);
  if (!Number.isFinite(startedAt.getTime()) || startedAt < weekStart || startedAt >= weekEnd) return false;
  if (!Number.isFinite(lap.lapTime) || Number(lap.lapTime) <= 0) return false;
  return !(
    lap.joker || lap.discontinuity || lap.missing || lap.incomplete || lap.offtrack ||
    lap.pitlane || lap.pitIn || lap.pitOut
  );
}

type CarContext = { category: "sports" | "formula" | null; carClass: string | null };

/** Categoria (cor do cartão de contexto no Telemetry Lab, redesign etapa 3) e classe (GT3/GTP/LMP2)
 * de cada carro da semana. Classe NÃO é série: vem só da participação em car_groups, com o mesmo
 * reforço por nome para LMP2 da comparação de carros. Consultas pequenas (só os carros da semana) e
 * não fatais: sem essa informação o cartão só não mostra a cor/classe. */
async function resolveCarContext(carIds: number[], cars: CatalogRow[]): Promise<Map<number, CarContext>> {
  const result = new Map<number, CarContext>();
  if (!carIds.length) return result;
  try {
    const [ratingsResult, groupsResult] = await Promise.all([
      supabaseAdmin.from("car_rating_categories").select("car_id,rating_category").in("car_id", carIds),
      supabaseAdmin.from("car_groups").select("id,name").in("name", ["GTP", "LMP2", "GT3"]),
    ]);
    const groups = (groupsResult.data ?? []) as { id: number; name: string }[];
    const membersResult = groups.length
      ? await supabaseAdmin.from("car_group_members").select("car_group_id,car_id").in("car_group_id", groups.map((group) => group.id)).in("car_id", carIds)
      : { data: [] };
    const groupName = new Map(groups.map((group) => [group.id, group.name]));
    const classesByCar = new Map<number, Set<string>>();
    for (const row of (membersResult.data ?? []) as { car_group_id: number; car_id: number }[]) {
      const name = groupName.get(row.car_group_id);
      if (!name) continue;
      if (!classesByCar.has(row.car_id)) classesByCar.set(row.car_id, new Set());
      classesByCar.get(row.car_id)!.add(name);
    }
    const rating = new Map(((ratingsResult.data ?? []) as { car_id: number; rating_category: string }[]).map((row) => [row.car_id, row.rating_category]));
    const lmp2ByName = /\bLMP2\b|Dallara P217|Oreca 07/i;
    for (const carId of carIds) {
      const classes = classesByCar.get(carId) ?? new Set<string>();
      const name = cars.find((car) => car.id === carId)?.name ?? "";
      const carClass = classes.has("GTP") ? "GTP" : classes.has("LMP2") || lmp2ByName.test(name) ? "LMP2" : classes.has("GT3") ? "GT3" : null;
      const category = rating.get(carId) === "formula_car" ? "formula" : rating.get(carId) === "sports_car" || carClass ? "sports" : null;
      result.set(carId, { category, carClass });
    }
  } catch {
    // Informação só visual; nunca derruba a tela.
  }
  return result;
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

    const { data: calendarRows, error: calendarError } = await supabaseAdmin
      .from("v_season_calendar")
      .select("season_id, season_name, season_start")
    if (calendarError) throw calendarError;

    // Do not derive the active week from the most recent race: on a new Monday at 21:00 BRT
    // that race still belongs to the previous season, while a fresh practice lap already belongs
    // to the new one. The official calendar changes the workspace exactly at the iRacing reset.
    const now = Date.now();
    const calendarRow = ((calendarRows ?? []) as { season_id: string | number; season_name: string; season_start: string }[])
      .sort((left, right) => new Date(right.season_start).getTime() - new Date(left.season_start).getTime())
      .find((row) => {
        const start = new Date(row.season_start).getTime();
        return now >= start && now < start + 84 * 86_400_000;
      });
    if (!calendarRow) return NextResponse.json({ status: "ok", week: null, combinations: [] });

    const weekNumber = Math.floor((now - new Date(calendarRow.season_start).getTime()) / (7 * 86_400_000)) + 1;
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
    const carClasses = await resolveCarContext(carIds, [...cars.values()]);
    const tracks = new Map(((tracksResult.data ?? []) as CatalogRow[]).map((item) => [item.id, item]));

    // Reads the already-synced `laps` table (populated by app/api/sync/incremental) instead of
    // calling Garage61 live — this page must stay usable off already-known data even when Garage61
    // itself is unreachable (rate-limited or down); the only thing that should be unavailable then
    // is picking up a NEW lap the sync hasn't reached yet, not the whole page.
    let lapsData: LapRow[] = [];
    if (carIds.length && trackIds.length) {
      const { data, error } = await supabaseAdmin
        .from("laps")
        .select("id,car_id,track_id,garage61_payload")
        .eq("driver_id", driver.id)
        .in("car_id", carIds)
        .in("track_id", trackIds);
      if (error) throw error;
      lapsData = (data ?? []) as LapRow[];
    }

    const combinations = pairs.map((pair) => {
      const currentWeekLaps = lapsData
        .filter((row) => row.car_id === pair.carId && row.track_id === pair.trackId && row.garage61_payload)
        .map((row) => row.garage61_payload as Garage61LapPayload);
      const eligibleLaps = currentWeekLaps.filter((lap) => isEligibleLap(lap, weekStart, weekEnd));
      const car = cars.get(pair.carId);
      const isSuperFormula = /super formula sf23/i.test(car?.name ?? "");
      const usedOvertake = (lap: Garage61LapPayload) => Boolean(lap.pushToPass) || Boolean(lap.p2pStatus) || Number(lap.p2pCount ?? 0) > 0;
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
        car: { id: pair.carId, name: car?.name ?? `Carro ${pair.carId}`, variant: car?.variant ?? null, ...(carClasses.get(pair.carId) ?? { category: null, carClass: null }) },
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
    });

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
