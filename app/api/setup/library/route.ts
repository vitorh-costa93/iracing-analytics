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

// 04/09/2026 varredura: "bmwlmdh" (biblioteca local, pasta P1Doks/iRacing, último carregado Le Mans)
// não batia por igualdade nem por prefixo contra nenhum carro real -- confirmado contra a tabela
// `cars` que "BMW M Hybrid V8 (Evo)" é o único protótipo BMW no catálogo (nenhuma ambiguidade), e
// esse piloto já correu 21 corridas com ele (GTP). O provedor do setup usa a classe do carro (LMDh)
// em vez do nome/modelo na pasta, então nem igualdade nem prefixo normalizado alcançam -- exceção
// pontual, não um padrão geral (outras 7 pastas desta mesma biblioteca resolveram normalmente).
const FOLDER_ALIASES: Record<string, string> = {
  bmwlmdh: "BMW M Hybrid V8 (Evo)",
};

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
      const normalizedCars = (cars ?? []).map((car) => ({ name: car.name as string, slug: normalizeCarSlug(car.name as string) }));
      for (const folder of folders) {
        const target = normalizeCarSlug(folder);
        // Exact match first; falls back to "folder is a prefix of the real name" for a folder that
        // drops a trailing variant/trim iRacing itself adds to the display name (confirmed live:
        // local folder "mclaren720sgt3" for the real car "McLaren 720S GT3 EVO" -- no exact match,
        // but the folder is unambiguously a prefix of it). Picks the SHORTEST such match so a very
        // short folder slug can't accidentally prefix-match an unrelated longer car name.
        const exact = normalizedCars.find((car) => car.slug === target);
        const prefix = !exact ? normalizedCars.filter((car) => car.slug.startsWith(target)).sort((a, b) => a.slug.length - b.slug.length)[0] : null;
        const match = exact ?? prefix;
        const resolved = match?.name ?? FOLDER_ALIASES[target];
        if (resolved) carNames[folder] = resolved;
      }
    }
    return NextResponse.json({ status: "ok", ...manifest, carNames });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
