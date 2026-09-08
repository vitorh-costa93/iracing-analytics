import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { detectCornersFromGps } from "@/lib/corner-detection";

// TEMP DEBUG ROUTE -- investigating why cornerBrakePoints() returns null for every lap. Remove after.
export async function GET(request: NextRequest) {
  const lapId = request.nextUrl.searchParams.get("lapId");
  if (!lapId) return NextResponse.json({ error: "lapId required" }, { status: 400 });
  const { data: lap, error } = await supabaseAdmin.from("laps").select("id,telemetry_path").eq("id", lapId).maybeSingle();
  if (error || !lap || !lap.telemetry_path) return NextResponse.json({ error: "lap not found", error2: error?.message }, { status: 404 });
  const dl = await supabaseAdmin.storage.from("telemetry").download(lap.telemetry_path);
  if (dl.error || !dl.data) return NextResponse.json({ error: "download failed", detail: dl.error?.message }, { status: 500 });
  let raw = Buffer.from(await dl.data.arrayBuffer());
  try { if (lap.telemetry_path.endsWith(".gz")) raw = gunzipSync(raw); } catch (e) { return NextResponse.json({ error: "gunzip failed", detail: String(e) }, { status: 500 }); }
  const csv = raw.toString("utf8");
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const split = (line: string) => line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]).map(norm);
  const pick = (h: string[], names: string[]) => h.findIndex((x) => names.some((n) => x.includes(n)));
  const di = pick(head, ["lapdistpct", "lapdist"]), lai = pick(head, ["lat"]), loi = pick(head, ["lon"]), bi = pick(head, ["brake"]);
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const rows = lines.slice(1).map((line) => { const cols = split(line); return { distance: num(cols[di] ?? "") ?? NaN, lat: num(cols[lai] ?? ""), lon: num(cols[loi] ?? ""), brake: num(cols[bi] ?? "") }; }).filter((r) => Number.isFinite(r.distance));
  const corners = detectCornersFromGps(rows.map((r) => ({ distance: r.distance, lat: r.lat, lon: r.lon })));
  return NextResponse.json({
    lines: lines.length,
    head,
    indices: { di, lai, loi, bi },
    rowCount: rows.length,
    sampleRows: rows.slice(0, 5),
    validLatCount: rows.filter((r) => r.lat !== null).length,
    validLonCount: rows.filter((r) => r.lon !== null).length,
    cornersFound: corners.length,
    corners: corners.slice(0, 5),
  });
}
