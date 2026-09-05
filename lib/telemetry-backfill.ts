import { supabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "telemetry";
const BATCH_SIZE = 12;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_BUDGET_BYTES = 700 * 1024 * 1024;

type StorageEntry = { id?: string | null; name: string; metadata?: { size?: number } | null };
type Candidate = { id: string; track_id: number | null };

function configuredBudget() {
  const parsed = Number(process.env.TELEMETRY_BACKFILL_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_BYTES;
}

async function storedBytes(prefix = ""): Promise<number> {
  let total = 0;
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Não foi possível medir o Storage: ${error.message}`);

    for (const entry of (data ?? []) as StorageEntry[]) {
      if (entry.id) {
        total += Number(entry.metadata?.size ?? 0);
      } else {
        const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        total += await storedBytes(childPrefix);
      }
    }
    if (!data || data.length < pageSize) return total;
  }
}

export async function runTelemetryBackfill() {
  const budgetBytes = configuredBudget();
  let usedBytes = await storedBytes();
  if (usedBytes >= budgetBytes) return { status: "budget_reached", downloaded: 0, usedBytes, budgetBytes };

  const { data: candidates, error: candidatesError } = await supabaseAdmin.from("laps")
    .select("id,track_id").eq("can_view_telemetry", true).is("telemetry_path", null)
    .order("synced_at", { ascending: true }).limit(BATCH_SIZE);
  if (candidatesError) throw candidatesError;

  const token = process.env.GARAGE61_API_TOKEN;
  if (!token) throw new Error("GARAGE61_API_TOKEN não configurado");

  let downloaded = 0;
  let skippedOversize = 0;
  let stoppedByBudget = false;

  for (const lap of (candidates ?? []) as Candidate[]) {
    const response = await fetch(`https://garage61.net/api/v1/laps/${encodeURIComponent(lap.id)}/csv`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, cache: "no-store",
    });
    if (!response.ok) continue;
    const declaredBytes = Number(response.headers.get("content-length") ?? 0);
    if (declaredBytes > MAX_FILE_BYTES || (declaredBytes && usedBytes + declaredBytes > budgetBytes)) {
      skippedOversize++;
      if (usedBytes + declaredBytes > budgetBytes) stoppedByBudget = true;
      continue;
    }
    const csv = await response.text();
    const bytes = Buffer.byteLength(csv, "utf8");
    if (bytes > MAX_FILE_BYTES) { skippedOversize++; continue; }
    if (usedBytes + bytes > budgetBytes) { stoppedByBudget = true; break; }

    const path = `laps/${lap.track_id ?? "unknown"}/${lap.id}.csv`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET)
      .upload(path, csv, { contentType: "text/csv; charset=utf-8", upsert: false });
    if (uploadError) continue;
    const { error: updateError } = await supabaseAdmin.from("laps")
      .update({ telemetry_path: path, synced_at: new Date().toISOString() }).eq("id", lap.id);
    if (updateError) throw updateError;
    usedBytes += bytes;
    downloaded++;
  }

  return { status: stoppedByBudget ? "budget_reached" : "ok", downloaded, skippedOversize, usedBytes, budgetBytes };
}

