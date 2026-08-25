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
  trackConfig: string | null;
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
  const trackConfig = subMatch[2] ? subMatch[2].trim() : null;
  const seasonWeek = subMatch[3] ? Number(subMatch[3]) : null;

  const category = parseCategory(raceStat($, "Category"));
  const racedAt = parseDate(raceStat($, "Date"));
  const sof = parseIntOrNull(raceStat($, "SoF"));

  const table = $("table").first();
  if (table.length === 0) throw new Error("irstats race detail: no results table found");

  // Column positions shift on multiclass races: an extra "Cls" column is inserted right after
  // "Pos", so a fixed index for "Driver" etc. reads the wrong cell entirely (and mis-locates the
  // driver's row, since it's found by comparing the *name* cell's text). Locate every column by
  // its header text instead of a hardcoded position — robust to Cls being present or absent.
  const headerCells = table.find("thead th").toArray().map((th) => $(th).text().trim());
  function columnIndex(label: string): number {
    const index = headerCells.indexOf(label);
    if (index === -1) throw new Error(`irstats race detail: missing "${label}" column in results table header (${headerCells.join(", ")})`);
    return index;
  }
  const driverCol = columnIndex("Driver");
  const licenseCol = columnIndex("License");
  const iratingCol = columnIndex("iR");
  const carCol = columnIndex("Car");
  const gridCol = columnIndex("Grid");
  const changeCol = columnIndex("+/−");
  const lapsCol = columnIndex("Laps");
  const ledCol = columnIndex("Led");
  const fastestCol = columnIndex("Fastest");
  const incCol = columnIndex("Inc");
  const ptsCol = columnIndex("Pts");

  const rows = table.find("tbody tr").toArray();

  const rowIndex = rows.findIndex((row) => $(row).find("td").eq(driverCol).text().trim() === driverName);
  if (rowIndex === -1) throw new Error(`irstats race detail: driver "${driverName}" not found in results table`);

  const cells = $(rows[rowIndex]).find("td");
  const licenseCell = cells.eq(licenseCol).text().trim(); // "A 3.31"
  const licenseMatch = licenseCell.match(/^(\S+)\s+([\d.]+)$/);
  if (!licenseMatch) throw new Error(`irstats race detail: unrecognized license cell "${licenseCell}"`);

  const iratingCell = cells.eq(iratingCol);
  const iratingDeltaTextRaw = iratingCell.find("small").first().text().trim();
  // Accept an optional sign (a zero/unsigned delta may render without one) and both the ASCII
  // hyphen-minus and the Unicode minus sign U+2212 (the table header itself uses "±/−"), then
  // normalize to ASCII before Number(...).
  const iratingDeltaText = iratingDeltaTextRaw.replace(/−/g, "-");
  const iratingDeltaMatch = iratingDeltaText.match(/^([+-]?\d+)$/);
  if (!iratingDeltaMatch) throw new Error(`irstats race detail: unrecognized iRating delta "${iratingDeltaTextRaw}"`);
  const iratingClone = iratingCell.clone();
  iratingClone.find("small").remove();
  const iratingDisplay = iratingClone.text().trim();

  const fastestLapText = cells.eq(fastestCol).text().trim();

  return {
    irstatsRaceId: 0,
    racedAt,
    seriesName,
    trackName,
    trackConfig,
    carName: cells.eq(carCol).text().trim(),
    category,
    seasonWeek,
    licenseClass: licenseMatch[1],
    safetyRating: Number(licenseMatch[2]),
    iratingDisplay,
    iratingDelta: Number(iratingDeltaMatch[1]),
    gridPosition: parseIntOrNull(cells.eq(gridCol).text()),
    finishPosition: rowIndex + 1,
    positionChange: parseIntOrNull(cells.eq(changeCol).text()),
    laps: parseIntOrNull(cells.eq(lapsCol).text()),
    lapsLed: parseIntOrNull(cells.eq(ledCol).text()),
    fastestLapTime: fastestLapText === "" ? null : fastestLapText,
    incidents: parseIntOrNull(cells.eq(incCol).text()),
    points: parseIntOrNull(cells.eq(ptsCol).text()),
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
