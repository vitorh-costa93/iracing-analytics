import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildEngineerSection, Category, RaceInput } from "@/lib/race-engineer-analysis";

export const dynamic = "force-dynamic";
const CATEGORIES: Category[] = ["formula_car", "sports_car"];

function errorText(source: string, error: unknown): never {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  throw new Error(`${source}: ${typeof value.message === "string" ? value.message : String(error)}`);
}

async function pagedRaces(driverId: string, start: string, end: string): Promise<RaceInput[]> {
  const all: RaceInput[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabaseAdmin.from("v_race_results_irating")
      .select("raced_at,category,series_name,track_name,car_name,season_week,finish_position,grid_position,position_change,irating_after,irating_before,sof,incidents")
      .eq("driver_id", driverId).gte("raced_at", start).lt("raced_at", end).in("category", CATEGORIES)
      .order("raced_at", { ascending: true }).range(from, from + size - 1);
    if (error) errorText("v_race_results_irating", error);
    all.push(...((data ?? []) as RaceInput[]));
    if (!data || data.length < size) return all;
  }
}

export async function GET(request: NextRequest) {
  try {
    const scope = request.nextUrl.searchParams.get("scope") === "week" ? "week" : "season";
    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (driverError) errorText("drivers", driverError);
    if (!driver) throw new Error("Nenhum piloto encontrado no Supabase.");

    const { data: summaries, error: summariesError } = await supabaseAdmin.from("v_season_summary").select("season_id,season_name");
    if (summariesError) errorText("v_season_summary", summariesError);
    const seasons = [...(summaries ?? [])].sort((a, b) => Number(b.season_id) - Number(a.season_id));
    const current = seasons[0], previous = seasons[1];
    if (!current || !previous) throw new Error("São necessárias duas seasons para comparar.");

    const { data: calendar, error: calendarError } = await supabaseAdmin.from("v_season_calendar").select("season_id,season_name,season_start").in("season_id", [String(current.season_id), String(previous.season_id)]);
    if (calendarError) errorText("v_season_calendar", calendarError);
    const byId = new Map((calendar ?? []).map((row) => [String(row.season_id), row]));
    const currentStart = byId.get(String(current.season_id))?.season_start;
    const previousStart = byId.get(String(previous.season_id))?.season_start;
    if (!currentStart || !previousStart) throw new Error("O calendário não possui o início das duas seasons.");

    const currentEnd = new Date(new Date(currentStart).getTime() + 84 * 86400000).toISOString();
    const races = await pagedRaces(driver.id, previousStart, currentEnd);
    const startMs = new Date(currentStart).getTime();
    const currentRows = races.filter((row) => new Date(row.raced_at).getTime() >= startMs);
    const previousRows = races.filter((row) => new Date(row.raced_at).getTime() < startMs);

    const sections = CATEGORIES.map((category) => {
      const currentCategory = currentRows.filter((row) => row.category === category);
      const previousCategory = previousRows.filter((row) => row.category === category);
      const activeWeek = currentCategory.reduce<number | null>((latest, row) => row.season_week !== null && (latest === null || row.season_week > latest) ? row.season_week : latest, null);
      const selected = scope === "week" && activeWeek !== null ? currentCategory.filter((row) => row.season_week === activeWeek) : currentCategory;
      const baseline = scope === "week" && activeWeek !== null ? previousCategory.filter((row) => row.season_week === activeWeek) : previousCategory;
      return buildEngineerSection(category, selected, baseline, scope, scope === "week" ? activeWeek : null);
    });

    return NextResponse.json({
      status: "ok", scope, seasonName: current.season_name, previousSeasonName: previous.season_name, generatedAt: new Date().toISOString(),
      methodology: "Resultados oficiais, iRating, SoF, posições e incidentes são cruzados por corrida. Associações são identificadas como associações; contato, tow e confiança de inputs só são afirmados quando a origem expuser o evento/canal.",
      sections,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
