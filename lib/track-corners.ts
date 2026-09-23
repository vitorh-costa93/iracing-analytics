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
    //
    // 23/09/2026 re-audit: kept 19 slots but fixed everything after Pouhon. On 10 real GT3 laps
    // (Garage61 track 444) the detector found 17-20 corners (19 on 3, 18 on 4). On every lap it
    // found Pouhon as ONE long corner (~54.9%, ~175 km/h), while the old list reserved a null for a
    // second Pouhon apex. That pushed every later name one corner late: "Fagnes" landed on Fagnes'
    // exit, "Campus" on Paul Frère (~73.8%), and "Paul Frère" on the first Blanchimont kink (~79.8%).
    // Moved that null to the fast Blanchimont section, where the detector does find extra apexes
    // (79.8% on some laps, 84.5% and 88.5% on all of them). Order confirmed by minimum speed: La
    // Source ~62 km/h @5.5%, Bruxelles ~88 km/h @43.8%, Bus Stop ~67 km/h @96.3/97.5%.
    match: (t) => /spa-francorchamps/i.test(t),
    names: ["La Source", "Eau Rouge", "Raidillon", null, "Les Combes", null, "Malmedy", "Bruxelles", "Jacky Ickx Curve", "Pouhon", "Fagnes", null, "Campus", "Paul Frère", null, "Blanchimont", null, "Bus Stop", null],
  },
  {
    // 31/08/2026 sweep: was 9 entries (one per NAMED section, several of which -- Esses, Casio
    // Triangle -- are themselves multiple real turns) against this driver's own detector finding 17
    // -- padded to Suzuka's real, documented 18-turn count, named corners placed at their standard
    // turn numbers (T8 Dunlop, T9/T10 Degner 1/2, T11 Hairpin, T13 Spoon, T15 130R, T16 Casio
    // Triangle), nulls for the Esses' individual apexes (T1-T7) and unnamed link turns.
    //
    // 23/09/2026 re-audit: the 18-slot list above still misplaced every name by one or two corners.
    // Re-running detectCornersFromGps on real Suzuka GP laps (SF23, Ferrari 296 GT3, Mustang GT3,
    // 911 GT3 R; Garage61 track 57) found 17 on 3 of 5 laps, the same count as on 31/08, and 18 on
    // the other 2 (one extra sub-apex, at 34.6% or 66%). The 17-corner order has the first corner (T1-T2) as ONE detected corner, four more for
    // the Esses, Dunlop as a single long corner (#6), Degner 1/2 (#7/#8), the right under the bridge
    // (#9), the Hairpin (#10, ~77 km/h, the slowest point on the lap), two more before Spoon (#13),
    // 130R (#14, ~285 km/h) and the Casio Triangle chicane plus the final corner (#15-#17). The old
    // list put "Dunlop Curve" on Degner 2, "Hairpin" on the corner before Spoon, and "130R" on the
    // Casio Triangle. Rebuilt to that 17-corner order.
    match: (t) => /suzuka/i.test(t),
    names: [null, null, null, null, null, "Dunlop Curve", "Degner 1", "Degner 2", null, "Hairpin", null, null, "Spoon Curve", "130R", "Casio Triangle", null, null],
  },
  {
    // 23/09/2026 fix (a real, named corner was being shown under the wrong name): the old 11-entry
    // list matched this driver's own detector count (11 on a real Interlagos GP lap, Garage61 track
    // 67) but not its ORDER -- the detector splits the Senna S into its two real apexes (T1 left @8.4%
    // and T2 right @10.5%, same ~117 km/h minimum), while the old list gave the S only one slot, so
    // every later name slid one corner early: the Senna S exit got "Curva do Sol", Curva do Sol got
    // "Descida do Lago", and the real Descida do Lago (official T4, one wide detected corner spanning
    // T4-T5 @31-38%) got "Ferradura". The old tail also had both "Subida dos Boxes" and
    // "Arquibancadas", but the detector finds only one corner on the flat-out climb (@84.6%, ~250
    // km/h), which is what kept the count at 11 and hid the shift. Rebuilt against the official
    // numbering (T1-2 Senna S, T3 Curva do Sol, T4-5 Descida do Lago, T6-7 Ferradura, T8 Laranjinha,
    // T9 Pinheirinho, T10 Bico de Pato, T11 Mergulho, T12 Junção, then the climb) with a null for
    // the S's second apex; the minimum speeds at each detected corner (Bico de Pato the slowest, ~86
    // km/h @64%; Junção ~138 km/h @75.6%) line up with that order. Cross-checked on two Ferrari 499P
    // laps, which put the corners at the same positions (11 and 12 detected). The 12-corner lap only
    // adds Descida do Lago's second apex (T5 @35.7%). 2 of the 3 laps with usable GPS found 11.
    match: (t) => /jos[eé] carlos pace|interlagos/i.test(t),
    names: ["Senna S", null, "Curva do Sol", "Descida do Lago", "Ferradura", "Laranjinha", "Pinheirinho", "Bico de Pato", "Mergulho", "Junção", "Subida dos Boxes"],
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
    //
    // 23/09/2026 re-audit: the count still holds (5 real McLaren GT3 laps, Garage61 track 171, found
    // 10/11/11/10/12), and so do Nordkurve and Spitzkehre (the hairpin @46%, ~48 km/h, the slowest
    // point on the lap). The name on the last detected corner was wrong, though. The corner right
    // before the pit straight is the Südkurve, not the Sachskurve. The Sachskurve is the slow
    // left-hand hairpin inside the stadium, detected on every lap at ~83.1% (~90 km/h, #9). The
    // last corner (~90.3%, ~115 km/h) is the Südkurve.
    match: (t) => /hockenheim/i.test(t),
    names: ["Nordkurve", null, null, "Spitzkehre", null, null, null, null, "Sachskurve", null, "Südkurve"],
  },
  {
    // 23/09/2026 audit: was 7 entries (one per named complex) against this driver's own detector
    // finding 15 on a real Monza GP lap (SF23, Garage61 track 77). COUNT_TOLERANCE meant these names
    // never matched and Monza always fell back to plain numbering. Detected order, by position and
    // minimum speed: Prima Variante as 3 corners (#1-#3, ~68-95 km/h), Curva Grande (#4, ~257 km/h),
    // Variante della Roggia as 3 (#5-#7, ~115 km/h), Lesmo 1 (#8) with a sub-apex (#9) and Lesmo 2
    // (#10, ~5% of the lap after Lesmo 1), the Serraglio kink (#11, ~262 km/h), Variante Ascari as 3
    // (#12-#14), and Parabolica as one long corner (#15). Sub-apexes of a named complex get null, same
    // as the other tracks here. Medium confidence on #9 vs #10 for Lesmo 2 (both ~180 km/h); placed by
    // the real ~300 m gap between the two Lesmos.
    match: (t) => /monza/i.test(t),
    names: ["Prima Variante", null, null, "Curva Grande", "Variante della Roggia", null, null, "Lesmo 1", null, "Lesmo 2", "Curva del Serraglio", "Variante Ascari", null, null, "Curva Alboreto (Parabolica)"],
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
    //
    // 23/09/2026 re-audit: the detector found 13 corners on every one of 4 real Boot laps (SF23 plus 3
    // Cadillac GTP, Garage61 track 324), always at the same positions. With 11 slots the names were
    // being used, but they landed 1-2 corners early. The fast section between the Esses and the Boot
    // produces three detected corners (~34.6/36.8/41.7%, ~180-200 km/h in the GTP), not one, so
    // "The Toe of the Boot" fell on the Chute and "The Heel" on the Toe. Rebuilt to 13. The Chute is
    // #7 (the last fast corner before the Boot), the Toe is #8 (~51.4%, ~138 km/h, where the Boot
    // starts) and the Heel is #9 (~60.3%). "The Off Camber" is now null: two slow corners (~73.3% and
    // ~79.6%, both ~115 km/h) could each be it, and this data can't tell which.
    match: (t) => /watkins glen/i.test(t),
    names: ["The 90", null, null, null, null, null, "The Chute", "The Toe of the Boot", "The Heel of the Boot", null, null, null, null],
  },
  {
    // 23/09/2026 audit: the count was close (15 names vs 16 detected on real Silverstone GP laps:
    // W13 plus 4 of 5 GT3 laps; the fifth found 15; Garage61 track 80), so these names were being
    // used, but the order broke after Becketts.
    // The detector splits Becketts into its left and right apexes (#11/#12) before Chapel (#13), so
    // every name from "Chapel" on landed one corner early ("Stowe" on Chapel, "Club" on Vale). Added a
    // null for Becketts' second apex. #1-#11 were already right: Abbey ~278 km/h, Village/Loop ~90-98
    // km/h, Copse ~278 km/h, Vale/Club ~107 km/h at #15-#16.
    match: (t) => /silverstone/i.test(t),
    names: ["Abbey", "Farm Curve", "Village", "The Loop", "Aintree", "Brooklands", "Luffield", "Woodcote", "Copse", "Maggotts", "Becketts", null, "Chapel", "Stowe", "Vale", "Club"],
  },
  {
    // 03/09/2026 rebuild ("você tá chamando a Mulsanne de Indianapolis", driver-supplied reference
    // map confirmed the real landmark order): the 31/08 sweep below assumed the Mulsanne Straight
    // "has no real corners at all" -- false. Since 1990 it has two chicanes plus a slight right-hand
    // "Kink" right before Mulsanne Corner (confirmed via web search, en.wikipedia.org/wiki/Mulsanne_
    // Straight), so this driver's own detector correctly finds real corners scattered across it --
    // the old mapping's flat "no corners here" assumption pushed every later name earlier than it
    // should be, landing "Indianapolis" on what's actually Mulsanne Corner itself.
    //
    // Rebuilt by GROUND-TRUTH road identity instead of guessing from corner count/spacing: Le Mans'
    // public-road sections each carry a distinct OSM `ref` (D338 Mulsanne Straight, D140 Route
    // d'Arnage covering Indianapolis+Arnage, D139/D92 the Porsche Curves connector -- see
    // lib/track-boundaries.ts's own top comment), and the permanent circuit portions are `highway=
    // raceway`. Walking this driver's real GPS trace against the regenerated boundary data (see that
    // same 03/09/2026 boundary rebuild) and logging every point where the trace crosses from one
    // `ref`/raceway to the next gives exact real-world section boundaries, independent of how many
    // sub-corners the detector happens to split each section into:
    //   0.0%-16.3% raceway (start/finish, Dunlop Curve, Dunlop Chicane, Forest Esses, Tertre Rouge)
    //   16.3%-57.3% D338   (Mulsanne Straight: two chicanes, the Kink, then Mulsanne Corner at its end)
    //   57.3%-75.0% D140   (Route d'Arnage: Indianapolis then Arnage)
    //   75.0%-84.4% D139   (Porsche Curves connector)
    //   84.4%-100%  raceway (Maison Blanche, the Ford Chicanes, back to start/finish)
    // Named corners placed at the real detected-corner cluster nearest each section's own landmark
    // (e.g. Mulsanne Corner at the single strong braking peak right at the 57.3% D338/D140 boundary,
    // not partway through the straight); sub-apexes of the same named complex get null, same
    // convention as every other track here. Medium confidence on which exact sub-peak is "the Kink"
    // vs. a chicane apex inside D338 (four candidate peaks, not independently verified one by one);
    // high confidence on which named landmark falls in which real road section.
    match: (t) => /24 heures du mans|sarthe/i.test(t),
    names: ["Dunlop Curve", null, "Dunlop Chicane", null, "Forest Esses", null, null, "Tertre Rouge", "L'Arche Chicane", "La Florandière Chicane", null, null, "Mulsanne Kink", null, null, null, "Mulsanne Corner", "Indianapolis", null, null, "Arnage", null, "Porsche Curves", null, "Maison Blanche", null, null, null, null, "Ford Chicane", null, null, null],
  },
  {
    // 31/08/2026 sweep: was 9 entries (two of them just "Turn 1"/"Turn 3" placeholders, not real
    // names) against this driver's own detector finding 12 -- respaced to the circuit's real,
    // documented 14-turn count, anchored on two turn numbers a source stated explicitly (Moraine
    // Sweep = turn 4, Carousel = turns 9-10; Hurry Downs is described as coming just before turn 8).
    //
    // 23/09/2026 re-audit: that respacing still had "Kink" as corner 2, but the Kink is official
    // T11, the flat-out left between the Carousel and Canada Corner (roadamerica.com / NASCAR turn
    // guides: Moraine Sweep T3-T5, Hurry Downs T7-T8, Carousel T9-T10, Kink T11, Kettle Bottoms
    // T11A -- a straight, not a corner -- Canada Corner T12, Thunder Valley T13). Running
    // detectCornersFromGps on real Road America laps (SF23 plus 4 Ferrari 499P laps, Garage61 track
    // 49) found 12 every time, at the same positions: T1, T3, T5,
    // T6, T7, T8, Carousel (#7, one long corner), the Kink (#8, ~278 km/h), Canada Corner (#9, ~146
    // km/h), a Canada exit sub-apex (#10), T13 (#11) and T14 (#12). The old list put "Carousel" on
    // Canada Corner and "Canada Corner" on T13. Rebuilt to that 12-corner order; Kettle Bottoms
    // dropped because it is a straight.
    match: (t) => /road america/i.test(t),
    names: [null, "Moraine Sweep", null, null, "Hurry Downs", null, "Carousel", "Kink", "Canada Corner", null, "Thunder Valley", null],
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
    //
    // 23/09/2026 re-audit: this list had 19 slots, but the detector finds 17 (2 real GT3 laps with
    // full GPS, Garage61 track 53, both 17, at the same positions), so names were used with the
    // wrong offsets: "Tosa" landed on the corner before Tosa and "Piratella" on the corner after it.
    // Rebuilt to the detected 17 using minimum speeds: Tamburello chicane #1-#3 (~122-160 km/h,
    // from 14.1%), Villeneuve #4-#5 (~27-29%), an unnamed #6, Tosa #7 (~84 km/h @34.8%, the slowest
    // corner in the first half), Piratella #8 (~195 km/h @42.6%), Acque Minerali #10-#11 (~58-60%),
    // Variante Alta #12-#13 (~89 km/h @68-69%), Rivazza 1/2 #15/#16 (~98 and ~116 km/h), Variante
    // Bassa #17 (~94%).
    match: (t) => /enzo e dino ferrari|imola/i.test(t),
    names: ["Tamburello", null, null, "Villeneuve", null, null, "Tosa", "Piratella", null, "Acque Minerali", null, "Variante Alta", null, null, "Rivazza 1", "Rivazza 2", "Variante Bassa"],
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
    //
    // 23/09/2026 re-audit: the order above was wrong. It put "The Esses" BEFORE Reid Park, but the
    // Esses come after Skyline, at the top of the descent. On 5 real GT3 laps (Garage61 track 79) the
    // detector found 20 corners on 4 and 21 on 1, always at the same positions: Hell Corner #1 (~107
    // km/h @6%), Griffins Bend #2 (~24%), The Cutting #3 (~90 km/h @32%), then the climb (#4-#6),
    // McPhillamy Park #7 (~218 km/h @48%, the fast blind left), Skyline #8 (@53%), the Esses/Dipper
    // group #9-#14 (~90-100 km/h), Forrest's Elbow #15 (~86 km/h @62.7%), its exit #16, The Chase
    // #17-#19 (~263 km/h @84%, from the end of Conrod), and Murray's Corner #20 (~98 km/h @98%).
    // Rebuilt to that 20-corner order. Reid Park and Sulman Park are placed on the first two climb
    // corners after The Cutting (medium confidence). The Dipper stays null because this data can't
    // tell which Esses apex it is.
    match: (t) => /mount panorama/i.test(t),
    names: ["Hell Corner", "Griffins Bend", "The Cutting", "Reid Park", "Sulman Park", null, "McPhillamy Park", "Skyline", "The Esses", null, null, null, null, null, "Forrest's Elbow", null, "The Chase", null, null, "Murray's Corner"],
  },
  {
    // 31/08/2026 sweep: was 10 entries packed with no gaps against this driver's own detector
    // consistently finding 15 -- the real, documented turn count for the modern (2002+) F1 layout --
    // respaced across all 15 slots with nulls for the unnamed link turns between them, anchored on the
    // two turn numbers a source stated explicitly (Michael-Schumacher-S = turns 9-10, Coca-Cola-Kurve
    // = the final corner, turn 15); same named corners as before, just no longer falsely claiming
    // there are only 10 real turns on this lap.
    //
    // 23/09/2026 re-audit: kept the count but fixed the order. Running detectCornersFromGps on a
    // real Nürburgring GP lap (SF23, Garage61 track 66) found 15: T1-T2 (#1-#2), the Mercedes-Arena
    // pair (#3-#4, ~94 km/h), Valvoline (#5), Ford (#6), Dunlop-Kehre (#7, the hairpin at the bottom
    // of the descent), the Michael-Schumacher-S as #8-#9 (en.wikipedia.org gives it as turns 8 and
    // 9, not 9-10), then #10, #11, Advan-Bogen (#12, ~260 km/h), the chicane as #13-#14 (~98 km/h),
    // and Coca-Cola (#15). The old list put "Valvoline-Kurve" on the arena, "Dunlop-Kehre" was
    // correct only by coincidence, "Michael-Schumacher-S" landed on the S's exit, and it had
    // Veedol-Schikane BEFORE Advan-Bogen (the real order is the reverse).
    match: (t) => /n[uü]rburgring/i.test(t),
    names: ["Yokohama-S", null, null, null, "Valvoline-Kurve", "Ford-Kurve", "Dunlop-Kehre", "Michael-Schumacher-S", null, "Kumho-Kurve", "Warsteiner-Kurve", "Advan-Bogen", "Veedol-Schikane", null, "Coca-Cola-Kurve"],
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
    // 23/09/2026 audit: 13 slots in the wrong real order. "Slotemakerbocht" (official T5) came AFTER
    // Scheivlak (T7), and "Arie Luyendykbocht" (T14, the banked final corner onto the straight) sat at
    // slot 13. The official order (circuitzandvoort.nl / F1 guides) is: T1 Tarzan, T2 Gerlach, T3
    // Hugenholtz, T4 Hunserug, T5 Rob Slotemaker, T6, T7 Scheivlak, T8 Masters, T9, T10, T11-12
    // Hans Ernst chicane, T13 (unnamed since Kumho left), T14 Arie Luyendyk. The detector found 15 on
    // 3 of 5 real GT3 laps (the others found 14 and 16; Garage61 track 409). By minimum speed:
    // Tarzan #1 (~80 km/h @8.8%), Gerlach #2, Hugenholtz as two apexes #3-#4 (~87-106 km/h),
    // Hunserug #5, Slotemaker #6, T6 #7 (~190-210 km/h), Scheivlak #8 (~135 km/h @40%), Masters #9,
    // T9/T10 #10-#11 (~78-83 km/h), the Hans Ernst chicane #12-#13 (~70-84 km/h @73-75%), T13 #14
    // and Arie Luyendyk #15 (~172 km/h @88%). Rebuilt to that 15-corner order.
    match: (t) => /zandvoort/i.test(t),
    names: ["Tarzanbocht", "Gerlachbocht", "Hugenholtzbocht", null, "Hunserug", "Rob Slotemakerbocht", null, "Scheivlak", "Mastersbocht", null, null, "Hans Ernstbocht", null, null, "Arie Luyendykbocht"],
  },
  {
    // 31/08/2026 sweep: was 9 entries packed with no gaps against this driver's own detector
    // consistently finding 16 -- the International layout's real, documented turn count is 17 --
    // respaced across 17 slots with nulls for the unnamed link turns, same named corners/order as
    // before (confirmed: Old Hall opens the lap, Cascades -> Island Bend -> Shell Oils in sequence,
    // Deer Leap is the final corner onto the pit straight).
    //
    // 23/09/2026 re-audit: the list still had Knickerbrook BEFORE Shell Hairpin and Hislop's.
    // The real International order is Old Hall, Dentons, Cascades, Island Bend, Shell Oils Hairpin,
    // Britten's chicane, Hislop's chicane, Knickerbrook, Clay Hill, Druids, Lodge, Deer Leap. The
    // detector found 16 on 2 of 3 real GT3 laps (17 on the third, with an extra kink at 0.3%;
    // Garage61 track 96). By minimum speed: Old Hall #1 (~145 km/h @6.3%), Dentons #2 (~205), Cascades
    // #3 (~145 @18%), Island Bend #4 (~210 @32%), Shell Hairpin #5 (~81-87 km/h @38.7%, the slowest
    // point on the lap), #6, Britten's #7-#9 (~95-110 @47-50%), Hislop's #10-#11 (~90-96 @60-62%),
    // Knickerbrook #12 (~110 @64%), #13 (fast, ~214), Druids #14 (~150 @80%), Lodge #15 (~98 @92%)
    // and Deer Leap #16 (~156 @96.5%). Rebuilt to 16.
    match: (t) => /oulton park/i.test(t),
    names: ["Old Hall", "Dentons", "Cascades", "Island Bend", "Shell Hairpin", null, "Brittens", null, null, "Hislop's", null, "Knickerbrook", null, "Druids", "Lodge Corner", "Deer Leap"],
  },
  {
    // 23/09/2026 audit: the 11-slot list assumed the detector finds the flat T1 kink first. On 4 real
    // GTP laps with usable GPS (Garage61 track 34) it found T1 only once (@0.1%). Counts were 10, 10,
    // 11 and 12, and on every lap the first detected corner was the Andretti Hairpin (~72-80 km/h
    // @13.8%), so "Andretti Hairpin" landed on T3 and "The Corkscrew" on T6. Rebuilt to the 10-corner
    // order: Andretti #1, T3-T6 #2-#5, the Corkscrew as two apexes #6-#7 (~75 km/h @68.4/69.9%),
    // Rainey #8 (~155-170 km/h @75.5%), T10 #9, T11 #10 (~70 km/h @91.5%). Laps that also detect T1
    // or an extra kink will still be off by one; this detector can't avoid that on Laguna.
    match: (t) => /laguna seca/i.test(t),
    names: ["Andretti Hairpin", null, null, null, null, "The Corkscrew", null, "Rainey Curve", null, null],
  },
  {
    match: (t) => /gilles villeneuve/i.test(t),
    names: ["Senna S", null, null, null, "L'Épingle", null, "Pont de la Concorde", null, null, "Champions Corner (Wall of Champions)"],
  },
  {
    // All 13 turns are officially named except T3/T4 — most are named after MotoGP riders and
    // circuit figures (Ángel Nieto himself gives the track its name).
    //
    // 23/09/2026 audit: the only real Jerez GP lap with usable GPS (Huracán GT3, Garage61 track 398)
    // detected 14. It matched these 13 names in order through T11, except that T11 (Crivillé) came out
    // as two apexes of the same speed (~83-87 km/h @77/78.5%). That pushed "Ferrari" onto Crivillé's
    // second apex and "Jorge Lorenzo" onto T12, leaving the real final hairpin (~79 km/h @90.6%)
    // unnamed. Added a null for Crivillé's second apex. Evidence is one lap only.
    match: (t) => /jerez/i.test(t),
    names: ["Expo '92", "Michelin", null, null, "Sito Pons", "Dani Pedrosa", "Carmelo Ezpeleta", "Jorge Martínez 'Aspar'", "Ángel Nieto", "Peluqui", "Álex Crivillé", null, "Ferrari", "Jorge Lorenzo"],
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
  {
    // 23/09/2026: Motegi officially numbers its 14 turns and names only a few landmarks. This
    // driver's detector finds 11 corners on the GP layout (4 of 5 GTP laps; the 5th adds a fast
    // kink at ~88.5% before the final chicane): 6.5%, 20%, 34.8%, 41% (fastest, ~215), 48% and
    // 51%, 57%, 66.7% (slowest, ~72), 84%, 90.6%, 92.3%. Mapped by the documented order T6 130R ->
    // T7/T8 S-Curve -> V-Corner -> Hairpin -> downhill straight -> T11 90° Corner -> Victory Corner
    // (final slow right); T1-T5 and the chicane's first apex stay null. GP layout only.
    match: (t, v) => /motegi/i.test(t) && /grand prix/i.test(v),
    names: [null, null, null, "130R", "S-Curve", null, "V-Corner", "Hairpin", "90° Corner", null, "Victory Corner"],
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
