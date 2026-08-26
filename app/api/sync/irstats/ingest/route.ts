import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { importRaceFromHtml, resolveCarTrackIds } from "@/app/api/sync/irstats/route";

// irstats.com sits behind a Cloudflare bot challenge that blocks any non-browser fetch (confirmed:
// server-side requests from Vercel and other datacenter IPs get a 403 "Just a moment..." challenge
// page regardless of headers). This endpoint receives already-fetched race detail HTML captured by
// a real browser session (a bookmarklet/userscript run by the driver while on irstats.com, which
// passes the challenge naturally) and does the same parse+resolve+upsert as the server-side sync
// route — it's the only path that gets this data into race_results in practice.
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://irstats.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-import-key",
};

type IncomingRace = { raceId: number; html: string };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Lets the browser script skip re-fetching/re-sending races already in race_results, so an
// incremental re-run only does work for genuinely new races instead of re-walking everything.
export async function GET(request: NextRequest) {
  const secret = process.env.IRSTATS_IMPORT_SECRET;
  if (!secret || request.headers.get("x-import-key") !== secret) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const { data: driver, error: driverError } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  if (driverError || !driver) {
    return NextResponse.json({ status: "error", message: "Piloto não encontrado" }, { status: 500, headers: CORS_HEADERS });
  }

  const knownIds: number[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data: idsPage, error: idsError } = await supabaseAdmin
      .from("race_results")
      .select("irstats_race_id")
      .eq("driver_id", driver.id)
      .range(offset, offset + pageSize - 1);
    if (idsError) {
      return NextResponse.json({ status: "error", message: idsError.message }, { status: 500, headers: CORS_HEADERS });
    }
    for (const row of idsPage ?? []) knownIds.push(row.irstats_race_id as number);
    if (!idsPage || idsPage.length < pageSize) break;
  }

  const { count: roadCount, error: roadCountError } = await supabaseAdmin
    .from("race_results")
    .select("*", { count: "exact", head: true })
    .eq("driver_id", driver.id)
    .eq("category", "road");
  if (roadCountError) {
    return NextResponse.json({ status: "error", message: roadCountError.message }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ status: "ok", knownIds, roadCount: roadCount ?? 0 }, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.IRSTATS_IMPORT_SECRET;
    if (!secret || request.headers.get("x-import-key") !== secret) {
      return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }

    const body = (await request.json()) as { races?: IncomingRace[] };
    const races = body.races ?? [];
    if (!races.length) {
      return NextResponse.json({ status: "error", message: "Nenhuma corrida enviada" }, { status: 400, headers: CORS_HEADERS });
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (driverError || !driver) throw new Error("Piloto não encontrado no Supabase");

    const catalog = await resolveCarTrackIds();

    let imported = 0;
    let failed = 0;
    const results: { raceId: number; status: "imported" | "error"; message?: string }[] = [];

    for (const race of races) {
      try {
        await importRaceFromHtml(race.raceId, race.html, driver.id, driver.name, catalog);
        imported += 1;
        results.push({ raceId: race.raceId, status: "imported" });
      } catch (error) {
        failed += 1;
        results.push({ raceId: race.raceId, status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }

    return NextResponse.json({ status: "ok", imported, failed, results }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
