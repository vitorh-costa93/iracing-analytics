import { createHash } from "node:crypto";

/**
 * Shared normalized setup format stored in `setup_files.decoded_params` (consumed unchanged by
 * `app/api/setup/compare`, the engineer chat and `lib/setup-diff`). Both producers feed the same
 * three-level tree that iRacing's SessionInfo `CarSetup` already has (tab -> section -> label):
 * Garage61's `run.setup.parameters` is that tree, and the agent sends it straight from the IBT.
 */
export type SetupParameters = Record<string, Record<string, Record<string, string | number>>>;
export type DecodedSetupRow = { tab: string; section: string; label: string; metric_value: string | number; is_mapped: boolean };

export function humanizeSetupKey(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\bArb\b/g, "ARB").replace(/\bRd\b/g, "3rd");
}

export function setupParamsToRows(parameters: SetupParameters | null | undefined): DecodedSetupRow[] {
  return Object.entries(parameters ?? {}).flatMap(([tab, sections]) =>
    Object.entries(sections ?? {}).flatMap(([section, values]) =>
      Object.entries(values ?? {}).map(([label, metricValue]) => ({ tab: humanizeSetupKey(tab), section: humanizeSetupKey(section), label: humanizeSetupKey(label), metric_value: metricValue, is_mapped: true }))
    )
  );
}

/**
 * Garage readouts and live measurements: they change from session to session (tyre wear/temps,
 * fuel and everything the garage derives from it) without the driver touching the setup.
 * Excluded from the setup identity and from the fixed comparison. Mirrors the "não se ajusta"
 * buckets of `lib/setup-diff.ts`.
 */
const READOUT = /last hot pressure|last temps|tread remaining|fuel level|corner weight|ride height|rh at speed|downforce|^ld$|to drag|fwtdist|cross weight|\bgap\b|defl|display page|dash/;
/**
 * Driver-adjustable from the cockpit even in fixed-setup sessions (brake bias, TC, ABS, maps, lights).
 * Ignored only by the fixed comparison, never by the identity.
 */
const IN_CAR_SECTION = /in ?car|dials|lighting|lights/;
const IN_CAR_LABEL = /brake (pressure )?bias|bias migration|traction control|\btc\b|\babs\b|throttle shap|\bmap\b|launch|engine brak|mixture|fuel target|fuel low warning|\bled\b|light|colou?r|limiter/;

const keyOf = (row: DecodedSetupRow) => `${row.tab}|${row.section}|${row.label}`.toLowerCase();
const valueOf = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").replace(/\+(?=\d)/g, "").toLowerCase();
const isReadout = (row: DecodedSetupRow) => READOUT.test(String(row.label).toLowerCase());
const isInCar = (row: DecodedSetupRow) => IN_CAR_SECTION.test(String(row.section).toLowerCase()) || IN_CAR_LABEL.test(String(row.label).toLowerCase());

function asRows(value: unknown): DecodedSetupRow[] {
  return Array.isArray(value) ? value.filter((row): row is DecodedSetupRow => !!row && typeof row === "object" && typeof row.tab === "string" && typeof row.section === "string" && typeof row.label === "string") : [];
}

function entries(rows: DecodedSetupRow[], skipInCar: boolean) {
  const map = new Map<string, string>();
  for (const row of rows) if (!isReadout(row) && !(skipInCar && isInCar(row))) map.set(keyOf(row), valueOf(row.metric_value));
  return map;
}

/** SHA-256 of the adjustable setup (readouts excluded): same setup in two sessions => same hash. */
export function setupIdentityHash(rows: DecodedSetupRow[]): string {
  const lines = [...entries(rows, false)].map(([key, value]) => `${key}=${value}`).sort();
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export const FIXED_MIN_PARAMS = 10;
export const FIXED_MIN_COVERAGE = 0.9;

/**
 * The IBT does not say whether the loaded setup is the iRacing fixed one. Infer it only by equality
 * with a fixed setup already known for the same car (setup_kind='fixed'): every comparable parameter
 * present in both must be equal, with at least FIXED_MIN_PARAMS shared parameters covering
 * FIXED_MIN_COVERAGE of each side (tolerates a few parameters renamed between Garage61 and the IBT).
 * Readouts and cockpit adjustments are ignored. Anything else is 'unknown' -- never 'commercial'.
 */
export function classifyAgainstFixed(rows: DecodedSetupRow[], fixedCandidates: unknown[]): "fixed" | "unknown" {
  const mine = entries(rows, true);
  if (mine.size < FIXED_MIN_PARAMS) return "unknown";
  for (const candidate of fixedCandidates) {
    const other = entries(asRows(candidate), true);
    let shared = 0, equal = true;
    for (const [key, value] of mine) {
      if (!other.has(key)) continue;
      shared += 1;
      if (other.get(key) !== value) { equal = false; break; }
    }
    if (equal && shared >= FIXED_MIN_PARAMS && shared >= FIXED_MIN_COVERAGE * Math.max(mine.size, other.size)) return "fixed";
  }
  return "unknown";
}
