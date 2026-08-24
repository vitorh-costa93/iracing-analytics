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
