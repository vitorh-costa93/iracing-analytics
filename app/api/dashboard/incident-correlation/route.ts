import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Category = "formula_car" | "sports_car";

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n, meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    num += dx * dy; denomX += dx * dx; denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom > 0 ? num / denom : null;
}

function strengthLabel(r: number) {
  const abs = Math.abs(r);
  return abs < 0.1 ? "praticamente nenhuma" : abs < 0.3 ? "fraca" : abs < 0.5 ? "moderada" : abs < 0.7 ? "forte" : "muito forte";
}

/**
 * Correlates off-track laps per race (the closest real signal Garage61 exposes to "how many times
 * you left the track" — there is no raw incident-count field anywhere in the synced data, only this
 * per-lap boolean) with Δ iRating. Replaces the earlier Δ Safety Rating correlation: the user pointed
 * out that a track-limits incident from pushing hard doesn't necessarily mean a mistake — you can go
 * off track slightly and still set a clean, fast lap — so Safety Rating delta (a decayed, license-
 * weighted number) wasn't answering the actual question. This also directly tests that hypothesis:
 * are this driver's off-track laps actually slower than their clean laps, or comparable pace?
 */
export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    const { data: matches, error: matchError } = await supabaseAdmin
      .from("race_rating_matches")
      .select("session_id,rating_category,delta_irating")
      .eq("driver_id", driver.id);
    if (matchError) throw matchError;
    if (!matches || matches.length < 10) {
      return NextResponse.json({ status: "ok", available: false, message: `Ainda não há corridas suficientes casadas com Δ iRating (${matches?.length ?? 0} encontradas, mínimo 10).` });
    }

    const sessionIds = matches.map((m) => Number(m.session_id));
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from("driving_sessions").select("id,garage61_event_id,car_id,track_id").in("id", sessionIds);
    if (sessionsError) throw sessionsError;
    const sessionById = new Map((sessions ?? []).map((row) => [Number(row.id), row]));
    const eventIds = [...new Set((sessions ?? []).map((row) => row.garage61_event_id).filter(Boolean))];

    // Single batched query family (like the overview route's race-lap fetch) instead of one query per
    // race — looping per-session here was ~350 sequential round trips and timed out in the browser.
    // Supabase/PostgREST caps a response at 1000 rows regardless of .limit(), so this still needs
    // .range() pagination to actually get every lap across ~350 races.
    type LapRow = { garage61_payload: unknown; lap_time: number; off_track: boolean; clean: boolean; incomplete: boolean; pit_lane: boolean; pit_in: boolean; pit_out: boolean };
    const allLaps: LapRow[] = [];
    if (eventIds.length) {
      const PAGE_SIZE = 1000;
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data: page, error: lapsError } = await supabaseAdmin
          .from("laps").select("garage61_payload,lap_time,off_track,clean,incomplete,pit_lane,pit_in,pit_out")
          .eq("driver_id", driver.id).in("garage61_payload->>event", eventIds)
          .range(offset, offset + PAGE_SIZE - 1);
        if (lapsError) throw lapsError;
        allLaps.push(...((page ?? []) as LapRow[]));
        if (!page || page.length < PAGE_SIZE) break;
      }
    }
    const lapsByEvent = new Map<string, typeof allLaps>();
    for (const lap of allLaps ?? []) {
      const event = (lap.garage61_payload as { event?: string } | null)?.event;
      if (!event) continue;
      lapsByEvent.set(event, [...(lapsByEvent.get(event) ?? []), lap]);
    }

    const pairs: { sessionId: number; category: Category; deltaIrating: number; offtrackLaps: number; cleanLaps: number }[] = [];
    const paceRows: { offtrackAvg: number; cleanAvg: number }[] = [];

    for (const match of matches) {
      const session = sessionById.get(Number(match.session_id));
      if (!session?.garage61_event_id) continue;
      const eventLaps = lapsByEvent.get(session.garage61_event_id) ?? [];
      const raceLaps = eventLaps.filter((lap) => !lap.incomplete && !lap.pit_lane && !lap.pit_in && !lap.pit_out && Number(lap.lap_time) > 0);
      if (!raceLaps.length) continue;
      const offtrackLaps = raceLaps.filter((lap) => lap.off_track);
      const cleanLaps = raceLaps.filter((lap) => lap.clean && !lap.off_track);
      if (match.rating_category === "formula_car" || match.rating_category === "sports_car") {
        pairs.push({ sessionId: Number(match.session_id), category: match.rating_category, deltaIrating: match.delta_irating, offtrackLaps: offtrackLaps.length, cleanLaps: cleanLaps.length });
      }
      if (offtrackLaps.length >= 2 && cleanLaps.length >= 2) {
        const avg = (list: typeof raceLaps) => list.reduce((sum, lap) => sum + Number(lap.lap_time), 0) / list.length;
        paceRows.push({ offtrackAvg: avg(offtrackLaps), cleanAvg: avg(cleanLaps) });
      }
    }

    if (pairs.length < 10) {
      return NextResponse.json({ status: "ok", available: false, message: `Ainda não há corridas suficientes com dados de volta para uma correlação confiável (${pairs.length} encontradas, mínimo 10).` });
    }

    const byCategory: Record<Category, typeof pairs> = { formula_car: [], sports_car: [] };
    for (const pair of pairs) byCategory[pair.category].push(pair);

    const correlation = {
      all: pearson(pairs.map((p) => p.offtrackLaps), pairs.map((p) => p.deltaIrating)),
      formula_car: pearson(byCategory.formula_car.map((p) => p.offtrackLaps), byCategory.formula_car.map((p) => p.deltaIrating)),
      sports_car: pearson(byCategory.sports_car.map((p) => p.offtrackLaps), byCategory.sports_car.map((p) => p.deltaIrating)),
    };

    const r = correlation.all;
    const correlationText = r === null ? "Amostra insuficiente para calcular a correlação."
      : r < -0.1
        ? `Correlação negativa ${strengthLabel(r)} (r = ${r.toFixed(2)}): corridas com mais voltas fora da pista tendem a ser as mesmas em que você perde mais iRating.`
        : r > 0.1
          ? `Correlação positiva ${strengthLabel(r)} (r = ${r.toFixed(2)}): mais voltas fora da pista não andam junto com perder iRating nas suas corridas — às vezes até o contrário.`
          : `Correlação ${strengthLabel(r)} (r = ${r.toFixed(2)}): quantas vezes você sai da pista não parece prever se você ganha ou perde iRating naquela corrida.`;

    let paceText = "Amostra insuficiente de voltas fora da pista para comparar o ritmo.";
    if (paceRows.length >= 5) {
      const avgPctDiff = paceRows.reduce((sum, row) => sum + ((row.offtrackAvg - row.cleanAvg) / row.cleanAvg) * 100, 0) / paceRows.length;
      paceText = avgPctDiff > 1.5
        ? `Suas voltas com saída de pista são, em média, ${avgPctDiff.toFixed(1)}% mais lentas que suas voltas limpas na mesma corrida — sair da pista está custando tempo real, não é só "empurrar o limite" sem custo.`
        : avgPctDiff < -1.5
          ? `Suas voltas com saída de pista são, em média, ${Math.abs(avgPctDiff).toFixed(1)}% mais RÁPIDAS que suas voltas limpas na mesma corrida — isso apoia a ideia de que muitas dessas saídas são você empurrando o limite sem perder ritmo, não erros.`
          : `Suas voltas com saída de pista têm ritmo muito parecido (${avgPctDiff >= 0 ? "+" : ""}${avgPctDiff.toFixed(1)}%) com suas voltas limpas na mesma corrida — sair da pista, pelo menos nessa amostra, não está custando tempo de forma consistente.`;
    }

    return NextResponse.json({
      status: "ok",
      available: true,
      pairsAnalyzed: pairs.length,
      paceRowsAnalyzed: paceRows.length,
      correlation,
      correlationText,
      paceText,
      points: pairs.map((pair) => ({ sessionId: pair.sessionId, category: pair.category, offtrackLaps: pair.offtrackLaps, deltaIrating: pair.deltaIrating })),
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
