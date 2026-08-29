import raw from "./track-boundaries.json";

/**
 * Real track-edge geometry, sourced from OpenStreetMap's `highway=raceway` ways (ODbL-licensed,
 * https://www.openstreetmap.org/copyright) via a one-time Overpass API query per track, 29/08/2026.
 * This is what makes the track map's asphalt ribbon an actual track boundary instead of a synthetic
 * tube drawn around whichever GPS trace happened to be compared -- see TrackMap's own comment for why
 * that synthetic ribbon could never show real track position ("aparenta estar tudo no meio da pista"
 * was a structural consequence of it, not a rendering bug).
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
 * Regenerating for a track not covered here: query
 * https://overpass-api.de/api/interpreter with
 * `[out:json];way["highway"="raceway"](south,west,north,east);out geom;` for that circuit's real-world
 * bounding box (found via https://nominatim.openstreetmap.org/search?q=<track name>), keep only
 * `tags.width` and `geometry[].{lat,lon}` per way, drop anything named "pit" (pit lane/entry -- not
 * part of the racing line), and add the result here under the internal `tracks.id`.
 */

export type TrackBoundarySegment = { width: number; pts: [number, number][] };
export type TrackBoundary = { trackId: number; segments: TrackBoundarySegment[] };

const boundaries = raw as unknown as Record<string, TrackBoundary>;

export function getTrackBoundary(trackId: number | null | undefined): TrackBoundary | null {
  if (trackId === null || trackId === undefined) return null;
  return boundaries[String(trackId)] ?? null;
}
