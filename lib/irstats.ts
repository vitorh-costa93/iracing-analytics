// lib/irstats.ts
import * as cheerio from "cheerio";

export const IRSTATS_BASE_URL = "https://irstats.com";

export type RaceListEntry = { irstatsRaceId: number };

export function parseRaceListPage(html: string): RaceListEntry[] {
  const $ = cheerio.load(html);
  const table = $("table").first();
  if (table.length === 0) {
    throw new Error("irstats race list: no <table> found in page — markup may have changed");
  }

  const entries: RaceListEntry[] = [];
  table.find("tbody tr").each((_, row) => {
    const href = $(row).find('a[href^="/race/"]').attr("href");
    if (!href) return;
    const match = href.match(/^\/race\/(\d+)$/);
    if (!match) return;
    entries.push({ irstatsRaceId: Number(match[1]) });
  });
  return entries;
}

export type RaceResult = {
  irstatsRaceId: number;
  racedAt: string;
  seriesName: string;
  trackName: string;
  carName: string;
  category: "formula_car" | "sports_car";
  seasonWeek: number | null;
  licenseClass: string;
  safetyRating: number;
  iratingDisplay: string;
  iratingDelta: number;
  gridPosition: number | null;
  finishPosition: number;
  positionChange: number | null;
  laps: number | null;
  lapsLed: number | null;
  fastestLapTime: string | null;
  incidents: number | null;
  points: number | null;
  sof: number | null;
};

function raceStat($: cheerio.CheerioAPI, label: string): string {
  const span = $("span.race-stat").filter((_, el) => $(el).find("b").first().text().trim() === label).first();
  if (span.length === 0) throw new Error(`irstats race detail: missing "${label}" race-stat block — markup may have changed`);
  const clone = span.clone();
  clone.find("b").remove();
  return clone.text().trim();
}

function parseCategory(raw: string): "formula_car" | "sports_car" {
  if (raw === "Formula Car") return "formula_car";
  if (raw === "Sports Car") return "sports_car";
  throw new Error(`irstats race detail: unrecognized category "${raw}"`);
}

function parseIntOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(raw: string): string {
  // raw like "Aug 21, 2026 · 20:30 UTC"
  const match = raw.match(/^(\w+ \d{1,2}, \d{4}) · (\d{2}:\d{2}) UTC$/);
  if (!match) throw new Error(`irstats race detail: unrecognized date format "${raw}"`);
  const isoLike = `${match[1]} ${match[2]} UTC`;
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) throw new Error(`irstats race detail: could not parse date "${raw}"`);
  return parsed.toISOString();
}

export function parseRaceDetailPage(html: string, driverName: string): RaceResult {
  const $ = cheerio.load(html);

  const seriesName = $("h1.lb-title").first().text().trim();
  if (!seriesName) throw new Error("irstats race detail: missing series name (h1.lb-title)");

  const subLine = $("p.lb-sub").first().text().replace(/\s+/g, " ").trim();
  const subMatch = subLine.match(/^(.+?)(?:\s*\(([^)]+)\))?\s*(?:·Week (\d+))?$/);
  if (!subMatch) throw new Error(`irstats race detail: unrecognized track/week line "${subLine}"`);
  const trackName = subMatch[1].trim();
  const seasonWeek = subMatch[3] ? Number(subMatch[3]) : null;

  const category = parseCategory(raceStat($, "Category"));
  const racedAt = parseDate(raceStat($, "Date"));
  const sof = parseIntOrNull(raceStat($, "SoF"));

  const table = $("table").first();
  if (table.length === 0) throw new Error("irstats race detail: no results table found");
  const rows = table.find("tbody tr").toArray();

  const rowIndex = rows.findIndex((row) => $(row).find("td").eq(1).text().trim() === driverName);
  if (rowIndex === -1) throw new Error(`irstats race detail: driver "${driverName}" not found in results table`);

  const cells = $(rows[rowIndex]).find("td");
  const licenseCell = cells.eq(2).text().trim(); // "A 3.31"
  const licenseMatch = licenseCell.match(/^(\S+)\s+([\d.]+)$/);
  if (!licenseMatch) throw new Error(`irstats race detail: unrecognized license cell "${licenseCell}"`);

  const iratingCell = cells.eq(3);
  const iratingDeltaText = iratingCell.find("small").first().text().trim();
  const iratingDeltaMatch = iratingDeltaText.match(/^([+-]\d+)$/);
  if (!iratingDeltaMatch) throw new Error(`irstats race detail: unrecognized iRating delta "${iratingDeltaText}"`);
  const iratingClone = iratingCell.clone();
  iratingClone.find("small").remove();
  const iratingDisplay = iratingClone.text().trim();

  const fastestLapText = cells.eq(9).text().trim();

  return {
    irstatsRaceId: 0,
    racedAt,
    seriesName,
    trackName,
    carName: cells.eq(4).text().trim(),
    category,
    seasonWeek,
    licenseClass: licenseMatch[1],
    safetyRating: Number(licenseMatch[2]),
    iratingDisplay,
    iratingDelta: Number(iratingDeltaMatch[1]),
    gridPosition: parseIntOrNull(cells.eq(5).text()),
    finishPosition: rowIndex + 1,
    positionChange: parseIntOrNull(cells.eq(6).text()),
    laps: parseIntOrNull(cells.eq(7).text()),
    lapsLed: parseIntOrNull(cells.eq(8).text()),
    fastestLapTime: fastestLapText === "" ? null : fastestLapText,
    incidents: parseIntOrNull(cells.eq(10).text()),
    points: parseIntOrNull(cells.eq(11).text()),
    sof,
  };
}

export type FetchImpl = (url: string) => Promise<Response>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchIrstatsPage(
  path: string,
  opts: { fetchImpl?: FetchImpl; maxRetries?: number; retryDelayMs?: number } = {}
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 4;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const url = `${IRSTATS_BASE_URL}${path}`;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const response = await fetchImpl(url);
    if (response.ok) return response.text();
    if (response.status === 429 && attempt <= maxRetries) {
      await sleep(retryDelayMs * attempt);
      continue;
    }
    throw new Error(`irstats fetch ${path}: HTTP ${response.status}`);
  }
  throw new Error(`irstats fetch ${path}: exhausted retries`);
}
