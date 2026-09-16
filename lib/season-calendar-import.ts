export type SeasonContextKey = "sf23" | "imsa" | "gt3";

export type ImportedSeasonContext = {
  weekNumber: number;
  contextKey: SeasonContextKey;
  seriesName: string;
  trackName: string;
  trackMatchTerms: string[];
};

export type ImportedSeasonCalendar = {
  seasonId: string;
  seasonName: string;
  seasonStart: string;
  sourceFileName: string;
  sourceSha256: string;
  contexts: ImportedSeasonContext[];
};

type PdfPage = { page: number; text: string };

const LAYOUT_SUFFIX = /\s+-\s+(?:grand prix|full course|road course|international|classic pits|no chicane|grand prix historic|classic boot|boot|national|oval|club|west|east|historic|legacy)$/i;

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normal(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function displayTrackName(value: string) {
  return cleanText(value).replace(LAYOUT_SUFFIX, "").trim();
}

/** Terms are deliberately human-readable. The client normalizes accents before comparing them to
 * Garage61/iRStats track names, and the aliases cover the small set of official-vs-community
 * naming differences already seen in the driver's history. */
export function trackMatchTerms(track: string) {
  const base = displayTrackName(track);
  const normalized = normal(base);
  const aliases: string[] = [];
  if (normalized.includes("jose carlos pace")) aliases.push("Interlagos");
  if (normalized.includes("enzo e dino ferrari")) aliases.push("Imola");
  if (normalized.includes("circuit of the americas")) aliases.push("COTA");
  if (normalized.includes("hermanos rodriguez")) aliases.push("Mexico");
  if (normalized.includes("gilles villeneuve")) aliases.push("Montreal");
  if (normalized.includes("24 heures du mans")) aliases.push("Le Mans");
  if (normalized.includes("shell v-power") || normalized.includes("the bend")) aliases.push("The Bend");
  return [...new Set([base, ...aliases])];
}

function contextsFromPage(page: PdfPage, contextKey: SeasonContextKey, seriesName: string) {
  const contexts: ImportedSeasonContext[] = [];
  const expression = /Week\s+(\d{1,2})\s+\((\d{4}-\d{2}-\d{2})\)\s+(.+?)(?=\s+\(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+\d+x\))/g;
  for (const match of page.text.matchAll(expression)) {
    const weekNumber = Number(match[1]);
    const trackName = displayTrackName(match[3]);
    if (weekNumber >= 1 && weekNumber <= 12 && trackName) {
      contexts.push({ weekNumber, contextKey, seriesName, trackName, trackMatchTerms: trackMatchTerms(trackName) });
    }
  }
  return contexts;
}

function candidateFromSchedule(pages: PdfPage[], startIndex: number, contextKey: SeasonContextKey, seriesName: string) {
  const contexts: ImportedSeasonContext[] = [];
  // Official PDFs paginate a series schedule (usually 3 or 4 weeks per page). Once its heading is
  // found, consume consecutive pages only until all 12 distinct weeks have been found; this avoids
  // mistaking a similarly named fixed or regional schedule later in the document for the target.
  for (let index = startIndex; index < pages.length && contexts.length < 12; index += 1) {
    contexts.push(...contextsFromPage(pages[index], contextKey, seriesName));
  }
  return contexts.length === 12 && new Set(contexts.map((item) => item.weekNumber)).size === 12 ? contexts : null;
}

export function parseOfficialSeasonCalendar(pages: PdfPage[], sourceFileName: string, sourceSha256: string): ImportedSeasonCalendar {
  const allText = pages.map((page) => page.text).join("\n");
  const season = allText.match(/(20\d{2})\s+Season\s+([1-4])/i);
  if (!season) throw new Error("Não encontrei o ano e o número da season no PDF oficial.");

  const year = Number(season[1]);
  const seasonNumber = Number(season[2]);
  // iRacing's sequential season identifiers used by the existing history: 2025 S4 = 31,
  // 2026 S4 = 35. Deriving it keeps views and imported race results on the same key.
  const seasonId = String((year - 2018) * 4 + seasonNumber - 1);
  const targets: Array<{ key: SeasonContextKey; name: string; matcher: RegExp }> = [
    { key: "sf23", name: "Super Formula 23", matcher: /Formula B - Super Formula Series\s+20\d{2}\s+Season\s+[1-4]/i },
    { key: "imsa", name: "IMSA", matcher: /IMSA iRacing Series\s+by\b/i },
    { key: "gt3", name: "GT3 Challenge", matcher: /GT3 Challenge Fixed(?:\s+by\b|\s*-)/i },
  ];

  const contexts = targets.flatMap((target) => {
    for (let index = 0; index < pages.length; index += 1) {
      if (!target.matcher.test(pages[index].text)) continue;
      // The PDF index repeats every series title. A true schedule page always contains Week 1;
      // without this guard an index hit could consume the next unrelated schedule.
      if (!/Week\s+1\s+\(\d{4}-\d{2}-\d{2}\)/.test(pages[index].text)) continue;
      const candidate = candidateFromSchedule(pages, index, target.key, target.name);
      if (candidate) return candidate;
    }
    throw new Error(`Não encontrei as 12 weeks da série oficial ${target.name}. Verifique se o PDF é o calendário oficial completo.`);
  });

  // The selected contexts are the authority here. Read Week 1 from the Super Formula page so an
  // index page or a regional GT3 schedule can never set the season boundary accidentally.
  const sfPage = pages.find((page) => targets[0].matcher.test(page.text) && /Week\s+1\s+\(\d{4}-\d{2}-\d{2}\)/.test(page.text));
  const weekOne = sfPage?.text.match(/Week\s+1\s+\((\d{4}-\d{2}-\d{2})\)/)?.[1];
  if (!weekOne) throw new Error("Não encontrei a data da Week 1 no calendário.");

  return {
    seasonId,
    seasonName: `${year} Season ${seasonNumber}`,
    seasonStart: `${weekOne}T00:00:00.000Z`,
    sourceFileName,
    sourceSha256,
    contexts,
  };
}

export function validateImportedSeasonCalendar(value: unknown): ImportedSeasonCalendar {
  if (!value || typeof value !== "object") throw new Error("Calendário inválido.");
  const input = value as Partial<ImportedSeasonCalendar>;
  if (!/^\d+$/.test(input.seasonId ?? "") || !/^20\d{2} Season [1-4]$/.test(input.seasonName ?? "")) throw new Error("Identidade da season inválida.");
  if (!input.seasonStart || Number.isNaN(Date.parse(input.seasonStart))) throw new Error("Início da season inválido.");
  if (!input.sourceFileName || !/^[a-f0-9]{64}$/i.test(input.sourceSha256 ?? "")) throw new Error("Origem do calendário inválida.");
  if (!Array.isArray(input.contexts) || input.contexts.length !== 36) throw new Error("O calendário precisa conter exatamente 12 weeks para SF23, IMSA e GT3.");

  const contexts = input.contexts.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Contexto de week inválido.");
    const context = item as Partial<ImportedSeasonContext>;
    const weekNumber = context.weekNumber;
    if (typeof weekNumber !== "number" || !Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 12) throw new Error("Week inválida no calendário.");
    if (context.contextKey !== "sf23" && context.contextKey !== "imsa" && context.contextKey !== "gt3") throw new Error("Série inválida no calendário.");
    if (!context.seriesName?.trim() || !context.trackName?.trim() || !Array.isArray(context.trackMatchTerms) || !context.trackMatchTerms.length) throw new Error("Pista ou série ausente no calendário.");
    return {
      weekNumber,
      contextKey: context.contextKey,
      seriesName: cleanText(context.seriesName),
      trackName: cleanText(context.trackName),
      trackMatchTerms: [...new Set(context.trackMatchTerms.map(cleanText).filter(Boolean))].slice(0, 8),
    };
  });
  if (new Set(contexts.map((item) => `${item.weekNumber}:${item.contextKey}`)).size !== 36) throw new Error("Há weeks ou séries duplicadas no calendário.");
  return { seasonId: input.seasonId!, seasonName: input.seasonName!, seasonStart: input.seasonStart!, sourceFileName: input.sourceFileName!, sourceSha256: input.sourceSha256!, contexts };
}
