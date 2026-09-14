/**
 * Official iRacing season boundaries and the three weekly contexts followed by this driver.
 *
 * Season starts are stored in UTC because iRacing rotates the content at 00:00 UTC on Tuesday,
 * which is exactly Monday 21:00 in America/Sao_Paulo.  Keeping UTC here avoids a client-side
 * daylight-saving conversion or a server-region-dependent calculation.
 */
export type SeasonCalendarEntry = {
  id: string;
  name: string;
  start: string;
};

export type ScheduledContextKind = "sf23" | "imsa" | "gt3";

export type ScheduledWeekContext = {
  kind: ScheduledContextKind;
  series: string;
  track: string;
  trackPattern: RegExp;
};

export const SEASON_CALENDAR: SeasonCalendarEntry[] = [
  { id: "31", name: "2025 Season 4", start: "2025-09-16T00:00:00.000Z" },
  { id: "32", name: "2026 Season 1", start: "2025-12-16T00:00:00.000Z" },
  { id: "33", name: "2026 Season 2", start: "2026-03-17T00:00:00.000Z" },
  { id: "34", name: "2026 Season 3", start: "2026-06-16T00:00:00.000Z" },
  // Source: iRacing 2026 Season 4 schedule, supplied by the driver on 14/09/2026.
  // 15/09 00:00 UTC is 14/09 21:00 America/Sao_Paulo.
  { id: "35", name: "2026 Season 4", start: "2026-09-15T00:00:00.000Z" },
];

const S4_WEEKLY_CONTEXTS: ScheduledWeekContext[][] = [
  [
    { kind: "sf23", series: "Super Formula 23", track: "Autódromo José Carlos Pace", trackPattern: /jos[eé] carlos pace|interlagos/i },
    { kind: "imsa", series: "IMSA", track: "Indianapolis Motor Speedway", trackPattern: /indianapolis/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Silverstone Circuit", trackPattern: /silverstone/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Miami International Autodrome", trackPattern: /miami/i },
    { kind: "imsa", series: "IMSA", track: "Road Atlanta", trackPattern: /road atlanta/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Road Atlanta", trackPattern: /road atlanta/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Red Bull Ring", trackPattern: /red bull ring/i },
    { kind: "imsa", series: "IMSA", track: "Fuji International Speedway", trackPattern: /fuji/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Circuit Zandvoort", trackPattern: /zandvoort/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Sebring International Raceway", trackPattern: /sebring/i },
    { kind: "imsa", series: "IMSA", track: "Red Bull Ring", trackPattern: /red bull ring/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Mobility Resort Motegi", trackPattern: /motegi/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Autodromo Internazionale Enzo e Dino Ferrari", trackPattern: /enzo e dino ferrari|imola/i },
    { kind: "imsa", series: "IMSA", track: "Long Beach Street Circuit", trackPattern: /long beach/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Indianapolis Motor Speedway", trackPattern: /indianapolis/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Circuit de Spa-Francorchamps", trackPattern: /spa/i },
    { kind: "imsa", series: "IMSA", track: "Circuit Gilles Villeneuve", trackPattern: /gilles villeneuve|montreal/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Shell V-Power Motorsport Park at The Bend", trackPattern: /the bend|shell v-power/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Road Atlanta", trackPattern: /road atlanta/i },
    { kind: "imsa", series: "IMSA", track: "Circuit des 24 Heures du Mans", trackPattern: /le mans|24 heures du mans/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Circuit of the Americas", trackPattern: /circuit of the americas|cota/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Hockenheimring Baden-Württemberg", trackPattern: /hockenheim/i },
    { kind: "imsa", series: "IMSA", track: "Autódromo Hermanos Rodríguez", trackPattern: /hermanos rodr[ií]guez|mexico/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Circuit de Spa-Francorchamps", trackPattern: /spa/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Fuji International Speedway", trackPattern: /fuji/i },
    { kind: "imsa", series: "IMSA", track: "Suzuka International Racing Course", trackPattern: /suzuka/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Fuji International Speedway", trackPattern: /fuji/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Watkins Glen International", trackPattern: /watkins glen/i },
    { kind: "imsa", series: "IMSA", track: "Silverstone Circuit", trackPattern: /silverstone/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Misano World Circuit Marco Simoncelli", trackPattern: /misano/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Circuit Gilles Villeneuve", trackPattern: /gilles villeneuve|montreal/i },
    { kind: "imsa", series: "IMSA", track: "Sebring International Raceway", trackPattern: /sebring/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Sebring International Raceway", trackPattern: /sebring/i },
  ],
  [
    { kind: "sf23", series: "Super Formula 23", track: "Suzuka International Racing Course", trackPattern: /suzuka/i },
    { kind: "imsa", series: "IMSA", track: "Autodromo Nazionale Monza", trackPattern: /monza/i },
    { kind: "gt3", series: "GT3 Challenge", track: "Suzuka International Racing Course", trackPattern: /suzuka/i },
  ],
];

export function getActiveSeason(at: Date = new Date()): SeasonCalendarEntry | null {
  const timestamp = at.getTime();
  return [...SEASON_CALENDAR]
    .sort((left, right) => new Date(right.start).getTime() - new Date(left.start).getTime())
    .find((season) => {
      const start = new Date(season.start).getTime();
      return timestamp >= start && timestamp < start + 84 * 86_400_000;
    }) ?? null;
}

export function getSeasonWeek(at: Date, season: SeasonCalendarEntry): number | null {
  const elapsed = at.getTime() - new Date(season.start).getTime();
  if (elapsed < 0 || elapsed >= 84 * 86_400_000) return null;
  return Math.floor(elapsed / (7 * 86_400_000)) + 1;
}

export function getScheduledWeekContexts(seasonId: string, week: number): ScheduledWeekContext[] | null {
  if (seasonId !== "35" || week < 1 || week > S4_WEEKLY_CONTEXTS.length) return null;
  return S4_WEEKLY_CONTEXTS[week - 1];
}
