import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validateImportedSeasonCalendar } from "@/lib/season-calendar-import";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ message: "Origem não autorizada." }, { status: 403 });
  try {
    const calendar = validateImportedSeasonCalendar(await request.json());
    const { error } = await supabaseAdmin.rpc("import_season_calendar", {
      p_season_id: calendar.seasonId,
      p_season_name: calendar.seasonName,
      p_season_start: calendar.seasonStart,
      p_source_file_name: calendar.sourceFileName,
      p_source_sha256: calendar.sourceSha256,
      p_contexts: calendar.contexts.map((item) => ({
        week_number: item.weekNumber,
        context_key: item.contextKey,
        series_name: item.seriesName,
        track_name: item.trackName,
        track_match_terms: item.trackMatchTerms,
      })),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      status: "ok",
      message: `${calendar.seasonName} aplicada: 12 weeks para Super Formula 23, IMSA e GT3 Challenge.`,
      season: { id: calendar.seasonId, name: calendar.seasonName, start: calendar.seasonStart },
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível importar o calendário." }, { status: 400 });
  }
}
