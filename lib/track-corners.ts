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
    match: (t) => /spa-francorchamps/i.test(t),
    names: ["La Source", "Eau Rouge / Raidillon", "Les Combes", "Malmedy", "Bruxelles (Rivage)", "Pouhon", "Fagnes (Pif-Paf)", "Campus", "Curva Paul Frère", "Blanchimont", "Bus Stop"],
  },
  {
    match: (t) => /suzuka/i.test(t),
    names: ["Curva 1", "Esses", "Dunlop Curve", "Degner 1", "Degner 2", "Hairpin", "Spoon Curve", "130R", "Casio Triangle (chicane)"],
  },
  {
    match: (t) => /jos[eé] carlos pace|interlagos/i.test(t),
    names: ["Senna S", "Curva do Sol", "Descida do Lago", "Ferradura", "Laranjinha", "Pinheirinho", "Bico de Pato", "Mergulho", "Junção", "Subida dos Boxes", "Arquibancadas"],
  },
  {
    match: (t) => /mugello/i.test(t),
    names: ["San Donato", "Luco", "Poggio Secco", "Materassi", "Borgo San Lorenzo", "Casanova-Savelli", "Arrabbiata 1", "Arrabbiata 2", "Scarperia-Palagio", "Correntaio", "Biondetti 1-2", "Bucine"],
  },
  {
    match: (t) => /hockenheim/i.test(t),
    names: ["Nordkurve", "Spitzkehre", "Ostkurve", "Motodrom (entrada)", "Sachskurve", "Motodrom (saída)"],
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
    match: (t) => /watkins glen/i.test(t),
    names: ["The 90 (T1)", "The Esses", "Bus Stop", "The Boot", "T9", "T10", "T11"],
  },
  {
    match: (t) => /silverstone/i.test(t),
    names: ["Abbey", "Farm Curve", "Village", "The Loop", "Aintree", "Brooklands", "Luffield", "Woodcote", "Copse", "Maggotts", "Becketts", "Chapel", "Stowe", "Vale", "Club"],
  },
  {
    match: (t) => /24 heures du mans|sarthe/i.test(t),
    names: ["Dunlop Curve", "Dunlop Chicane", "Forest Esses", "Tertre Rouge", "Mulsanne Corner", "Indianapolis", "Arnage", "Porsche Curves", "Virage Ford (Chicanes)", "Maison Blanche"],
  },
  {
    match: (t) => /road america/i.test(t),
    names: ["Turn 1", "Turn 3", "Moraine Sweep", "Hurry Downs", "Carousel", "Kink", "Kettle Bottoms", "Canada Corner", "Thunder Valley"],
  },
  {
    match: (t) => /indianapolis/i.test(t),
    names: ["Turn 1", "Turn 2", "Turn 3", "Turn 4", "Turn 5", "Turn 6", "Turn 7", "Turn 8", "Turn 9", "Turn 10", "Turn 11", "Turn 12", "Turn 13", "Turn 14"],
  },
  {
    match: (t) => /enzo e dino ferrari|imola/i.test(t),
    names: ["Tamburello", "Villeneuve", "Tosa", "Piratella", "Acque Minerali", "Variante Alta", "Rivazza", "Bassa (Variante Bassa)"],
  },
  {
    match: (t) => /fuji/i.test(t),
    names: ["Turn 1 (100R)", "Coca-Cola Corner", "Advan Corner", "300R", "Dunlop Corner", "GR Supra Corner (25R)", "Panasonic Corner"],
  },
  {
    match: (t) => /mount panorama/i.test(t),
    names: ["Hell Corner", "Griffins Bend", "The Esses", "Reid Park", "Sulman Park", "McPhillamy Park", "Skyline", "The Dipper", "Forrest's Elbow", "The Chase", "Murray's Corner"],
  },
  {
    match: (t) => /n[uü]rburgring/i.test(t),
    names: ["Yokohama-S", "Valvoline-Kurve", "Ford-Kurve", "Dunlop-Kehre", "Michael-Schumacher-S", "Kumho-Kurve", "Warsteiner-Kurve", "Advan-Bogen", "Veedol-Schikane", "Coca-Cola-Kurve"],
  },
  {
    match: (t) => /donington/i.test(t),
    names: ["Redgate", "Hollywood", "Craner Curves", "Old Hairpin", "Schwantz Curve", "McLean's", "Coppice", "Starkey's Bridge", "Melbourne Hairpin", "Goddards"],
  },
  {
    match: (t) => /barcelona.?catalunya/i.test(t),
    names: ["Elf (chicane)", null, "Renault", "Repsol", "Seat", null, "Wurth", "Campsa", "La Caixa", null, "New Holland (chicane)"],
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
    match: (t) => /oulton park/i.test(t),
    names: ["Old Hall", "Cascades", "Island Bend", "Knickerbrook", "Shell Hairpin", "Hislop's", "Druids", "Lodge Corner", "Deer Leap"],
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
    match: (t) => /algarve|portim[aã]o/i.test(t),
    names: ["Primeira", null, "Lagos", null, null, null, null, "Samsung", null, null, "Portimão", null, null, "Sagres", "Galp"],
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
