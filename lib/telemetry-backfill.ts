import { gzipSync } from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "telemetry";
// PERMANENT GUARD-RAIL (see CLAUDE.md "Non-negotiable rules" #7): the Supabase project is on the
// free tier and stays there. Do not raise BUDGET past what the plan's Storage allowance leaves
// headroom for, and do not remove MAX_FILE_BYTES/BATCH without an explicit request -- this project
// already caused one real quota incident (Cached Egress, 08/09/2026) from an unrelated route that
// had no cache at all; do not let this one become the next.
const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const TELEMETRY_STORAGE_BUDGET_BYTES = 900 * 1024 * 1024;
const BUDGET = TELEMETRY_STORAGE_BUDGET_BYTES;
const BATCH = 24;
const COMPACTION_BATCH = 10;
const PAGE = 500;

type Entry = { id?: string | null; name: string; metadata?: { size?: number } | null };
type Payload = { season?: { name?: string }; sessionType?: number; session_type?: number; session?: string };
type Candidate = { id: string; track_id: number | null; telemetry_path?: string | null; garage61_payload?: Payload };

const pathOf = (prefix: string, name: string) => prefix ? prefix + "/" + name : name;
const isRace = (p: Payload) => {
  const type = p.sessionType ?? p.session_type;
  return p.session === "Race" || type === 2 || type === 3;
};
const keep = (lap: Candidate, current: string, previous: string) => {
  const season = lap.garage61_payload?.season?.name;
  return season === current || (season === previous && isRace(lap.garage61_payload ?? {}));
};

async function listRaw(prefix = "", out: string[] = []): Promise<string[]> {
  const q = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (q.error) throw q.error;
  for (const e of (q.data ?? []) as Entry[]) {
    const path = pathOf(prefix, e.name);
    if (e.id && path.endsWith(".csv")) out.push(path);
    else if (!e.id) await listRaw(path, out);
    if (out.length >= COMPACTION_BATCH) break;
  }
  return out;
}

async function used(prefix = ""): Promise<number> {
  const q = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (q.error) throw q.error;
  let total = 0;
  for (const e of (q.data ?? []) as Entry[]) {
    total += e.id ? Number(e.metadata?.size ?? 0) : await used(pathOf(prefix, e.name));
  }
  return total;
}

async function rotateExpiredTelemetry(current: string, previous: string) {
  let from = 0, removedFiles = 0;
  while (true) {
    const q = await supabaseAdmin.from("laps")
      .select("id,telemetry_path,garage61_payload")
      .not("telemetry_path", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (q.error) throw q.error;
    const laps = (q.data ?? []) as Candidate[];
    const expired = laps.filter(lap => !keep(lap, current, previous) && lap.telemetry_path);
    for (let i = 0; i < expired.length; i += 100) {
      const group = expired.slice(i, i + 100);
      const paths = group.map(lap => lap.telemetry_path as string);
      const rm = await supabaseAdmin.storage.from(BUCKET).remove(paths);
      if (rm.error) throw rm.error;
      const db = await supabaseAdmin.from("laps").update({ telemetry_path: null }).in("id", group.map(lap => lap.id));
      if (db.error) throw db.error;
      removedFiles += group.length;
    }
    if (laps.length < PAGE) break;
    // Deletions shift later rows into this page; re-read it before advancing.
    if (expired.length === 0) from += PAGE;
  }
  return { files: removedFiles };
}

async function compact() {
  let files = 0, saved = 0;
  for (const source of await listRaw()) {
    const d = await supabaseAdmin.storage.from(BUCKET).download(source);
    if (d.error || !d.data) continue;
    const raw = Buffer.from(await d.data.arrayBuffer());
    const gz = gzipSync(raw, { level: 9 });
    if (gz.length >= raw.length) continue;
    const target = source + ".gz";
    const up = await supabaseAdmin.storage.from(BUCKET).upload(target, gz, { contentType: "application/gzip" });
    if (up.error) continue;
    const db = await supabaseAdmin.from("laps").update({ telemetry_path: target }).eq("telemetry_path", source);
    if (db.error) {
      await supabaseAdmin.storage.from(BUCKET).remove([target]);
      continue;
    }
    const rm = await supabaseAdmin.storage.from(BUCKET).remove([source]);
    if (!rm.error) {
      files++;
      saved += raw.length - gz.length;
    }
  }
  return { files, saved };
}

// 11/09/2026: "zere esse backlog de telemetrias para só começar a puxar as novas daqui pra frente" --
// every lap that was ALREADY pending at that moment got telemetry_skip=true (see the migration adding
// this column); excluding it here means the backfill only ever chases telemetry for laps that show up
// AFTER that point (a fresh sync insert never sets telemetry_skip, so it defaults to false), instead of
// competing with a multi-thousand-lap historical backlog for the same small per-run batch.
async function pendingTelemetry(current: string, previous: string) {
  const eligible: Candidate[] = [];
  let from = 0;
  while (eligible.length < BATCH) {
    const q = await supabaseAdmin.from("laps")
      .select("id,track_id,garage61_payload")
      .eq("can_view_telemetry", true)
      .eq("telemetry_skip", false)
      .is("telemetry_path", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (q.error) throw q.error;
    const laps = (q.data ?? []) as Candidate[];
    eligible.push(...laps.filter(lap => keep(lap, current, previous)));
    if (laps.length < PAGE) break;
    from += PAGE;
  }
  return eligible.slice(0, BATCH);
}

export async function runTelemetryBackfill() {
  const season = await supabaseAdmin.from("v_season_summary")
    .select("season_name,season_id")
    .order("season_id", { ascending: false })
    .limit(2);
  if (season.error) throw season.error;
  const current = season.data?.[0]?.season_name;
  const previous = season.data?.[1]?.season_name;
  if (!current || !previous) return { status: "no_season_window" };

  const rotation = await rotateExpiredTelemetry(current, previous);
  const compaction = await compact();
  let bytes = await used();
  const ready = await pendingTelemetry(current, previous);
  const token = process.env.GARAGE61_API_TOKEN;
  if (!token) throw new Error("GARAGE61_API_TOKEN não configurado");

  let downloaded = 0;
  for (const lap of ready) {
    const r = await fetch("https://garage61.net/api/v1/laps/" + encodeURIComponent(lap.id) + "/csv", {
      headers: { Authorization: "Bearer " + token, Accept: "text/csv" },
      cache: "no-store",
    });
    if (!r.ok) continue;
    const raw = Buffer.from(await r.arrayBuffer());
    const gz = gzipSync(raw, { level: 9 });
    if (raw.length > MAX_FILE_BYTES || bytes + gz.length > BUDGET) break;
    const target = "laps/" + (lap.track_id ?? "unknown") + "/" + lap.id + ".csv.gz";
    const up = await supabaseAdmin.storage.from(BUCKET).upload(target, gz, { contentType: "application/gzip" });
    if (up.error) continue;
    const db = await supabaseAdmin.from("laps").update({ telemetry_path: target, synced_at: new Date().toISOString() }).eq("id", lap.id);
    if (db.error) throw db.error;
    bytes += gz.length;
    downloaded++;
  }

  return {
    status: "ok",
    retention: { currentSeason: "all sessions", previousSeason: "Race only" },
    currentSeason: current,
    previousSeason: previous,
    downloaded,
    usedBytes: bytes,
    budgetBytes: BUDGET,
    rotation,
    compaction,
  };
}
