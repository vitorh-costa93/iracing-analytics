import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const RATING_CATEGORIES = ["formula_car", "sports_car", "gtp_car"] as const;
type RatingCategory = (typeof RATING_CATEGORIES)[number];
const CATEGORY_LABEL: Record<RatingCategory, string> = { formula_car: "Formula Car", sports_car: "Sports Car", gtp_car: "GTP" };

const MAX_LAPS = 10;
const OUTLIER_POOL_EXTRA = 5;
const MIN_LAPS = 5;

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function stddev(values: number[], avg: number) { return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length); }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; }
function formatTime(value: number) {
  if (value >= 60) { const minutes = Math.floor(value / 60), seconds = value - minutes * 60; return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`; }
  return `${value.toFixed(3)}s`;
}
function consistencyLabel(sd: number, avg: number) {
  const ratio = avg > 0 ? sd / avg : 0;
  return ratio < 0.003 ? "muito consistente" : ratio < 0.008 ? "consistente" : ratio < 0.016 ? "variável" : "muito inconsistente";
}

/**
 * Flags statistically anomalous (abnormally FAST) lap times via a robust median+MAD z-score — same
 * likely-overtake proxy used in the race debrief, kept here for the same reason: Garage61's CSV
 * export has no push-to-pass/overtake channel, so an unusually fast lap is the only available signal.
 */
function findOutlierLaps<T extends { lapTime: number }>(items: T[], zThreshold = 2.5) {
  if (items.length < 5) return { kept: items, outliers: [] as (T & { zScore: number })[] };
  const times = items.map((item) => item.lapTime);
  const med = median(times);
  const mad = median(times.map((value) => Math.abs(value - med))) || 0.001;
  const scaled = mad * 1.4826;
  const withScore = items.map((item) => ({ ...item, zScore: (item.lapTime - med) / scaled }));
  const outliers = withScore.filter((item) => item.zScore < -zThreshold);
  const outlierIds = new Set(outliers.map((item) => item));
  const kept = withScore.filter((item) => !outlierIds.has(item));
  return { kept, outliers };
}

/**
 * Same median+MAD logic as findOutlierLaps, but applied PER SECTOR instead of to the whole lap.
 * A push-to-pass boost (or a tow) can make a single sector abnormally fast without making the whole
 * lap fast enough to be caught by the lap-level filter — e.g. Super Formula's P2P inflates sector 1
 * specifically. Left uncaught, that one time becomes "the best" for that sector and blows up the
 * sector's stddev against the other laps that never got the same boost there, reading as
 * "muito inconsistente" in a sector that's actually driven consistently minus the boosted lap.
 */
function excludeFastSectorOutliers(times: number[], zThreshold = 2.5) {
  if (times.length < 5) return { kept: times, excludedCount: 0 };
  const med = median(times);
  const mad = median(times.map((value) => Math.abs(value - med))) || 0.0005;
  const scaled = mad * 1.4826;
  const kept = times.filter((value) => (value - med) / scaled >= -zThreshold);
  if (kept.length < 3) return { kept: times, excludedCount: 0 };
  return { kept, excludedCount: times.length - kept.length };
}

/**
 * Sector-time consistency for the SAME lap pool as the race debrief — the top ~10 fastest laps of
 * that category's most recent valid race, not every clean lap ever recorded for the car/track.
 *
 * An earlier version used the full all-time history (lap_sectors has 50k+ rows that were being
 * synced and never read anywhere — still true, this is still the first feature reading them, just
 * scoped differently now). Two real problems came from that: (1) a car/track combo raced only once
 * could have too few all-time laps to analyze even when the race itself had plenty of laps — the
 * McLaren 720S GT3 EVO at Indianapolis showed "poucas voltas" despite the actual race lasting well
 * over 5 laps, because the all-time-for-this-track pool was thin; (2) in multi-class races (GTP
 * racing alongside GT3/LMP2 traffic), lapping slower traffic mid-corner inflates the all-time
 * variance even when the driver's own technique is consistent — the ideal-lap gap looked great while
 * individual sectors still read "muito inconsistente", which is real but confusing without context.
 * Restricting to the fastest N laps of one race (mirroring the debrief's own selection, including
 * the same fast-outlier/likely-overtake filter) fixes both: it's the exact lap pool already proven to
 * exist per category, and traffic-slowed laps are laps that don't rank in the fastest N to begin with.
 */
async function buildSectorReport(driverId: string, carId: number, trackId: number, eventId: string) {
  const [carRow, trackRow] = await Promise.all([
    supabaseAdmin.from("cars").select("name").eq("id", carId).maybeSingle(),
    supabaseAdmin.from("tracks").select("name,variant").eq("id", trackId).maybeSingle(),
  ]);

  const { data: eventLaps, error: lapsError } = await supabaseAdmin
    .from("laps")
    .select("id,lap_time")
    .eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId)
    .eq("garage61_payload->>event", eventId)
    .eq("incomplete", false)
    .not("pit_lane", "is", true).not("pit_in", "is", true).not("pit_out", "is", true)
    .not("lap_time", "is", null).gt("lap_time", 0);
  if (lapsError) throw lapsError;
  if (!eventLaps || eventLaps.length < MIN_LAPS) return { status: "ok" as const, report: null, message: `Poucas voltas registradas nessa corrida com ${carRow.data?.name ?? "esse carro"} em ${trackRow.data?.name ?? "essa pista"} para uma análise de setores confiável (mínimo ${MIN_LAPS}).` };

  const candidateLaps = [...eventLaps].sort((a, b) => Number(a.lap_time) - Number(b.lap_time)).slice(0, MAX_LAPS + OUTLIER_POOL_EXTRA);
  const { kept } = findOutlierLaps(candidateLaps.map((lap) => ({ id: lap.id, lapTime: Number(lap.lap_time) })));
  const laps = kept.sort((a, b) => a.lapTime - b.lapTime).slice(0, MAX_LAPS);
  if (laps.length < MIN_LAPS) return { status: "ok" as const, report: null, message: `Poucas voltas válidas (após descartar possíveis outliers) para uma análise de setores confiável (mínimo ${MIN_LAPS}).` };

  const lapIds = laps.map((lap) => lap.id);
  const { data: sectorRows, error: sectorError } = await supabaseAdmin.from("lap_sectors").select("lap_id,sector_number,sector_time,incomplete").in("lap_id", lapIds).eq("incomplete", false).gt("sector_time", 0);
  if (sectorError) throw sectorError;
  if (!sectorRows || !sectorRows.length) return { status: "ok" as const, report: null, message: "Essas voltas não têm tempos de setor registrados." };

  const bySector = new Map<number, number[]>();
  const actualBestLapId = laps[0].id;
  const actualBestBySector = new Map<number, number>();
  for (const row of sectorRows) {
    bySector.set(row.sector_number, [...(bySector.get(row.sector_number) ?? []), row.sector_time]);
    if (row.lap_id === actualBestLapId) actualBestBySector.set(row.sector_number, Number(row.sector_time));
  }

  const sectorCount = Math.max(...bySector.keys());
  const sectors = Array.from({ length: sectorCount }, (_, index) => {
    const number = index + 1;
    const rawTimes = bySector.get(number) ?? [];
    if (rawTimes.length < 3) return null;
    const { kept: times, excludedCount } = excludeFastSectorOutliers(rawTimes);
    const avg = mean(times);
    const sd = stddev(times, avg);
    const best = Math.min(...times);
    return {
      sector: number, sampleSize: times.length, mean: Number(avg.toFixed(3)), stddev: Number(sd.toFixed(3)), best: Number(best.toFixed(3)), consistency: consistencyLabel(sd, avg),
      actualBest: actualBestBySector.get(number) ?? null,
      note: excludedCount > 0 ? `${excludedCount} volta${excludedCount > 1 ? "s" : ""} com tempo atípico nesse setor (provável P2P/tow) desconsiderada${excludedCount > 1 ? "s" : ""} do cálculo.` : null,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  if (!sectors.length) return { status: "ok" as const, report: null, message: "Amostra de setores insuficiente para uma análise confiável." };

  const idealLap = sectors.reduce((sum, sector) => sum + sector.best, 0);
  const lapTimes = laps.map((lap) => lap.lapTime);
  const actualBestLap = Math.min(...lapTimes);
  // The displayed sector deltas must add up to the headline gap. Use the sector times of this
  // exact fastest lap, never the average sector time from the sample.
  const actualBestSectorTotal = sectors.reduce((sum, sector) => sum + (sector.actualBest ?? 0), 0);
  const gapToIdeal = actualBestSectorTotal > 0 ? actualBestSectorTotal - idealLap : actualBestLap - idealLap;

  const ranked = [...sectors].sort((a, b) => (b.stddev / b.mean) - (a.stddev / a.mean));
  const worstSector = ranked[0];
  const bestSector = ranked[ranked.length - 1];

  return {
    status: "ok" as const,
    message: null,
    report: {
      car: carRow.data?.name ?? `Carro ${carId}`,
      track: `${trackRow.data?.name ?? `Pista ${trackId}`}${trackRow.data?.variant ? ` (${trackRow.data.variant})` : ""}`,
      lapsAnalyzed: laps.length,
      sectors,
      idealLap: formatTime(idealLap),
      actualBestLap: formatTime(actualBestLap),
      gapToIdeal: gapToIdeal.toFixed(3),
      summary: `Juntando seu melhor tempo em cada um dos ${sectors.length} setores dessa corrida (as ${laps.length} voltas mais rápidas, mesmo que não tenham sido na mesma volta), sua volta ideal em ${trackRow.data?.name ?? "essa pista"} seria ${formatTime(idealLap)} — ${gapToIdeal.toFixed(3)}s mais rápida que sua melhor volta real (${formatTime(actualBestLap)}). Isso mostra quanto tempo ainda está "na mesa" só de juntar seus próprios melhores pedaços numa volta só. O setor ${worstSector.sector} é onde você mais varia (${worstSector.consistency}); o setor ${bestSector.sector} é onde você mais se repete (${bestSector.consistency}).`,
    },
  };
}

export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    const { data: cachedDebriefs } = await supabaseAdmin.from("race_debriefs").select("rating_category,session_id").eq("driver_id", driver.id);
    const sessionIdByCategory = new Map<string, number>();
    for (const row of cachedDebriefs ?? []) {
      if (row.session_id) sessionIdByCategory.set(row.rating_category, Number(row.session_id));
    }

    const sessionIds = [...sessionIdByCategory.values()];
    const { data: sessionRows } = sessionIds.length
      ? await supabaseAdmin.from("driving_sessions").select("id,car_id,track_id,garage61_event_id").in("id", sessionIds)
      : { data: [] as { id: number; car_id: number; track_id: number; garage61_event_id: string | null }[] };
    const sessionById = new Map((sessionRows ?? []).map((row) => [Number(row.id), row]));

    const results: Record<RatingCategory, unknown> = { formula_car: null, sports_car: null, gtp_car: null };
    for (const category of RATING_CATEGORIES) {
      const sessionId = sessionIdByCategory.get(category);
      const session = sessionId ? sessionById.get(sessionId) : null;
      if (!session || !session.car_id || !session.track_id || !session.garage61_event_id) {
        results[category] = { status: "ok", report: null, message: `Sem debrief de ${CATEGORY_LABEL[category]} calculado ainda — abra a aba "Meu Debrief" primeiro para escolher o contexto.` };
        continue;
      }
      try {
        results[category] = await buildSectorReport(driver.id, session.car_id, session.track_id, session.garage61_event_id);
      } catch (error) {
        results[category] = { status: "error", message: error instanceof Error ? error.message : String(error) };
      }
    }

    return NextResponse.json({ status: "ok", categories: results });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
