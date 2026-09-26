/**
 * GERADOR dos traçados canônicos de curvas (lib/track-corner-layouts.json). Não roda no `npm test`.
 *
 *   BUILD_CORNER_LAYOUTS=1 npx vitest run lib/track-corner-layouts.build.test.ts
 *
 * Lê os .ibt do iRacing em BUILD_CORNER_DIRS (pastas separadas por ";", padrão: telemetria e setups de
 * Documents/iRacing), pega a melhor volta completa de cada arquivo, detecta as curvas e, por pista,
 * guarda o traçado que MAIS se repete entre as voltas (pickCanonicalLayout). Para incluir mais pistas,
 * é só colocar mais .ibt nessas pastas e rodar de novo. Nenhum dado pessoal vai para o JSON: só
 * posições de curvas em % da volta e o nome da pista.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { ibtToBestLapCsv, parseTelemetryCsv } from "./telemetry-trace";
import { detectCornersFromLap } from "./lap-corners";
import { verifiedCornerNameCount } from "./track-corners";
import { pickCanonicalLayout, trackLayoutKey, type CornerLayout, type LayoutCorner } from "./track-corner-layouts";

const enabled = process.env.BUILD_CORNER_LAYOUTS === "1";
const HOME = "C:/Users/Vitor/Documents/iRacing";
const DIRS = (process.env.BUILD_CORNER_DIRS ?? `${HOME}/telemetry;${HOME}/setups`).split(";");

/** Nomes do iRacing (SessionInfo) que diferem dos nomes da tabela `tracks` do app (Garage61). */
const ALIASES: Record<string, { name: string; variant: string }> = {
  [trackLayoutKey("Silverstone Circuit", "Arena Grand Prix")]: { name: "Silverstone Circuit", variant: "Grand Prix" },
  [trackLayoutKey("Watkins Glen", "Boot")]: { name: "Watkins Glen International", variant: "Boot" },
  [trackLayoutKey("Circuit des 24 Heures du Mans", "")]: { name: "Circuit des 24 Heures du Mans", variant: "24 Heures du Mans" },
  [trackLayoutKey("Autódromo Internacional do Algarve", "Grand Prix")]: { name: "Algarve International Circuit", variant: "Grand Prix" },
};

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (name.toLowerCase().endsWith(".ibt") && stat.size > 2e6) out.push(path);
  }
  return out;
}

/** WeekendInfo do SessionInfo (YAML no meio do .ibt): nome de exibição e traçado da pista. */
function trackOf(buffer: Buffer) {
  const length = buffer.readInt32LE(16);
  const offset = buffer.readInt32LE(20);
  const yaml = buffer.subarray(offset, offset + length).toString("latin1");
  const pick = (key: string) => yaml.match(new RegExp("^ *" + key + ": *(.+)$", "m"))?.[1]?.trim() ?? "";
  return { name: pick("TrackDisplayName"), variant: pick("TrackConfigName") };
}

describe.skipIf(!enabled)("gera lib/track-corner-layouts.json", () => {
  it("agrupa por pista e escolhe o traçado que mais aparece", () => {
    const byTrack = new Map<string, { trackName: string; variant: string; lists: LayoutCorner[][] }>();
    let lidos = 0; let semVolta = 0; let semNome = 0; let primeiroErro = "";
    const arquivos = DIRS.flatMap((dir) => walk(dir));
    for (const file of arquivos) {
      try {
        const buffer = readFileSync(file);
        const track = trackOf(buffer);
        if (!track.name) { semNome += 1; continue; }
        const alias = ALIASES[trackLayoutKey(track.name, track.variant)];
        const trackName = alias?.name ?? track.name; const variant = alias?.variant ?? track.variant;
        const key = trackLayoutKey(trackName, variant);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        const trace = parseTelemetryCsv((ibtToBestLapCsv(arrayBuffer) as unknown as { csv: string }).csv);
        const corners = detectCornersFromLap(trace.points, { splitLong: verifiedCornerNameCount(trackName, variant) === null });
        const entry = byTrack.get(key) ?? { trackName, variant, lists: [] };
        entry.lists.push(corners);
        byTrack.set(key, entry);
        lidos += 1;
      } catch (error) { semVolta += 1; primeiroErro ||= String(error); }
    }
    const result: Record<string, CornerLayout> = {};
    const linhas: string[] = [];
    for (const [key, entry] of [...byTrack.entries()].sort()) {
      const expected = verifiedCornerNameCount(entry.trackName, entry.variant);
      // Pista com nomes verificados: só valem as voltas com EXATAMENTE a contagem que os nomes esperam.
      const lists = expected === null ? entry.lists : entry.lists.filter((list) => list.length === expected);
      const picked = pickCanonicalLayout(lists);
      const votos = JSON.stringify(Object.fromEntries(Object.entries(entry.lists.reduce<Record<string, number>>((acc, list) => { acc[String(list.length)] = (acc[String(list.length)] ?? 0) + 1; return acc; }, {}))));
      if (!picked) { linhas.push(`- ${entry.trackName} (${entry.variant}): nenhuma volta com as ${expected} curvas dos nomes verificados, mantém a detecção por volta | votos ${votos}`); continue; }
      if (lists.length < 2) { linhas.push(`- ${entry.trackName} (${entry.variant}): só ${lists.length} volta compatível, mantém a detecção por volta | votos ${votos}`); continue; }
      if (picked.corners.length < 6) { linhas.push(`- ${entry.trackName} (${entry.variant}): ${picked.corners.length} curvas é pouco, mantém a detecção por volta | votos ${votos}`); continue; }
      result[key] = { trackName: entry.trackName, variant: entry.variant, laps: lists.length, votes: picked.votes, corners: picked.corners };
      linhas.push(`OK ${entry.trackName} (${entry.variant}): ${picked.corners.length} curvas | ${lists.length} voltas | votos ${votos}${expected !== null ? " | nomes verificados" : ""}`);
    }
    writeFileSync("C:/Users/Vitor/Documents/iracing-analytics/lib/track-corner-layouts.json", JSON.stringify(result, null, 1) + "\n");
    writeFileSync("C:/Users/Vitor/Documents/iracing-analytics/.zz-out.txt", `arquivos lidos: ${lidos}, sem volta completa: ${semVolta}\n` + linhas.join("\n"));
  }, 1_800_000);
});
