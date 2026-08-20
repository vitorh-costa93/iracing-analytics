import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const inputDir = process.env.GARAGE61_SETUP_EXPORT_DIR ?? "data/garage61-events-26S3";
const seasonId = process.env.IRACING_SEASON_ID ?? "34";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const files = (await fs.readdir(inputDir)).filter((file) => file.endsWith(".json")).sort();
const events = (await Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(inputDir, file), "utf8"))))).flat();
const uses = events.filter((event) => event.status === "ok").flatMap((event) => (event.setups ?? []).map((used) => ({ ...used, event: event.event, meta: event.meta })));
const logical = new Map();
for (const used of uses) {
  if (!used.setup?.parameters || !used.setup?.name) continue;
  logical.set(`${used.setup.car}:${used.setup.track}:${used.setup.name}`, used);
}

const { data: driver, error: driverError } = await db.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
if (driverError || !driver) throw driverError ?? new Error("Piloto não encontrado");

const humanize = (value) => String(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\bArb\b/g, "ARB").replace(/\bRd\b/g, "3rd");
const decodedRows = (parameters) => Object.entries(parameters).flatMap(([tab, sections]) => Object.entries(sections ?? {}).flatMap(([section, values]) => Object.entries(values ?? {}).map(([label, metricValue]) => ({ tab: humanize(tab), section: humanize(section), label: humanize(label), metric_value: metricValue, is_mapped: true }))));
const safe = (value) => String(value).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "setup";

let imported = 0;
for (const used of logical.values()) {
  const setupKind = used.setupFixed ? "fixed" : used.setupCommercial ? "commercial" : "open";
  const payload = { source: "garage61", seasonId, event: used.event, runId: used.runId, setupFixed: used.setupFixed, setupCommercial: used.setupCommercial, setup: used.setup };
  const bytes = Buffer.from(JSON.stringify(payload));
  const filename = used.setup.name;
  const storagePath = `${driver.id}/${seasonId}/${used.setup.car}/${used.setup.track}/garage61/${safe(filename)}.json`;
  const { error: storageError } = await db.storage.from("private-setups").upload(storagePath, bytes, { contentType: "application/octet-stream", upsert: true });
  if (storageError) throw storageError;
  const row = {
    driver_id: driver.id,
    season_id: seasonId,
    car_id: used.setup.car,
    track_id: used.setup.track,
    source: "garage61",
    setup_kind: setupKind,
    filename,
    storage_path: storagePath,
    garage61_lap_id: used.runId,
    file_size: bytes.length,
    decoded_car_name: String(used.setup.car),
    decoded_params: decodedRows(used.setup.parameters),
    decoded_at: new Date().toISOString(),
    decoder: "garage61",
    external_decode_consent_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("setup_files").upsert(row, { onConflict: "driver_id,season_id,car_id,track_id,filename" });
  if (error) throw error;
  imported += 1;
}

console.log(JSON.stringify({ events: events.length, setupUses: uses.length, logicalSetups: logical.size, imported }, null, 2));
