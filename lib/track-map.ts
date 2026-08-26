export type GpsPoint = { lat: number; lon: number };

/**
 * Fits latitude/longitude into an SVG without independently stretching X and Y.  Longitude is
 * scaled by cos(latitude), which makes local GPS traces proportionally correct anywhere on the
 * globe (the former min/max-per-axis projection visibly deformed Indianapolis and other tracks).
 */
export function createTrackProjector(points: GpsPoint[], width: number, height: number, padding = 12) {
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / Math.max(points.length, 1);
  const lonScale = Math.cos(meanLat * Math.PI / 180);
  const xs = points.map((point) => point.lon * lonScale);
  const ys = points.map((point) => point.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const usableWidth = Math.max(1, width - padding * 2), usableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(usableWidth / Math.max(maxX - minX, 0.000001), usableHeight / Math.max(maxY - minY, 0.000001));
  const drawWidth = (maxX - minX) * scale, drawHeight = (maxY - minY) * scale;
  const offsetX = (width - drawWidth) / 2 - minX * scale;
  const offsetY = (height - drawHeight) / 2 + maxY * scale;
  return (point: GpsPoint) => `${(point.lon * lonScale * scale + offsetX).toFixed(1)},${(offsetY - point.lat * scale).toFixed(1)}`;
}
