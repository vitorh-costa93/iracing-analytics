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
 * Correlates Δ Safety Rating with Δ iRating per race — does a race where you also lose Safety Rating
 * (incidents) tend to cost more iRating too, or are they independent? Uses Pearson's r as a plain
 * -1..+1 number, translated to a sentence, plus the raw scatter for the chart. Correlation, not
 * causation — stated explicitly in the summary rather than implied.
 */
export async function GET() {
  try {
    const { data: driver } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (!driver) throw new Error("Piloto não encontrado");

    const { data: rows, error } = await supabaseAdmin
      .from("race_rating_matches")
      .select("session_id,rating_category,rating_at,delta_irating,delta_safety_rating")
      .eq("driver_id", driver.id)
      .not("delta_safety_rating", "is", null)
      .order("rating_at", { ascending: true });
    if (error) throw error;

    const pairs = (rows ?? []) as { session_id: number; rating_category: Category; rating_at: string; delta_irating: number; delta_safety_rating: number }[];
    if (pairs.length < 10) {
      return NextResponse.json({ status: "ok", available: false, message: `Ainda não há pares suficientes de Δ iRating / Δ Safety Rating para uma correlação confiável (${pairs.length} encontrados, mínimo 10).` });
    }

    const byCategory: Record<Category, typeof pairs> = { formula_car: [], sports_car: [] };
    for (const pair of pairs) if (pair.rating_category === "formula_car" || pair.rating_category === "sports_car") byCategory[pair.rating_category].push(pair);

    const correlation = {
      all: pearson(pairs.map((p) => p.delta_safety_rating), pairs.map((p) => p.delta_irating)),
      formula_car: pearson(byCategory.formula_car.map((p) => p.delta_safety_rating), byCategory.formula_car.map((p) => p.delta_irating)),
      sports_car: pearson(byCategory.sports_car.map((p) => p.delta_safety_rating), byCategory.sports_car.map((p) => p.delta_irating)),
    };

    const r = correlation.all;
    const summary = r === null ? "Amostra insuficiente para calcular a correlação." : r > 0.1
      ? `Correlação positiva ${strengthLabel(r)} (r = ${r.toFixed(2)}): corridas em que você também perde Safety Rating (mais incidentes) tendem a ser as mesmas em que você perde mais iRating. Isso é correlação, não causa comprovada — mas é consistente com "corridas bagunçadas custam nos dois indicadores ao mesmo tempo", não necessariamente que um incidente cause a perda de iRating diretamente.`
      : r < -0.1
        ? `Correlação negativa ${strengthLabel(r)} (r = ${r.toFixed(2)}): nas suas corridas, ganhar/perder Safety Rating não anda junto com ganhar/perder iRating — às vezes até o contrário. Os dois indicadores parecem estar respondendo a coisas diferentes na sua pilotagem.`
        : `Correlação ${strengthLabel(r)} (r = ${r.toFixed(2)}): Δ Safety Rating e Δ iRating não parecem andar juntos nas suas corridas — um incidente que custa Safety Rating não costuma custar iRating junto, e vice-versa.`;

    return NextResponse.json({
      status: "ok",
      available: true,
      pairsAnalyzed: pairs.length,
      correlation,
      summary,
      points: pairs.map((pair) => ({ sessionId: pair.session_id, category: pair.rating_category, ratingAt: pair.rating_at, deltaIRating: pair.delta_irating, deltaSafetyRating: pair.delta_safety_rating })),
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
