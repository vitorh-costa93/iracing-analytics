import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type IncomingSetup = {
  car: number;
  track: number;
  name: string;
  seasonId?: number | string;
  runId?: string;
  event?: string;
  setupFixed?: boolean;
  setupCommercial?: boolean;
  parameters: Record<string, Record<string, Record<string, string | number>>>;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://garage61.net",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-import-key",
};

function humanize(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\bArb\b/g, "ARB").replace(/\bRd\b/g, "3rd");
}

function decodedRows(parameters: IncomingSetup["parameters"]) {
  return Object.entries(parameters ?? {}).flatMap(([tab, sections]) =>
    Object.entries(sections ?? {}).flatMap(([section, values]) =>
      Object.entries(values ?? {}).map(([label, metricValue]) => ({ tab: humanize(tab), section: humanize(section), label: humanize(label), metric_value: metricValue, is_mapped: true }))
    )
  );
}

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "setup";
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.GARAGE61_IMPORT_SECRET;
    if (!secret || request.headers.get("x-import-key") !== secret) {
      return NextResponse.json({ status: "error", message: "Chave de importação inválida" }, { status: 401, headers: CORS_HEADERS });
    }

    const body = await request.json() as { items?: IncomingSetup[]; checkedEvents?: { eventId: string; car?: number; track?: number }[] };
    const items = body.items ?? [];
    const checkedEvents = body.checkedEvents ?? [];
    if (!items.length && !checkedEvents.length) throw new Error("Nenhum setup recebido");

    const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
    if (driverError || !driver) throw new Error("Piloto não encontrado");

    const { data: currentSeason } = await supabaseAdmin.from("v_season_summary").select("season_id").order("season_id", { ascending: false }).limit(1).maybeSingle();
    const fallbackSeasonId = currentSeason?.season_id ?? null;

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        if (!item.parameters || !item.name || !Number.isInteger(item.car) || !Number.isInteger(item.track)) { skipped += 1; continue; }
        const seasonId = item.seasonId ?? fallbackSeasonId;
        if (!seasonId) { skipped += 1; errors.push(`${item.name}: sem season identificável`); continue; }
        const setupKind = item.setupFixed ? "fixed" : item.setupCommercial ? "commercial" : "open";
        const filename = item.name;
        const storagePath = `${driver.id}/${seasonId}/${item.car}/${item.track}/garage61/${safeName(filename)}.json`;
        const payload = { source: "garage61", seasonId, event: item.event, runId: item.runId, setupFixed: item.setupFixed, setupCommercial: item.setupCommercial, setup: { car: item.car, track: item.track, name: item.name, parameters: item.parameters } };
        const bytes = Buffer.from(JSON.stringify(payload));
        const { error: storageError } = await supabaseAdmin.storage.from("private-setups").upload(storagePath, bytes, { contentType: "application/octet-stream", upsert: true });
        if (storageError) throw storageError;

        const { error: upsertError } = await supabaseAdmin.from("setup_files").upsert({
          driver_id: driver.id, season_id: seasonId, car_id: item.car, track_id: item.track,
          source: "garage61", setup_kind: setupKind, filename, storage_path: storagePath,
          garage61_lap_id: item.runId ?? null, file_size: bytes.length, decoded_car_name: String(item.car),
          garage61_event_id: item.event ?? null,
          decoded_params: decodedRows(item.parameters), decoded_at: new Date().toISOString(), decoder: "garage61",
          external_decode_consent_at: null, updated_at: new Date().toISOString(),
        }, { onConflict: "driver_id,season_id,car_id,track_id,filename" });
        if (upsertError) throw upsertError;
        imported += 1;
      } catch (itemError) {
        skipped += 1;
        const detail = itemError instanceof Error ? itemError.message : (itemError && typeof itemError === "object" && "message" in itemError ? String((itemError as { message: unknown }).message) : JSON.stringify(itemError));
        errors.push(`${item.name ?? "?"}: ${detail}`);
      }
    }

    if (checkedEvents.length) {
      const foundEventIds = new Set(items.map((item) => item.event).filter((id): id is string => typeof id === "string"));
      const checkRows = checkedEvents.map((event) => ({
        driver_id: driver.id, garage61_event_id: event.eventId,
        car_id: event.car ?? null, track_id: event.track ?? null,
        found: foundEventIds.has(event.eventId), checked_at: new Date().toISOString(),
      }));
      const { error: checksError } = await supabaseAdmin.from("setup_import_checks").upsert(checkRows, { onConflict: "driver_id,garage61_event_id" });
      if (checksError) errors.push(`Falha ao registrar eventos verificados: ${checksError.message}`);
    }

    return NextResponse.json({ status: "ok", imported, skipped, errors: errors.slice(0, 20) }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : String(error) }, { status: 400, headers: CORS_HEADERS });
  }
}
