export type GpsPoint = { lat: number; lon: number };

const METERS_PER_DEGREE_LAT = 110_540; // ~constant; longitude's own meters-per-degree varies by cos(lat), handled below

/**
 * Fits latitude/longitude into an SVG without independently stretching X and Y.  Longitude is
 * scaled by cos(latitude), which makes local GPS traces proportionally correct anywhere on the
 * globe (the former min/max-per-axis projection visibly deformed Indianapolis and other tracks).
 *
 * Returns `project` plus `metersToPixels`: we have no real track-edge geometry (that's Garage61's
 * own proprietary, session-authenticated track model — confirmed by inspecting their app's network
 * calls, not something their public API or ours exposes), so any "track surface" we draw is really
 * just a stroke behind the driven line. Calibrating that stroke's width in real meters (via this
 * scale) is the most honest thing available: it makes the ribbon's width and the own/reference
 * lines' actual GPS separation share the same real-world scale, instead of an arbitrary constant
 * that has no relationship to how far apart the two cars actually were.
 */
export function createTrackProjector(points: GpsPoint[], width: number, height: number, padding = 12, fillViewport = false) {
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / Math.max(points.length, 1);
  const lonScale = Math.cos(meanLat * Math.PI / 180);
  const xs = points.map((point) => point.lon * lonScale);
  const ys = points.map((point) => point.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const usableWidth = Math.max(1, width - padding * 2), usableHeight = Math.max(1, height - padding * 2);
  const scaleX = usableWidth / Math.max(maxX - minX, 0.000001);
  const scaleY = usableHeight / Math.max(maxY - minY, 0.000001);
  const scale = Math.min(scaleX, scaleY);
  const xScale = fillViewport ? scaleX : scale, yScale = fillViewport ? scaleY : scale;
  const drawWidth = (maxX - minX) * xScale, drawHeight = (maxY - minY) * yScale;
  const offsetX = (width - drawWidth) / 2 - minX * xScale;
  const offsetY = (height - drawHeight) / 2 + maxY * yScale;
  const project = (point: GpsPoint) => `${(point.lon * lonScale * xScale + offsetX).toFixed(1)},${(offsetY - point.lat * yScale).toFixed(1)}`;
  // yScale is px per degree-latitude; degrees-latitude per meter is constant, so px-per-meter
  // follows directly. (xScale would give the same answer via lonScale, since both axes share one
  // uniform `scale` unless fillViewport stretched them apart — yScale/lat is the safe constant one.)
  const metersToPixels = (meters: number) => (meters / METERS_PER_DEGREE_LAT) * yScale;
  // 11/09/2026: "dava para aplicar um zoom padrão... veja como tem espaço disponível" -- a track whose
  // real shape is much narrower than the box it's drawn in (e.g. a tall/narrow track in a very tall
  // mobile viewport) only ever uses the constraining dimension (whichever of scaleX/scaleY was smaller
  // above), leaving the other dimension mostly empty on purpose (not stretching a real track's shape).
  // fillScale is how much this centered drawing needs to zoom in for its UNDERUSED dimension to reach
  // the box's own edge -- callers with a camera (lib/useMapZoomPan.ts) use it as a sensible default
  // zoom instead of leaving the driver to manually scroll-zoom in every time.
  //
  // 12/09/2026 fix: this used to be Math.min(width/drawWidth, height/drawHeight). Since drawWidth or
  // drawHeight already equals its own usable* value (whichever axis was the CONSTRAINING one at
  // scale=1), that axis's own ratio is always ~1 (padding only) and is therefore always the smaller of
  // the two -- so Math.min always picked the tight axis's own near-1 headroom, never the underused
  // axis's real fill potential, making the "default zoom" feature a no-op in exactly the case it was
  // built for. Math.max picks the underused axis's own ratio instead, so it actually fills. Capped so
  // an extreme aspect-ratio mismatch (a near-straight short chute in a near-square card) doesn't crop
  // most of the track's own shape away before the driver has touched the mouse -- they can still
  // scroll-zoom in further manually if they want the underused dimension filled completely.
  const FILL_SCALE_CAP = 2.5;
  const fillScale = Math.min(FILL_SCALE_CAP, Math.max(width / Math.max(drawWidth, 0.0001), height / Math.max(drawHeight, 0.0001)));
  return Object.assign(project, { metersToPixels, fillScale });
}
