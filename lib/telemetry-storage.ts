import { gunzipSync, gzipSync } from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Single entry point for reading/writing lap telemetry in Storage. PERMANENT GUARD-RAIL (CLAUDE.md
// "Non-negotiable rules" #7): every download is counted in telemetry_download_usage and refused once
// today's total reaches the budget below. The org already hit the free-tier "Cached Egress" quota
// twice (08/09 and 23/09/2026); after the second time there is no further grace period, so the next
// overage restricts every project in the org (including the clinic app). Do not raise this budget,
// or add a Storage read that bypasses this module, without the user's explicit request.
// 100 MB/day ~= 3.1 GB per 30-day cycle, under the 5 GB quota with room for the other buckets.
export const TELEMETRY_DAILY_DOWNLOAD_BUDGET_BYTES = 100 * 1024 * 1024;

const TEXT_CACHE_MAX_ENTRIES = 60; // ~800 KB of CSV each -> <= ~50 MB per warm instance
const textCache = new Map<string, string>();

function remember(key: string, text: string) {
  textCache.delete(key);
  textCache.set(key, text);
  while (textCache.size > TEXT_CACHE_MAX_ENTRIES) textCache.delete(textCache.keys().next().value!);
}

async function downloadedToday(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from("telemetry_download_usage").select("bytes").eq("day", today).maybeSingle();
  if (error) throw error;
  return Number(data?.bytes ?? 0);
}

async function record(bytes: number, blocked = false) {
  const { error } = await supabaseAdmin.rpc("record_telemetry_download", { p_bytes: bytes, p_blocked: blocked });
  if (error) console.error("record_telemetry_download failed:", error);
}

const isGzip = (bytes: Buffer) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

// Raw stored bytes (possibly gzip), budget-enforced. Returns null when the budget is exhausted or the
// object can't be fetched -- callers already treat a missing trace as "not available".
export async function downloadTelemetryBytes(path: string, bucket = "telemetry"): Promise<Buffer | null> {
  let used: number;
  try { used = await downloadedToday(); } catch (error) { console.error("telemetry budget check failed:", error); return null; }
  if (used >= TELEMETRY_DAILY_DOWNLOAD_BUDGET_BYTES) {
    await record(0, true);
    console.warn(`telemetry download refused: daily budget reached (${used} bytes)`);
    return null;
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  await record(bytes.length);
  return bytes;
}

// CSV text for a stored lap, transparently gunzipping .csv.gz objects. Before this, most routes read
// file.text() directly, which turned every compressed lap into binary garbage.
export async function readTelemetryText(path: string, bucket = "telemetry"): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = textCache.get(key);
  if (hit !== undefined) { remember(key, hit); return hit; }
  const bytes = await downloadTelemetryBytes(path, bucket);
  if (!bytes) return null;
  let text: string;
  try { text = (isGzip(bytes) ? gunzipSync(bytes) : bytes).toString("utf8"); } catch { return null; }
  remember(key, text);
  return text;
}

// Stores a lap CSV fetched live from Garage61 -- always gzip, the same format the backfill writes, so
// a live fallback never reverts a lap to an uncompressed .csv (that used to start a recompress loop).
export async function storeTelemetryCsv(trackId: number | string, lapId: string, csv: string) {
  const path = `laps/${trackId}/${lapId}.csv.gz`;
  const { error: uploadError } = await supabaseAdmin.storage.from("telemetry").upload(path, gzipSync(Buffer.from(csv, "utf8"), { level: 9 }), { contentType: "application/gzip", upsert: true });
  if (uploadError) return null;
  await supabaseAdmin.from("laps").update({ telemetry_path: path }).eq("id", lapId);
  remember(`telemetry/${path}`, csv);
  return path;
}
