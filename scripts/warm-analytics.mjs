import fs from "node:fs/promises";
import path from "node:path";

// Explicit, bounded deployment preparation. No new recurring job and no secrets in output.
for (const filename of [".env.local", ".env.production.local"]) {
  try { for (const line of (await fs.readFile(filename, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim().replace(/^["']|["']$/g, "");
  } } catch { /* optional local environment */ }
}
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const base = new URL(arg("--base") || "https://iracing-analytics.vercel.app");
if (!["iracing-analytics.vercel.app", "localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Untrusted warm target");
if (base.username || base.password || (base.hostname === "iracing-analytics.vercel.app" && base.protocol !== "https:")) throw new Error("Unsafe warm target");
const manifest = arg("--manifest") || ".vercel/analytics-warm.json";
const verify = process.argv.includes("--verify");
const limit = Math.min(512, Math.max(1, Number(arg("--limit") || 256)));
const secret = process.env.IMPORT_KEY || process.env.CRON_SECRET;
const force = process.argv.includes("--refresh");
if (force && !secret) throw new Error("Warm secret unavailable");
const queue = [], seen = new Set(), results = []; let capped = false;
const add = value => {
  if (!value) return;
  const url = new URL(value, base);
  if (url.origin !== base.origin || !/^\/api\/(dashboard\/(overview|report)|telemetry\/(active-week|plan|race-debrief|race-field|car-comparison|reference)|garage61\/laps\/[^/]+\/telemetry|setup\/(inventory|library))$/.test(url.pathname)) return;
  url.searchParams.sort();
  const route = url.pathname + url.search;
  if (!seen.has(route) && seen.size >= limit) { capped = true; return; }
  if (!seen.has(route)) { seen.add(route); queue.push(route); }
};
const comparison = (category, season, trackId, week) => {
  const p = new URLSearchParams({ category });
  if (season) p.set("season", season);
  if (trackId) { p.set("trackId", trackId); p.set("compact", "1"); }
  if (week) p.set("week", week);
  return "/api/telemetry/car-comparison?" + p;
};
function discover(route, body) {
  if (verify || !body || body.status !== "ok") return;
  const url = new URL(route, base), params = url.searchParams;
  if (url.pathname.endsWith("car-comparison")) {
    const category = params.get("category"), season = params.get("season");
    if (!params.has("trackId")) {
      for (const item of body.seasons ?? []) add(comparison(category, String(item.seasonId)));
      add(comparison(category, "all"));
      for (const track of body.tracks ?? []) add(comparison(category, season || body.selectedSeasonId || "all", String(track.trackId)));
    } else {
      if (!params.has("week")) for (const item of body.weeks ?? []) add(comparison(category, season, params.get("trackId"), String(item.weekNumber)));
      for (const car of body.cars ?? []) if (car.fastestLap?.id) add(`/api/garage61/laps/${encodeURIComponent(car.fastestLap.id)}/telemetry`);
    }
  }
  if (url.pathname.endsWith("race-debrief")) {
    for (const race of body.races ?? []) add("/api/telemetry/race-debrief?raceId=" + encodeURIComponent(race.id));
    const id = body.debrief?.race?.irstatsRaceId;
    if (id) add("/api/telemetry/race-field?subsessionId=" + id);
    for (const category of ["formula_car", "sports_car"]) for (const weeks of [4, 8, 16, 26]) add(`/api/telemetry/race-field?view=rivals&category=${category}&weeks=${weeks}`);
  }
  if (url.pathname.endsWith("active-week")) for (const item of body.combinations ?? []) {
    add(item.bestLap?.telemetryUrl);
    if (item.car?.id && item.track?.id) add(`/api/telemetry/reference?carId=${item.car.id}&trackId=${item.track.id}`);
  }
}
if (verify) {
  const previous = JSON.parse(await fs.readFile(manifest, "utf8"));
  for (const route of previous.discoveredRoutes ?? previous.results.map(row => row.route)) add(route);
} else {
  for (const route of ["/api/dashboard/overview", "/api/telemetry/active-week", "/api/telemetry/race-debrief", "/api/telemetry/plan", "/api/setup/inventory", "/api/setup/library"]) add(route);
  for (const scope of ["week", "season"]) for (const segment of ["formula", "gt3", "imsa"]) add(`/api/dashboard/report?scope=${scope}&segment=${segment}`);
  for (const category of ["gt3", "gtp"]) add(comparison(category));
}
const started = Date.now(); let bytes = 0;
async function request(route) {
  const start = performance.now();
  try {
    const response = await fetch(new URL(route, base), {
      headers: force ? { "x-analytics-warm": secret } : {}, signal: AbortSignal.timeout(120_000), cache: "no-store",
    });
    const text = await response.text(); bytes += Buffer.byteLength(text);
    const row = { route, ms: Math.round(performance.now() - start), status: response.status, bytes: Buffer.byteLength(text), cdn: response.headers.get("x-vercel-cache"), cache: response.headers.get("x-analytics-cache") };
    results.push(row);
    if (response.headers.get("content-type")?.includes("json")) { try { discover(route, JSON.parse(text)); } catch {} }
    console.log(JSON.stringify(row));
  } catch { results.push({ route, ms: Math.round(performance.now() - start), status: 0 }); console.log(JSON.stringify({ route, status: 0 })); }
}
while (queue.length && bytes < 32 * 1024 * 1024 && Date.now() - started < 20 * 60_000) {
  await Promise.all(queue.splice(0, 2).map(request));
}
const times = results.map(row => row.ms).sort((a, b) => a - b);
const summary = { count: results.length, pending: queue.length, capped, bytes, p95: times[Math.max(0, Math.ceil(times.length * .95) - 1)], max: times.at(-1), over3s: results.filter(row => row.ms > 3000).length, errors: results.filter(row => row.status !== 200).length };
const output = verify ? manifest.replace(/\.json$/, "-verify.json") : manifest;
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), summary, discoveredRoutes: [...seen], results }, null, 2));
console.log(JSON.stringify({ summary, manifest: output }));
if (summary.errors || summary.pending || summary.capped || (verify && summary.over3s)) process.exitCode = 1;
