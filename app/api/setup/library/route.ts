import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// 02/09/2026 P2 fix: "o Laboratory mostra slugs crus (acuraarx06gtp) em vez do nome real do carro" --
// carFolder is iRacing's own local setup-folder naming (lowercase, no spaces/punctuation): perfect for
// matching a filesystem path, useless as a display label. Resolved against the FULL cars table here
// (not just cars the driver has raced recently) by normalizing both sides the same way, so every real
// car name is a candidate match, not only the ones already loaded for some other picker.
function normalizeCarSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function GET() {
  try {
    const { data: seasons, error: seasonError } = await supabaseAdmin.from("v_season_summary").select("season_id,season_name");
    if (seasonError) throw seasonError;
    const current = [...(seasons ?? [])].sort((a, b) => Number(b.season_id) - Number(a.season_id))[0];
    const seasonParts = String(current?.season_name ?? "").match(/(\d{4}) Season (\d)/);
    const code = seasonParts ? `${seasonParts[1].slice(2)}S${seasonParts[2]}` : "26S3";
    const { data, error } = await supabaseAdmin.storage.from("private-setups").download(`local-library/${code}/manifest.json`);
    if (error || !data) return NextResponse.json({ status: "ok", seasonCode: code, total: 0, items: [], importedAt: null, carNames: {} });
    const manifest = JSON.parse(await data.text()) as { items?: { carFolder: string }[] };
    const folders = [...new Set((manifest.items ?? []).map((item) => item.carFolder))];
    const carNames: Record<string, string> = {};
    if (folders.length) {
      const { data: cars } = await supabaseAdmin.from("cars").select("name");
      for (const folder of folders) {
        const target = normalizeCarSlug(folder);
        const match = (cars ?? []).find((car) => normalizeCarSlug(car.name as string) === target);
        if (match) carNames[folder] = match.name as string;
      }
    }
    return NextResponse.json({ status: "ok", ...manifest, carNames });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
