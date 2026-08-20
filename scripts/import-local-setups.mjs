import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const projectRoot = process.cwd();
const setupRoot = process.env.IRACING_SETUP_ROOT ?? "C:\\Users\\Vitor\\Documents\\iRacing\\setups";
const seasonCode = process.env.IRACING_SEASON_CODE ?? "26S3";

for (const line of (await fs.readFile(path.join(projectRoot, ".env.local"), "utf8")).split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^["']|["']$/g, "");
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const provider = (name) => /HYMO/i.test(name) ? "HYMO" : /P1Doks/i.test(name) ? "P1Doks" : /^TS[ _]/i.test(name) ? "Team Setup" : /fixed/i.test(name) ? "iRacing Fixed" : "Local";
const kind = (name) => /fixed/i.test(name) ? "fixed" : /(?:^|[_ ])Q(?:ual|uali)?(?:[_. ]|$)/i.test(name) ? "qualifying" : /(?:^|[_ ])(?:R|Race)(?:[_. ]|$)/i.test(name) ? "race" : /(?:^|[_ ])E(?:nd|safe|v|[_. ])/i.test(name) ? "endurance" : "open";
const condition = (name) => /wet|chuva/i.test(name) ? "wet" : "dry";
const week = (name) => Number(name.match(/26S3W(\d+)/i)?.[1] ?? name.match(/W(\d{1,2})/i)?.[1] ?? 0) || null;
const trackAliases = ["Watkins Glen", "Road America", "Interlagos", "Motegi", "Hockenheim", "Indianapolis", "Le Mans", "Nurburgring", "Barcelona", "Bathurst", "Daytona", "Suzuka", "Mugello", "Monza", "Fuji", "Spa"];
const inferredTrack = (name) => trackAliases.find((track) => new RegExp(track.replace(" ", " ?"), "i").test(name.replace("WatkinsGlen6h", "Watkins Glen").replace("Watkins6h", "Watkins Glen").replace("RoadAmerica", "Road America"))) ?? "Não identificado";

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}

const all = await walk(setupRoot);
const selected = all.filter((file) => file.toLowerCase().endsWith(".sto") && file.split(path.sep).includes(seasonCode));
const currentCars = new Set(selected.map((file) => path.relative(setupRoot, file).split(path.sep)[0]));
for (const car of currentCars) {
  const active = path.join(setupRoot, car, "-Current-");
  try { if ((await fs.stat(active)).isFile()) selected.push(active); } catch { /* no active setup */ }
}

const cachePath = path.join(projectRoot, "scripts", ".import-cache.json");
let cache = {};
try { cache = JSON.parse(await fs.readFile(cachePath, "utf8")); } catch { /* first run */ }
const nextCache = {};

const manifest = [];
let uploaded = 0;
let skipped = 0;
for (const file of selected) {
  const stat = await fs.stat(file);
  nextCache[file] = stat.mtimeMs;
  const relative = path.relative(setupRoot, file);
  const [carFolder] = relative.split(path.sep);
  const originalName = path.basename(file);
  const filename = originalName === "-Current-" ? `${carFolder}-current.sto` : originalName;
  const storagePath = `local-library/${seasonCode}/${carFolder}/${filename}`.replace(/\\/g, "/");
  const changed = cache[file] !== stat.mtimeMs;
  if (changed) {
    const bytes = await fs.readFile(file);
    const { error } = await supabase.storage.from("private-setups").upload(storagePath, bytes, { contentType: "application/octet-stream", upsert: true });
    if (error) throw new Error(`${relative}: ${error.message}`);
    uploaded += 1;
    if (uploaded % 25 === 0) console.log(`Importados ${uploaded}/${selected.length}`);
  } else {
    skipped += 1;
  }
  manifest.push({ carFolder, filename, relativePath: relative, storagePath, provider: originalName === "-Current-" ? "iRacing — último carregado" : provider(originalName), kind: originalName === "-Current-" ? "current" : kind(originalName), condition: condition(originalName), track: inferredTrack(originalName), week: week(originalName), size: stat.size, modifiedAt: stat.mtime.toISOString() });
}

if (uploaded > 0) {
  const payload = Buffer.from(JSON.stringify({ seasonCode, importedAt: new Date().toISOString(), total: manifest.length, items: manifest }, null, 2));
  const { error: manifestError } = await supabase.storage.from("private-setups").upload(`local-library/${seasonCode}/manifest.json`, payload, { contentType: "application/octet-stream", upsert: true });
  if (manifestError) throw manifestError;
}
await fs.writeFile(cachePath, JSON.stringify(nextCache));
console.log(`Concluído: ${manifest.length} setups na temporada (${uploaded} novos/alterados, ${skipped} sem mudança) de ${currentCars.size} carros.`);
