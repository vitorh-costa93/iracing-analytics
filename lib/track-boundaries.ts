/**
 * Real track-edge geometry, sourced from OpenStreetMap's `highway=raceway` ways (ODbL-licensed,
 * https://www.openstreetmap.org/copyright) via a one-time Overpass API query per track, 29/08/2026.
 * This is what makes the track map's asphalt ribbon an actual track boundary instead of a synthetic
 * tube drawn around whichever GPS trace happened to be compared -- see TrackMap's own comment for why
 * that synthetic ribbon could never show real track position ("aparenta estar tudo no meio da pista"
 * was a structural consequence of it, not a rendering bug). Covers every track in this driver's
 * library, including Mount Panorama (Bathurst) -- a public road circuit closed for racing only race
 * week, so unlike every other track here its roads are tagged as ordinary streets in OSM, not
 * `highway=raceway` (31/08/2026: queried by the circuit's known corner/straight names --
 * "Mountain Straight", "Griffins Bend", "The Cutting", "Reid Park", "Sulman Park", "McPhillamy Park",
 * "Brocks Skyline", "Forrest's Elbow", "The Chase", "Conrod Straight", "Murrays Corner", "Pit
 * Straight", "Hell Corner" -- rather than the `highway=raceway` tag filter used everywhere else; all
 * 16 matched ways share the same `alt_name` "Mount Panorama Scenic Road", confirming they're the one
 * real circuit and not some other road. None of them carry a `width` tag the way purpose-built
 * `highway=raceway` ways usually do, so this track's ribbon uses a flat estimated 10m width instead
 * of a per-segment OSM value). Le Mans (Circuit de la Sarthe, trackId 95) is the same situation in
 * miniature (02/09/2026: "o Circuito de Le Mans está com problema... aparecendo só um fragmento" --
 * the original `highway=raceway`-only query only ever covered the permanent ~2km Bugatti circuit
 * portion near the pits, missing the ~11km of public road -- the Ligne droite des Hunaudières
 * (Mulsanne Straight, D338/formerly RN138), Route d'Arnage (D140, past Indianapolis and Arnage), and
 * the Porsche Curves connector (D139/D92) -- that make up most of the real 24 Heures lap. Regenerated
 * by querying those exact `ref`s plus `highway=raceway` in the circuit's bounding box, then keeping
 * only the ways whose geometry actually sits close to this driver's own real GPS lap trace -- the same
 * corridor-filter idea as the largest-connected-component step below, just using ground-truth
 * telemetry instead of proximity between OSM ways. Confirmed the result's own lat/lon extent
 * (~5.4km x 2.7km) now matches the real trace's extent, not the old ~2.1km x 0.5km fragment.
 *
 * 03/09/2026 revision ("em vários pontos da análise da volta em Le Mans... os traçados fora da linha
 * de corrida"): the corridor-filter's first version kept EVERY way within a flat 70m of the trace, a
 * threshold wide enough to cover the public road's two separated carriageways at the widest points --
 * but that meant BOTH carriageways got kept everywhere else too, including stretches where they sit
 * only 20-40m apart. A per-corner map, zoomed into a window a few hundred meters wide, then had no way
 * to tell "the real racing line" from "the other, unused carriageway 30m away", and drew both as if
 * they were one broken/disconnected shape. Replaced the flat-threshold keep with a nearest-neighbor
 * vote: for every point along the real GPS trace, find whichever OSM way (raceway-tagged or public
 * road) is closest, and only keep a way that WON that vote for at least a few consecutive trace points
 * -- i.e. was genuinely the closest option somewhere on the real line, not just within some fixed
 * radius of it. This is also what correctly drops most `highway=raceway`-tagged ways in this bounding
 * box (kept 38 of 86) -- the Sarthe circuit complex hosts several other raceway-tagged layouts
 * (karting, drag strip, a shorter Bugatti GP variant) that share the same tag but were never driven on
 * this lap, which a flat-threshold filter had no way to exclude either. Resulting extent still matches
 * the real trace almost exactly (lat 47.9131-47.9619 vs. trace 47.9135-47.9618). None of the
 * public-road ways carry a `width` tag; reused the existing raceway segments' own 13m for consistency
 * instead of guessing a different flat value.
 *
 * Served from public/track-boundaries.json and fetched once at runtime (see getTrackBoundary below)
 * rather than bundled into the JS chunk -- at ~440KB uncompressed this would otherwise ship to every
 * visitor of the Telemetry tab regardless of which single track they're actually looking at; a runtime
 * fetch lets the browser cache it once and only pay for it when the tab is actually opened.
 *
 * Segments are intentionally NOT stitched into one continuous ordered polyline -- OSM splits a real
 * circuit into many short ways (per corner, per straight, sometimes per lane), and reassembling them
 * into a single ordered loop turned out to need real graph-stitching (shared nodes, branch
 * disambiguation between the GP/Chicane/Moto layout variants that overlap in the same OSM bounding
 * box) well beyond what a quick pass could safely get right. Drawing every segment separately, each
 * projected through the same lat/lon -> screen transform as the lap traces, produces the identical
 * visual result for a map (real-world adjacent segments land adjacent on screen) without needing that
 * ordering at all -- SVG doesn't care whether the polylines composing a shape were drawn in path order.
 *
 * What DOES need doing before use: each track's raw Overpass result also includes any other raceway
 * sharing the same bounding box -- Red Bull Ring's short "Südschleife" national circuit, Road
 * Atlanta's motorcycle-only turn, disconnected chicane-bypass variants -- which show up as a second,
 * disconnected loop floating near the real one if left in. A union-find over endpoint proximity
 * (segments within ~150m of each other are the same physical loop) and keeping only the largest
 * connected component removes these cleanly; see the regeneration steps below.
 *
 * Regenerating for a track not covered here (or missing, like Mount Panorama): query
 * https://overpass-api.de/api/interpreter with
 * `[out:json];way["highway"="raceway"](south,west,north,east);out geom;` for that circuit's real-world
 * bounding box (found via https://nominatim.openstreetmap.org/search?q=<track name> -- watch for a
 * same-named unrelated place winning the geocode, as happened for "Road Atlanta" matching a Swiss
 * street; prefer a `leisure`-class or `relation` result), keep only `tags.width` and
 * `geometry[].{lat,lon}` per way, drop anything named "pit"/"box" (pit lane/entry -- not part of the
 * racing line), run the largest-connected-component filter described above to drop any other raceway
 * sharing the bounding box, and add the result to public/track-boundaries.json under the internal
 * `tracks.id`.
 */

export type TrackBoundarySegment = { width: number; pts: [number, number][] };
export type TrackBoundary = { trackId: number; segments: TrackBoundarySegment[] };

let cache: Promise<Record<string, TrackBoundary>> | null = null;

// Garage61 exposes the historic Le Mans layout under a separate track id. It is the same physical
// Circuit de la Sarthe envelope used by the 24 Heures variant, but previously missed the OSM map
// library and fell back to a partial GPS trace. Keep the alias here rather than duplicating 1,494
// source points in the public asset.
const BOUNDARY_ALIASES: Record<number, number> = { 195: 95 };

function loadAll(): Promise<Record<string, TrackBoundary>> {
  if (!cache) {
    cache = fetch("/track-boundaries.json")
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return cache;
}

export function getTrackBoundary(trackId: number | null | undefined): Promise<TrackBoundary | null> {
  if (trackId === null || trackId === undefined) return Promise.resolve(null);
  return loadAll().then((boundaries) => boundaries[String(trackId)] ?? boundaries[String(BOUNDARY_ALIASES[trackId])] ?? null);
}
