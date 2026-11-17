import { NextRequest } from "next/server";
import { CACHE_TAGS, cachedJson } from "@/lib/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { aggregateWinnerGapByTrack, dropEarlyExitRaces, normalizeRaceClass, type WinnerGapRace } from "@/lib/winner-gap";
import { fieldMetricsFor } from "@/lib/debrief-field-data";
import { leftOnTable, summarizeField, type RaceForField } from "@/lib/debrief-field";
import type { RaceInput } from "@/lib/race-engineer-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RawRace = {
  irstats_race_id: number | null;
  raced_at: string;
  category: "formula_car" | "sports_car" | "road" | null;
  car_id: number | null;
  car_name: string | null;
  track_name: string | null;
  series_name: string | null;
  irating_delta: number | null;
  finish_position: number | null;
  fastest_lap_time: string | null;
  class_fastest_lap_time: string | null;
  laps: number | null;
};

type Segment = "sf" | "gt3" | "imsa";

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();
const TTL_MS = 180_000;

export async function GET(request: NextRequest) {
  try {
    const seasonParam = request.nextUrl.searchParams.get("seasonId") ?? "all";
    const segParam = (request.nextUrl.searchParams.get("segment") ?? "gt3") as Segment;
    const segment: Segment = segParam === "sf" || segParam === "imsa" ? segParam : "gt3";
    const cacheKey = `${seasonParam}|${segment}`;
    const hit = memoryCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return cachedJson(hit.payload, { sMaxAge: 180, swr: 900, tags: [CACHE_TAGS.results] });
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (driverError) throw driverError;
    if (!driver) throw new Error("Nenhum piloto encontrado.");

    const [{ data: summary, error: summaryError }, { data: calendar, error: calendarError }, { data: histPerf, error: histPerfError }] = await Promise.all([
      supabaseAdmin.from("v_season_summary").select("season_id,season_name"),
      supabaseAdmin.from("v_season_calendar").select("season_id,season_start"),
      supabaseAdmin.from("v_historical_performance").select("car,car_class"),
    ]);
    if (summaryError) throw summaryError;
    if (calendarError) throw calendarError;
    if (histPerfError) throw histPerfError;

    const carClassByCar = new Map<string, string>();
    for (const row of histPerf ?? []) {
      if (row.car && row.car_class) carClassByCar.set(String(row.car), String(row.car_class));
    }
    const classOf = (carName: string, seriesName?: string | null): string | null => {
      const fromHist = carClassByCar.get(carName);
      if (fromHist) return fromHist;
      const fromNorm = normalizeRaceClass(carName, []);
      if (fromNorm) return fromNorm;
      const text = `${carName} ${seriesName ?? ""}`;
      if (/gt3|gt sprint/i.test(text)) return "GT3";
      if (/499p|cadillac|acura|963|hybrid|gtp/i.test(text)) return "GTP";
      if (/lmp2|p217/i.test(text)) return "LMP2";
      return null;
    };

    const calendarById = new Map((calendar ?? []).map((c) => [String(c.season_id), String(c.season_start)]));
    const seasons = [...(summary ?? [])]
      .sort((a, b) => Number(b.season_id) - Number(a.season_id))
      .map((s) => ({
        id: String(s.season_id),
        name: String(s.season_name),
        start: calendarById.get(String(s.season_id)) ?? null,
      }));

    // Load all official races for this driver
    const allRaces: RawRace[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from("race_results")
        .select("irstats_race_id,raced_at,category,car_id,car_name,track_name,series_name,irating_delta,finish_position,fastest_lap_time,class_fastest_lap_time,laps")
        .eq("driver_id", driver.id)
        .order("raced_at", { ascending: false })
        .range(from, from + 999);
      if (error) throw error;
      allRaces.push(...((data ?? []) as RawRace[]));
      if (!data || data.length < 1000) break;
    }

    let filtered = allRaces;
    if (seasonParam !== "all") {
      const selectedSeason = seasons.find((s) => s.id === seasonParam);
      if (selectedSeason?.start) {
        const startMs = new Date(selectedSeason.start).getTime();
        const endMs = startMs + 84 * 86_400_000;
        filtered = allRaces.filter((r) => {
          const t = new Date(r.raced_at).getTime();
          return t >= startMs && t < endMs;
        });
      }
    }

    const matchesSegment = (row: RawRace, seg: Segment) => {
      const car = row.car_name ?? "";
      const cls = classOf(car, row.series_name);
      if (seg === "sf") return /super formula sf23/i.test(car);
      if (seg === "gt3") return cls === "GT3";
      return cls === "GTP" || cls === "LMP2";
    };

    // Aggregate historical rows (same shape consumed by HistoryView)
    const histMap = new Map<string, { ratingCategory: "formula_car" | "sports_car" | "road"; carClass: string | null; car: string; track: string; races: number; delta: number }>();
    for (const row of filtered) {
      if (!row.car_name || !row.track_name || row.irating_delta === null) continue;
      const carClass = classOf(row.car_name, row.series_name);
      const ratingCategory = row.category === "formula_car" || row.category === "sports_car" ? row.category : "road";
      const key = `${ratingCategory}::${carClass ?? ""}::${row.car_name}::${row.track_name}`;
      const cur = histMap.get(key) ?? { ratingCategory, carClass, car: row.car_name, track: row.track_name, races: 0, delta: 0 };
      cur.races += 1;
      cur.delta += row.irating_delta;
      histMap.set(key, cur);
    }
    const historical = [...histMap.values()].map((r) => ({ ...r, avgDelta: r.races > 0 ? r.delta / r.races : 0 }));

    // Winner gap normalized by track length (s/km)
    const toGapRace = (row: RawRace): WinnerGapRace => ({
      track_name: row.track_name ?? "",
      car_name: row.car_name,
      fastest_lap_time: row.fastest_lap_time,
      class_fastest_lap_time: row.class_fastest_lap_time,
      series_name: row.series_name,
      laps: row.laps,
    });
    const gapRaces = dropEarlyExitRaces(filtered.filter((r) => r.track_name && r.fastest_lap_time && r.class_fastest_lap_time).map(toGapRace));
    const sfGap = gapRaces.filter((r) => /super formula sf23/i.test(r.car_name ?? ""));
    const gt3Gap = gapRaces.filter((r) => classOf(r.car_name ?? "", r.series_name) === "GT3");
    const imsaGap = gapRaces.filter((r) => {
      const c = classOf(r.car_name ?? "", r.series_name);
      return c === "GTP" || c === "LMP2";
    });
    const gtpGap = imsaGap.filter((r) => classOf(r.car_name ?? "", r.series_name) === "GTP");
    const lmp2Gap = imsaGap.filter((r) => classOf(r.car_name ?? "", r.series_name) === "LMP2");

    const winnerGapBySegment = {
      sf: aggregateWinnerGapByTrack(sfGap, "track"),
      gt3: {
        track: aggregateWinnerGapByTrack(gt3Gap, "track"),
        car: aggregateWinnerGapByTrack(gt3Gap, "car"),
      },
      imsa: {
        all: { track: aggregateWinnerGapByTrack(imsaGap, "track"), car: aggregateWinnerGapByTrack(imsaGap, "car") },
        GTP: { track: aggregateWinnerGapByTrack(gtpGap, "track"), car: aggregateWinnerGapByTrack(gtpGap, "car") },
        LMP2: { track: aggregateWinnerGapByTrack(lmp2Gap, "track"), car: aggregateWinnerGapByTrack(lmp2Gap, "car") },
      },
    };

    // Field metrics (Realizado vs Esperado, Taxa de conclusão, Ritmo no grid, Deixado na pista) for the selected segment across all filtered history
    const segRaces = filtered.filter((r) => matchesSegment(r, segment));
    const raceInputs: RaceInput[] = segRaces
      .filter((r): r is RawRace & { irstats_race_id: number } => typeof r.irstats_race_id === "number")
      .slice(0, 200)
      .map((r) => ({
        irstats_race_id: r.irstats_race_id,
        raced_at: r.raced_at,
        car_id: r.car_id,
        track_id: null,
        car_name: r.car_name ?? "",
        track_name: r.track_name ?? "",
        series_name: r.series_name ?? "",
        category: r.category === "formula_car" ? "formula_car" : "sports_car",
        irating_delta: r.irating_delta,
        finish_position: r.finish_position ?? 0,
        laps: r.laps,
        incidents: null,
        season_week: null,
        grid_position: null,
        fastest_lap_time: r.fastest_lap_time,
        winner_fastest_lap_time: r.class_fastest_lap_time,
        class_fastest_lap_time: r.class_fastest_lap_time,
        irating_after: 0,
        position_change: null,
        irating_before: 0,
        sof: null,
      }));
    const metrics = await fieldMetricsFor(raceInputs);
    const forField: RaceForField[] = segRaces.map((r) => ({
      subsessionId: r.irstats_race_id,
      delta: r.irating_delta ?? 0,
      classFinish: r.finish_position,
      date: r.raced_at,
      car: r.car_name ?? "",
      track: r.track_name ?? "",
    }));
    const side = summarizeField(forField, metrics);
    const left = leftOnTable(forField, metrics, 45);

    const payload = {
      status: "ok",
      seasons: seasons.map(({ id, name }) => ({ id, name })),
      historical,
      winnerGapBySegment,
      fieldSummary: {
        races: side.races,
        residualAvg: side.residualAvg,
        residualRaces: side.residualRaces,
        permanencePct: side.permanencePct,
        early: side.early,
        paceTopPct: side.paceTopPct,
        leftOnTable: left,
      },
    };
    memoryCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, payload });
    return cachedJson(payload, { sMaxAge: 180, swr: 900, tags: [CACHE_TAGS.results] });
  } catch (error) {
    return cachedJson(
      { status: "error", message: error instanceof Error ? error.message : "Erro ao carregar histórico" },
      { sMaxAge: 0, tags: [CACHE_TAGS.results] }
    );
  }
}
