/**
 * Landmark corner names for the tracks most raced by this driver, researched from official/FIA
 * track guides, F1/manufacturer explainer articles, and circuit history sites. Most real circuits do
 * NOT have a unique name for every single apex — only landmark corners are named, the rest are
 * officially just numbered — so this is intentionally not a name for every turn.
 *
 * Names are matched to detected corners by ORDER (this is the Nth real corner on the lap), not by
 * an estimated track-distance percentage — an earlier version guessed % positions from general track
 * knowledge and got them wrong (e.g. labeling a braking zone as "Curva Grande", which is actually a
 * flat, high-speed corner with no braking at all). Order-matching only fires when the number of
 * corners actually detected from this lap's telemetry is close to the number of named corners on
 * record for the track — if detection finds a very different count (a different real corner count,
 * a messy lap, etc.), we fall back to plain sequential numbering ("Curva N") rather than force a
 * guess. Tracks not listed here always use that plain numbering, which is the honest default, not a
 * bug.
 */

export type TrackCornerEntry = { match: (trackName: string, variant: string) => boolean; names: (string | null)[] };

const COUNT_TOLERANCE = 2;

const ENTRIES: TrackCornerEntry[] = [
  {
    // 31/08/2026 sweep: was 11 entries (several combining what are really 2-3 separate real turns
    // into one, e.g. "Eau Rouge / Raidillon") against this driver's own detector finding 19 (GT3) /
    // 17 (GTP) -- rebuilt against Formula1.com's own official numbered breakdown (19 real turns
    // total, matching GT3 exactly), each complex split into its real sub-turns with a null for the
    // unnamed second/third apex.
    match: (t) => /spa-francorchamps/i.test(t),
    names: ["La Source", "Eau Rouge", "Raidillon", null, "Les Combes", null, "Malmedy", "Bruxelles", "Jacky Ickx Curve", "Pouhon", null, "Fagnes", null, "Campus", "Paul Frère", "Blanchimont", null, "Bus Stop", null],
  },
  {
    // 31/08/2026 sweep: was 9 entries (one per NAMED section, several of which -- Esses, Casio
    // Triangle -- are themselves multiple real turns) against this driver's own detector finding 17
    // -- padded to Suzuka's real, documented 18-turn count, named corners placed at their standard
    // turn numbers (T8 Dunlop, T9/T10 Degner 1/2, T11 Hairpin, T13 Spoon, T15 130R, T16 Casio
    // Triangle), nulls for the Esses' individual apexes (T1-T7) and unnamed link turns.
    match: (t) => /suzuka/i.test(t),
    names: [null, null, null, null, null, null, null, "Dunlop Curve", "Degner 1", "Degner 2", "Hairpin", null, "Spoon Curve", null, "130R", "Casio Triangle", null, null],
  },
  {
    match: (t) => /jos[eé] carlos pace|interlagos/i.test(t),
    names: ["Senna S", "Curva do Sol", "Descida do Lago", "Ferradura", "Laranjinha", "Pinheirinho", "Bico de Pato", "Mergulho", "Junção", "Subida dos Boxes", "Arquibancadas"],
  },
  {
    // 31/08/2026 sweep: was 12 entries (conflating Casanova/Savelli and Biondetti 1/2 into one each)
    // against this driver's own detector consistently finding 15 -- Mugello's real, well-documented
    // turn count -- split into the real 15 separate turns instead.
    match: (t) => /mugello/i.test(t),
    names: ["San Donato", "Luco", "Poggio Secco", "Materassi", "Borgo San Lorenzo", "Casanova", "Savelli", "Arrabbiata 1", "Arrabbiata 2", "Scarperia", "Palagio", "Correntaio", "Biondetti 1", "Biondetti 2", "Bucine"],
  },
  {
    // 31/08/2026: was only 6 entries against this driver's own detector consistently finding 11 real
    // corners on the GP layout (COUNT_TOLERANCE=2 made every comparison here silently fall back to
    // plain numbering -- "é estranho elas não terem nome aqui", confirmed live via the API's own
    // sectorNames output) -- expanded to match, but only Nordkurve (turn 1, right after start/finish)
    // and Spitzkehre (the hairpin after the long Parabolika straight, landing near the lap's own
    // distance midpoint the same way it does here) are confident enough to name; the tightly-packed
    // Motodrom stadium corners (official turns 7-17) collapse into far fewer real detected apexes than
    // their own turn count, so mapping each of THOSE to one specific official turn number/name isn't
    // reliable -- Sachskurve is real and well documented as the corner right before the pit straight,
    // placed on the last detected corner on that basis, the rest stay null rather than guessed.
    match: (t) => /hockenheim/i.test(t),
    names: ["Nordkurve", null, null, "Spitzkehre", null, null, null, null, null, null, "Sachskurve"],
  },
  {
    match: (t) => /monza/i.test(t),
    names: ["Prima Variante", "Curva Grande", "Variante della Roggia", "Lesmo 1", "Lesmo 2", "Variante Ascari", "Curva Alboreto (Parabolica)"],
  },
  {
    match: (t) => /hermanos rodr[ií]guez/i.test(t),
    names: ["Curva 1", "Esses", "Foro Sol (Curva 12-13)", "Peraltada (Curva Mansell)"],
  },
  {
    // 31/08/2026 sweep: was 7 entries (several -- "The Esses", "The Boot", "T9"/"T10"/"T11" -- just
    // placeholders, not real distinguishing names) against this driver's own detector finding 13 on
    // the Boot/full course -- rebuilt against a source's explicit turn-by-turn numbering for that
    // exact configuration (11 real turns: T1 The 90, T2-5 the Esses [unnamed individually], T6 The
    // Chute, T7 The Toe of the Boot, T8 The Heel of the Boot, T9 The Off Camber, T10-11 unnamed back
    // to the front straight). "Bus Stop" dropped -- that's the short/Cup-course chicane, not part of
    // this Boot layout.
    match: (t) => /watkins glen/i.test(t),
    names: ["The 90", null, null, null, null, "The Chute", "The Toe of the Boot", "The Heel of the Boot", "The Off Camber", null, null],
  },
  {
    match: (t) => /silverstone/i.test(t),
    names: ["Abbey", "Farm Curve", "Village", "The Loop", "Aintree", "Brooklands", "Luffield", "Woodcote", "Copse", "Maggotts", "Becketts", "Chapel", "Stowe", "Vale", "Club"],
  },
  {
    // 31/08/2026 sweep: was 10 entries packed with no gaps against this driver's own detector
    // finding 32 -- Le Mans is long and unevenly paced (a dense technical opening, then a mostly-
    // straight ~30% of the lap down Mulsanne with no real corners at all, then a dense technical
    // final third), so unlike every other track fixed in this sweep, this one was respaced using
    // this driver's own actual detected corner POSITIONS (not just the count) to anchor each named
    // corner against the real gaps in the data -- e.g. the empty 31%->43% stretch is the back half of
    // the Mulsanne straight, landing Mulsanne Corner on the dense cluster right after it.
    match: (t) => /24 heures du mans|sarthe/i.test(t),
    names: ["Dunlop Curve", null, "Dunlop Chicane", null, "Forest Esses", null, null, "Tertre Rouge", null, null, null, null, "Mulsanne Corner", null, null, null, "Indianapolis", "Arnage", "Porsche Curves", null, null, null, "Virage Ford", null, null, null, null, "Maison Blanche", null, null, null, null],
  },
  {
    // 31/08/2026 sweep: was 9 entries (two of them just "Turn 1"/"Turn 3" placeholders, not real
    // names) against this driver's own detector finding 12 -- respaced to the circuit's real,
    // documented 14-turn count, anchored on two turn numbers a source stated explicitly (Moraine
    // Sweep = turn 4, Carousel = turns 9-10; Hurry Downs is described as coming just before turn 8).
    match: (t) => /road america/i.test(t),
    names: [null, "Kink", null, "Moraine Sweep", null, null, "Hurry Downs", null, "Carousel", null, "Kettle Bottoms", "Canada Corner", "Thunder Valley", null],
  },
  {
    match: (t) => /indianapolis/i.test(t),
    names: ["Turn 1", "Turn 2", "Turn 3", "Turn 4", "Turn 5", "Turn 6", "Turn 7", "Turn 8", "Turn 9", "Turn 10", "Turn 11", "Turn 12", "Turn 13", "Turn 14"],
  },
  {
    // 31/08/2026 sweep: was 8 entries (named corners only) against this driver's own detector
    // consistently finding 17 -- padded to Imola's real, documented 19-turn count, anchored on the
    // one turn NUMBER a source stated explicitly (Piratella = turn 9); the rest are placed by
    // narrative order (start/finish -> Tamburello chicane -> Villeneuve -> Tosa -> Piratella -> Acque
    // Minerali -> Variante Alta -> Rivazza (two lefts) -> Variante Bassa chicane back to start/finish),
    // with nulls where a chicane's second apex or an unnamed link corner sits.
    match: (t) => /enzo e dino ferrari|imola/i.test(t),
    names: [null, "Tamburello", null, null, "Villeneuve", "Tosa", null, null, "Piratella", "Acque Minerali", null, "Variante Alta", null, null, "Rivazza 1", "Rivazza 2", null, "Variante Bassa", null],
  },
  {
    // 31/08/2026 sweep: was 7 entries against this driver's own detector consistently finding 10 --
    // Fuji's official layout has 16 numbered turns, but an iRacing-specific track guide groups them
    // into exactly 10 real corner COMPLEXES (100R spans turns 4-5, the Dunlop hairpin-plus-flicks
    // spans 9-12, etc.), matching this driver's own detected count precisely -- each complex named
    // as one entry instead of guessing which of its sub-turns the detector isolated as its own apex.
    match: (t) => /fuji/i.test(t),
    names: ["TGR Corner", "75R", "Coca-Cola Corner", "100R", "Advan Hairpin", "120R", "300R", "Dunlop Corner", "Final Chicane", "Panasonic Corner"],
  },
  {
    // 31/08/2026 sweep: was 11 entries packed with no gaps against this driver's own detector
    // consistently finding 20 -- the real, documented corner count is 23 (confirmed: 8 turns climbing
    // the mountain before Sulman Park, 9 more on the technical descent after it) -- respaced with
    // nulls for the unnamed turns in each of those two stretches, same named corners/order as before.
    match: (t) => /mount panorama/i.test(t),
    names: ["Hell Corner", "Griffins Bend", null, null, null, null, null, "The Esses", null, "Reid Park", "Sulman Park", "McPhillamy Park", "Skyline", null, "The Dipper", null, "Forrest's Elbow", null, null, "The Chase", null, "Murray's Corner"],
  },
  {
    // 31/08/2026 sweep: was 10 entries packed with no gaps against this driver's own detector
    // consistently finding 15 -- the real, documented turn count for the modern (2002+) F1 layout --
    // respaced across all 15 slots with nulls for the unnamed link turns between them, anchored on the
    // two turn numbers a source stated explicitly (Michael-Schumacher-S = turns 9-10, Coca-Cola-Kurve
    // = the final corner, turn 15); same named corners as before, just no longer falsely claiming
    // there are only 10 real turns on this lap.
    match: (t) => /n[uü]rburgring/i.test(t),
    names: ["Yokohama-S", null, "Valvoline-Kurve", null, "Ford-Kurve", null, "Dunlop-Kehre", null, "Michael-Schumacher-S", null, "Kumho-Kurve", "Warsteiner-Kurve", "Veedol-Schikane", "Advan-Bogen", "Coca-Cola-Kurve"],
  },
  {
    match: (t) => /donington/i.test(t),
    names: ["Redgate", "Hollywood", "Craner Curves", "Old Hairpin", "Schwantz Curve", "McLean's", "Coppice", "Starkey's Bridge", "Melbourne Hairpin", "Goddards"],
  },
  {
    // 31/08/2026 sweep: was 11 entries against this driver's own detector finding 15 -- respaced to
    // the circuit's real, documented 16-turn (2007-2020 F1) layout, re-anchored on two turn numbers a
    // source stated explicitly that CONTRADICTED this entry's old order (Repsol = turn 3, not turn 4;
    // Campsa = turn 9, La Caixa = turn 10) -- "Renault" dropped rather than guess a now-uncertain
    // position for it against those two confirmed anchors.
    match: (t) => /barcelona.?catalunya/i.test(t),
    names: ["Elf", null, "Repsol", null, "Seat", null, "Wurth", null, "Campsa", "La Caixa", null, null, null, null, "New Holland", null],
  },
  {
    match: (t) => /hungaroring/i.test(t),
    names: ["Piquet", "Hamilton", "Spring", "Mansell", "Mogyoród", "Driving Centre", "Buda", "Pest", "Danube", "Alesi", "Schumacher", "Senna", "Szisz"],
  },
  {
    match: (t) => /red bull ring/i.test(t),
    names: ["Niki Lauda Kurve", "Remus", "Schlossgold", "Rauch", null, null, null, "Jochen Rindt Kurve", null, null],
  },
  {
    match: (t) => /zandvoort/i.test(t),
    names: ["Tarzanbocht", "Gerlachbocht", "Hugenholtzbocht", null, null, "Scheivlak", null, "Slotemakerbocht", null, null, null, null, "Arie Luyendykbocht"],
  },
  {
    // 31/08/2026 sweep: was 9 entries packed with no gaps against this driver's own detector
    // consistently finding 16 -- the International layout's real, documented turn count is 17 --
    // respaced across 17 slots with nulls for the unnamed link turns, same named corners/order as
    // before (confirmed: Old Hall opens the lap, Cascades -> Island Bend -> Shell Oils in sequence,
    // Deer Leap is the final corner onto the pit straight).
    match: (t) => /oulton park/i.test(t),
    names: ["Old Hall", null, "Cascades", null, "Island Bend", null, "Knickerbrook", null, "Shell Hairpin", null, "Hislop's", null, "Druids", null, "Lodge Corner", null, "Deer Leap"],
  },
  {
    match: (t) => /laguna seca/i.test(t),
    names: [null, "Andretti Hairpin", null, null, null, null, null, "The Corkscrew", "Rainey Curve", null, null],
  },
  {
    match: (t) => /gilles villeneuve/i.test(t),
    names: ["Senna S", null, null, null, "L'Épingle", null, "Pont de la Concorde", null, null, "Champions Corner (Wall of Champions)"],
  },
  {
    // All 13 turns are officially named except T3/T4 — most are named after MotoGP riders and
    // circuit figures (Ángel Nieto himself gives the track its name).
    match: (t) => /jerez/i.test(t),
    names: ["Expo '92", "Michelin", null, null, "Sito Pons", "Dani Pedrosa", "Carmelo Ezpeleta", "Jorge Martínez 'Aspar'", "Ángel Nieto", "Peluqui", "Álex Crivillé", "Ferrari", "Jorge Lorenzo"],
  },
  {
    // Superseded the earlier web-guide cross-check with OpenStreetMap's own `ref` tags on each named
    // raceway way (29/08/2026) -- literal corner-marker numbering, not paraphrased blog prose, and it
    // disagreed with 3 of the earlier positions: Lagos is T4 (not T3), Torre Vip is T6 (not T5), and
    // Samsung/Craig Jones/Portimão are T9/T10/T11 (each one later than previously listed). Sagres (T14)
    // and Galp (T15) were already correct in both sources.
    match: (t) => /algarve|portim[aã]o/i.test(t),
    names: ["Primeira", null, null, "Lagos", null, "Torre Vip", null, null, "Samsung", "Craig Jones", "Portimão", null, null, "Sagres", "Galp"],
  },
  {
    match: (t) => /sebring/i.test(t),
    names: [null, "Kristensen", null, null, null, null, "Hairpin", null, null, null, null, null, null, null, "Gendebien Bend", null, "Sunset Bend"],
  },
  {
    match: (t) => /magny-cours/i.test(t),
    names: ["Grande Courbe", "Estoril", null, "Adelaide", null, "Nürburgring (chicane)", "180°", null, "Imola (chicane)", null, "Château d'Eau", "Complexe du Lycée (chicane)"],
  },
];

/** Given a track name/variant and how many corners were actually detected from this lap's telemetry,
 * returns the ordered name list to zip against those corners (index 0 = first corner on the lap, null
 * = a real corner we know is there but don't have a confident name for), or null if there's no
 * research for this track or the detected count is too far from the known corner count to trust an
 * index match. */
export function lookupCornerNames(trackName: string, variant: string, detectedCount: number): (string | null)[] | null {
  const entry = ENTRIES.find((item) => item.match(trackName, variant));
  if (!entry) return null;
  if (Math.abs(entry.names.length - detectedCount) > COUNT_TOLERANCE) return null;
  return entry.names;
}
