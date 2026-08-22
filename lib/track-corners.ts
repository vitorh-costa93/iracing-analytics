/**
 * Landmark corner names for the tracks most raced by this driver, researched from official/FIA
 * track guides, F1/manufacturer explainer articles, and circuit history sites (see PROJECT_CONTEXT
 * notes / commit for source list). Most real circuits do NOT have a unique name for every single
 * apex — only landmark corners are named, the rest are officially just numbered — so this is
 * intentionally NOT a name for every turn. Position (`pct`) is the approximate % of lap distance
 * from the start/finish line, estimated from official track maps; it's not meter-exact, so lookup
 * uses a tolerance window and only labels a detected corner when it's the closest match within that
 * window. Coverage: the ~15 tracks with the most sessions for this driver. Tracks not listed here
 * simply keep the generic "Curva N" numbering, which is the honest fallback, not a bug.
 */

export type TrackLandmark = { name: string; pct: number };
export type TrackCornerEntry = { match: (trackName: string, variant: string) => boolean; landmarks: TrackLandmark[] };

const TOLERANCE_PCT = 6;

const ENTRIES: TrackCornerEntry[] = [
  {
    match: (t) => /spa-francorchamps/i.test(t),
    landmarks: [
      { name: "La Source", pct: 2 }, { name: "Eau Rouge", pct: 8 }, { name: "Raidillon", pct: 10 },
      { name: "Les Combes", pct: 18 }, { name: "Malmedy", pct: 24 }, { name: "Bruxelles (Rivage)", pct: 29 },
      { name: "Pouhon", pct: 41 }, { name: "Fagnes (Pif-Paf)", pct: 53 }, { name: "Campus", pct: 59 },
      { name: "Curva Paul Frère", pct: 63 }, { name: "Blanchimont", pct: 86 }, { name: "Bus Stop", pct: 94 },
    ],
  },
  {
    match: (t) => /suzuka/i.test(t),
    landmarks: [
      { name: "Curva 1", pct: 3 }, { name: "Esses", pct: 12 }, { name: "Dunlop Curve", pct: 22 },
      { name: "Degner 1", pct: 28 }, { name: "Degner 2", pct: 31 }, { name: "Hairpin", pct: 40 },
      { name: "Spoon Curve", pct: 58 }, { name: "130R", pct: 78 }, { name: "Casio Triangle (chicane)", pct: 90 },
    ],
  },
  {
    match: (t) => /jos[eé] carlos pace|interlagos/i.test(t),
    landmarks: [
      { name: "Senna S", pct: 3 }, { name: "Curva do Sol", pct: 10 }, { name: "Descida do Lago", pct: 16 },
      { name: "Ferradura", pct: 26 }, { name: "Laranjinha", pct: 34 }, { name: "Pinheirinho", pct: 40 },
      { name: "Bico de Pato", pct: 47 }, { name: "Mergulho", pct: 54 }, { name: "Junção", pct: 62 },
      { name: "Subida dos Boxes", pct: 78 }, { name: "Arquibancadas", pct: 90 },
    ],
  },
  {
    match: (t) => /mugello/i.test(t),
    landmarks: [
      { name: "San Donato", pct: 3 }, { name: "Luco", pct: 12 }, { name: "Poggio Secco", pct: 16 },
      { name: "Materassi", pct: 22 }, { name: "Borgo San Lorenzo", pct: 26 }, { name: "Casanova-Savelli", pct: 34 },
      { name: "Arrabbiata 1", pct: 46 }, { name: "Arrabbiata 2", pct: 51 }, { name: "Scarperia-Palagio", pct: 63 },
      { name: "Correntaio", pct: 74 }, { name: "Biondetti 1-2", pct: 84 }, { name: "Bucine", pct: 93 },
    ],
  },
  {
    match: (t) => /hockenheim/i.test(t),
    landmarks: [
      { name: "Nordkurve", pct: 4 }, { name: "Spitzkehre", pct: 20 }, { name: "Ostkurve", pct: 30 },
      { name: "Motodrom (entrada)", pct: 68 }, { name: "Sachskurve", pct: 82 }, { name: "Motodrom (saída)", pct: 92 },
    ],
  },
  {
    match: (t) => /monza/i.test(t),
    landmarks: [
      { name: "Prima Variante", pct: 3 }, { name: "Curva Grande", pct: 14 }, { name: "Variante della Roggia", pct: 26 },
      { name: "Lesmo 1", pct: 36 }, { name: "Lesmo 2", pct: 41 }, { name: "Variante Ascari", pct: 65 },
      { name: "Curva Alboreto (Parabolica)", pct: 90 },
    ],
  },
  {
    match: (t) => /hermanos rodr[ií]guez/i.test(t),
    landmarks: [
      { name: "Curva 1", pct: 4 }, { name: "Esses", pct: 14 }, { name: "Foro Sol (Curva 12-13)", pct: 82 },
      { name: "Peraltada (Curva Mansell)", pct: 95 },
    ],
  },
  {
    match: (t) => /watkins glen/i.test(t),
    landmarks: [
      { name: "The 90 (T1)", pct: 5 }, { name: "The Esses", pct: 16 }, { name: "Bus Stop", pct: 36 },
      { name: "The Boot", pct: 55 }, { name: "T9", pct: 78 }, { name: "T10", pct: 86 }, { name: "T11", pct: 96 },
    ],
  },
  {
    match: (t) => /silverstone/i.test(t),
    landmarks: [
      { name: "Abbey", pct: 3 }, { name: "Farm Curve", pct: 8 }, { name: "Village", pct: 12 },
      { name: "The Loop", pct: 16 }, { name: "Aintree", pct: 20 }, { name: "Wellington Straight", pct: 27 },
      { name: "Brooklands", pct: 34 }, { name: "Luffield", pct: 39 }, { name: "Woodcote", pct: 46 },
      { name: "Copse", pct: 56 }, { name: "Maggotts", pct: 61 }, { name: "Becketts", pct: 64 },
      { name: "Chapel", pct: 68 }, { name: "Hangar Straight", pct: 74 }, { name: "Stowe", pct: 82 },
      { name: "Vale", pct: 90 }, { name: "Club", pct: 95 },
    ],
  },
  {
    match: (t) => /24 heures du mans|sarthe/i.test(t),
    landmarks: [
      { name: "Dunlop Curve", pct: 3 }, { name: "Dunlop Chicane", pct: 6 }, { name: "Forest Esses", pct: 11 },
      { name: "Tertre Rouge", pct: 15 }, { name: "Mulsanne Straight", pct: 25 }, { name: "Mulsanne Corner", pct: 45 },
      { name: "Indianapolis", pct: 58 }, { name: "Arnage", pct: 65 }, { name: "Porsche Curves", pct: 78 },
      { name: "Virage Ford (Chicanes)", pct: 88 }, { name: "Maison Blanche", pct: 93 },
    ],
  },
  {
    match: (t) => /road america/i.test(t),
    landmarks: [
      { name: "Turn 1", pct: 6 }, { name: "Turn 3", pct: 14 }, { name: "Moraine Sweep", pct: 22 },
      { name: "Hurry Downs", pct: 34 }, { name: "Carousel", pct: 52 }, { name: "Kink", pct: 68 },
      { name: "Kettle Bottoms", pct: 74 }, { name: "Canada Corner", pct: 82 }, { name: "Thunder Valley", pct: 90 },
    ],
  },
  {
    match: (t) => /enzo e dino ferrari|imola/i.test(t),
    landmarks: [
      { name: "Tamburello", pct: 5 }, { name: "Villeneuve", pct: 13 }, { name: "Tosa", pct: 20 },
      { name: "Piratella", pct: 34 }, { name: "Acque Minerali", pct: 42 }, { name: "Variante Alta", pct: 60 },
      { name: "Rivazza", pct: 68 }, { name: "Bassa (Variante Bassa)", pct: 90 },
    ],
  },
  {
    match: (t) => /fuji/i.test(t),
    landmarks: [
      { name: "Turn 1 (100R)", pct: 8 }, { name: "Coca-Cola Corner", pct: 20 }, { name: "Advan Corner", pct: 34 },
      { name: "300R", pct: 50 }, { name: "Dunlop Corner", pct: 66 }, { name: "GR Supra Corner (25R)", pct: 78 },
      { name: "Panasonic Corner", pct: 92 },
    ],
  },
  {
    match: (t) => /mount panorama/i.test(t),
    landmarks: [
      { name: "Hell Corner", pct: 3 }, { name: "Griffins Bend", pct: 8 }, { name: "The Esses", pct: 16 },
      { name: "Reid Park", pct: 26 }, { name: "Sulman Park", pct: 32 }, { name: "McPhillamy Park", pct: 40 },
      { name: "Skyline", pct: 46 }, { name: "The Dipper", pct: 52 }, { name: "Forrest's Elbow", pct: 58 },
      { name: "Conrod Straight", pct: 70 }, { name: "The Chase", pct: 86 }, { name: "Murray's Corner", pct: 95 },
    ],
  },
  {
    match: (t) => /n[uü]rburgring grand-prix-strecke|n[uü]rburgring/i.test(t),
    landmarks: [
      { name: "Yokohama-S", pct: 5 }, { name: "Valvoline-Kurve", pct: 14 }, { name: "Ford-Kurve", pct: 20 },
      { name: "Dunlop-Kehre", pct: 30 }, { name: "Michael-Schumacher-S", pct: 44 }, { name: "Kumho-Kurve", pct: 52 },
      { name: "Warsteiner-Kurve", pct: 62 }, { name: "Advan-Bogen", pct: 72 }, { name: "Veedol-Schikane", pct: 84 },
      { name: "Coca-Cola-Kurve", pct: 92 },
    ],
  },
  {
    match: (t) => /donington/i.test(t),
    landmarks: [
      { name: "Redgate", pct: 4 }, { name: "Hollywood", pct: 12 }, { name: "Craner Curves", pct: 20 },
      { name: "Old Hairpin", pct: 32 }, { name: "Schwantz Curve", pct: 42 }, { name: "McLean's", pct: 50 },
      { name: "Coppice", pct: 62 }, { name: "Starkey's Bridge", pct: 74 }, { name: "Melbourne Hairpin", pct: 84 },
      { name: "Goddards", pct: 94 },
    ],
  },
];

/** Given a track name/variant and a corner's approximate lap-distance %, returns the closest
 * landmark name if one exists within tolerance for that track, otherwise null (caller should fall
 * back to the generic "Curva N"). */
export function lookupCornerName(trackName: string, variant: string, distancePct: number): string | null {
  const entry = ENTRIES.find((item) => item.match(trackName, variant));
  if (!entry) return null;
  let best: { name: string; diff: number } | null = null;
  for (const landmark of entry.landmarks) {
    const diff = Math.min(Math.abs(landmark.pct - distancePct), Math.abs(landmark.pct - distancePct + 100), Math.abs(landmark.pct - distancePct - 100));
    if (diff <= TOLERANCE_PCT && (!best || diff < best.diff)) best = { name: landmark.name, diff };
  }
  return best?.name ?? null;
}
