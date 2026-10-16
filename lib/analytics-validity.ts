/** Official season start, never civil-calendar week numbering. */
export function nextAnalyticsBoundary(starts: string[], now = Date.now()) {
  const boundaries = starts.flatMap(start => Array.from({ length: 13 }, (_, week) => Date.parse(start) + week * 7 * 86_400_000));
  return boundaries.filter(time => time > now).sort((a, b) => a - b)[0] ?? now + 120_000;
}

export function analyticsValidUntil(payload: unknown): number | null {
  const value = (payload as { cacheValidUntil?: number })?.cacheValidUntil;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
