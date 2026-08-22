import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const RATING_CATEGORIES = ["formula_car", "sports_car", "gtp_car"] as const;
type RatingCategory = (typeof RATING_CATEGORIES)[number];
const CATEGORY_LABEL: Record<RatingCategory, string> = { formula_car: "Formula Car", sports_car: "Sports Car", gtp_car: "GTP" };

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function stddev(values: number[], avg: number) { return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length); }
function formatTime(value: number) {
  if (value >= 60) { const minutes = Math.floor(value / 60), seconds = value - minutes * 60; return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`; }
  return `${value.toFixed(3)}s`;
}
function consistencyLabel(sd: number, avg: number) {
  const ratio = avg > 0 ? sd / avg : 0;
  return ratio < 0.003 ? "muito consistente" : ratio < 0.008 ? "consistente" : ratio < 0.016 ? "variável" : "muito inconsistente";
}

/**
 * Sector-time consistency across EVERY clean lap ever recorded for a car/track combo — not just the
 * ~10 laps of one race like the race debrief. lap_sectors has 50k+ rows in this database that were
 * being synced and never queried anywhere; this is the first thing that reads them. Reuses whichever
 * car/track each category's cached race debrief last used, so "Meu Debrief" and this panel describe
 * the same context instead of picking independently.
 */
async function buildSectorReport(driverId: string, carId: number, trackId: number) {
  const [carRow, trackRow] = await Promise.all([
    supabaseAdmin.from("cars").select("name").eq("id", carId).maybeSingle(),
    supabaseAdmin.from("tracks").select("name,variant").eq("id", trackId).maybeSingle(),
  ]);

  const { data: laps, error: lapsError } = await supabaseAdmin
    .from("laps")
    .select("id,lap_time")
    .eq("driver_id", driverId).eq("car_id", carId).eq("track_id", trackId)
    .eq("clean", true).eq("incomplete", false)
    .not("pit_lane", "is", true).not("pit_in", "is", true).not("pit_out", "is", true)
    .not("lap_time", "is", null).gt("lap_time", 0)
    .order("created_at", { ascending: false })
    .limit(3000);
  if (lapsError) throw lapsError;
  if (!laps || laps.length < 5) return { status: "ok" as const, report: null, message: `Poucas voltas limpas registradas com ${carRow.data?.name ?? "esse carro"} em ${trackRow.data?.name ?? "essa pista"} para uma análise de setores confiável (mínimo 5).` };

  const lapIds = laps.map((lap) => lap.id);
  const sectorRows: { lap_id: string; sector_number: number; sector_time: number; incomplete: boolean }[] = [];
  const CHUNK = 500;
  for (let i = 0; i < lapIds.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin.from("lap_sectors").select("lap_id,sector_number,sector_time,incomplete").in("lap_id", lapIds.slice(i, i + CHUNK)).eq("incomplete", false).gt("sector_time", 0);
    if (error) throw error;
    sectorRows.push(...(data ?? []));
  }
  if (!sectorRows.length) return { status: "ok" as const, report: null, message: "Essas voltas não têm tempos de setor registrados." };

  const bySector = new Map<number, number[]>();
  for (const row of sectorRows) bySector.set(row.sector_number, [...(bySector.get(row.sector_number) ?? []), row.sector_time]);

  const sectorCount = Math.max(...bySector.keys());
  const sectors = Array.from({ length: sectorCount }, (_, index) => {
    const number = index + 1;
    const times = bySector.get(number) ?? [];
    if (times.length < 5) return null;
    const avg = mean(times);
    const sd = stddev(times, avg);
    const best = Math.min(...times);
    return { sector: number, sampleSize: times.length, mean: Number(avg.toFixed(3)), stddev: Number(sd.toFixed(3)), best: Number(best.toFixed(3)), consistency: consistencyLabel(sd, avg) };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  if (!sectors.length) return { status: "ok" as const, report: null, message: "Amostra de setores insuficiente para uma análise confiável." };

  const idealLap = sectors.reduce((sum, sector) => sum + sector.best, 0);
  const lapTimes = laps.map((lap) => Number(lap.lap_time));
  const actualBestLap = Math.min(...lapTimes);
  const gapToIdeal = actualBestLap - idealLap;

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
      summary: `Juntando seu melhor tempo em cada um dos ${sectors.length} setores (mesmo que não tenham sido na mesma volta), sua volta ideal em ${trackRow.data?.name ?? "essa pista"} seria ${formatTime(idealLap)} — ${gapToIdeal.toFixed(3)}s mais rápida que sua melhor volta real (${formatTime(actualBestLap)}). Isso mostra quanto tempo ainda está "na mesa" só de juntar seus próprios melhores pedaços numa volta só. O setor ${worstSector.sector} é onde você mais varia (${worstSector.consistency}); o setor ${bestSector.sector} é onde você mais se repete (${bestSector.consistency}).`,
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
      ? await supabaseAdmin.from("driving_sessions").select("id,car_id,track_id").in("id", sessionIds)
      : { data: [] as { id: number; car_id: number; track_id: number }[] };
    const sessionById = new Map((sessionRows ?? []).map((row) => [Number(row.id), row]));

    const results: Record<RatingCategory, unknown> = { formula_car: null, sports_car: null, gtp_car: null };
    for (const category of RATING_CATEGORIES) {
      const sessionId = sessionIdByCategory.get(category);
      const session = sessionId ? sessionById.get(sessionId) : null;
      if (!session || !session.car_id || !session.track_id) {
        results[category] = { status: "ok", report: null, message: `Sem debrief de ${CATEGORY_LABEL[category]} calculado ainda — abra a aba "Meu Debrief" primeiro para escolher o contexto.` };
        continue;
      }
      try {
        results[category] = await buildSectorReport(driver.id, session.car_id, session.track_id);
      } catch (error) {
        results[category] = { status: "error", message: error instanceof Error ? error.message : String(error) };
      }
    }

    return NextResponse.json({ status: "ok", categories: results });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
