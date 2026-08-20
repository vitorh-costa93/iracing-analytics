import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const { data: seasons, error: seasonError } = await supabaseAdmin.from("v_season_summary").select("season_id,season_name");
    if (seasonError) throw seasonError;
    const current = [...(seasons ?? [])].sort((a, b) => Number(b.season_id) - Number(a.season_id))[0];
    const seasonParts = String(current?.season_name ?? "").match(/(\d{4}) Season (\d)/);
    const code = seasonParts ? `${seasonParts[1].slice(2)}S${seasonParts[2]}` : "26S3";
    const { data, error } = await supabaseAdmin.storage.from("private-setups").download(`local-library/${code}/manifest.json`);
    if (error || !data) return NextResponse.json({ status: "ok", seasonCode: code, total: 0, items: [], importedAt: null });
    return NextResponse.json({ status: "ok", ...JSON.parse(await data.text()) });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
