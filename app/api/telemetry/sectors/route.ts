import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSectorReport } from "@/lib/sector-report";

const RATING_CATEGORIES = ["formula_car", "sports_car", "gtp_car"] as const;
type RatingCategory = (typeof RATING_CATEGORIES)[number];
const CATEGORY_LABEL: Record<RatingCategory, string> = { formula_car: "Formula Car", sports_car: "Sports Car", gtp_car: "GTP" };

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
