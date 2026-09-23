// Per-lap GPS verification with a persistent cache (table lap_gps_checks). A lap's stored telemetry
// never changes, so its coverage and GPS distance only need to be computed once: only cache misses
// download the telemetry file. See supabase/migrations/20260923140000_lap_gps_checks.sql.

export type LapGpsCheck = { coveragePct: number; gpsDistanceMeters: number };

export type LapGpsCheckDeps = {
  load: (lapIds: string[]) => Promise<Map<string, LapGpsCheck>>;
  // Returns null when the telemetry couldn't be fetched -- that's treated as transient and NOT cached,
  // so a later request can retry. A fetched-but-unusable trace should come back as coverage 0.
  compute: (lapId: string) => Promise<LapGpsCheck | null>;
  save: (rows: Array<{ lapId: string } & LapGpsCheck>) => Promise<void>;
};

export async function checkLapsGps(lapIds: string[], deps: LapGpsCheckDeps): Promise<Map<string, LapGpsCheck | null>> {
  const unique = [...new Set(lapIds)];
  const result = new Map<string, LapGpsCheck | null>();
  if (!unique.length) return result;
  const cached = await deps.load(unique);
  const misses = unique.filter((id) => !cached.has(id));
  for (const id of unique) if (cached.has(id)) result.set(id, cached.get(id)!);
  const computed = await Promise.all(misses.map(async (id) => [id, await deps.compute(id)] as const));
  const toSave: Array<{ lapId: string } & LapGpsCheck> = [];
  for (const [id, check] of computed) {
    result.set(id, check);
    if (check) toSave.push({ lapId: id, ...check });
  }
  if (toSave.length) {
    try { await deps.save(toSave); } catch (error) { console.error("lap_gps_checks save failed:", error); }
  }
  return result;
}
