# irstats.com Race Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's iRating-matching heuristic and manual wins snapshot with a scraped, always-up-to-date `race_results` table sourced from irstats.com, while restricting Garage61 sync to telemetry, setups, and the current-iRating anchor.

**Architecture:** A new `lib/irstats.ts` module fetches and parses (via `cheerio`) two static server-rendered HTML pages from irstats.com — the paginated race list and the per-race detail page. A new `app/api/sync/irstats/route.ts` endpoint (incremental, called hourly by the existing Supabase Cron; and backfill, run once manually) writes parsed rows into a new `race_results` table, resolving `car_id`/`track_id` by name match against the existing `cars`/`tracks` catalog. Because irstats only exposes a *rounded* iRating value per race, exact iRating is never stored directly — it's reconstructed via a SQL view that walks backward from the current exact `ratings` snapshot (kept fresh by the existing Garage61 sync) subtracting each race's exact `irating_delta`. Four dashboard views are rewritten to read from `race_results` instead of `driving_sessions`/`rating_history`/the old matching table, and three routes (`dashboard/overview`, `telemetry/active-week`, `setup/inventory`) are updated to consume the new views/table. `driving_sessions`-populating sync steps and the old rating-match/official-results-import code paths are removed from the hourly cron and from the dashboard UI.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Supabase (Postgres + `@supabase/supabase-js`), `cheerio` (new dependency) for HTML parsing, `vitest` (new dev dependency) for unit-testing the pure parser functions — this repo has no test framework today, so this plan introduces the minimal one needed for the highest-risk new code (HTML parsing, which silently breaks if irstats changes markup).

**Spec:** [docs/superpowers/specs/2026-08-24-irstats-race-results-design.md](../specs/2026-08-24-irstats-race-results-design.md)

## Global Constraints

- Never invent or infer a data value that isn't present in the source HTML or an existing catalog table — on ambiguity/parse failure, throw an explicit error rather than writing a guessed value (spec: "Tratamento de erros e riscos").
- `irstats_race_id` is the idempotency key for `race_results` — reruns of incremental or backfill sync must never create duplicate rows (spec: "Modelo de dados").
- Exact iRating is derived only from `ratings` (Garage61 anchor) + `irating_delta` chaining — never from irstats' rounded display value (spec: "Correção: iRating exato via encadeamento de deltas").
- Requests to irstats.com must be spaced out and retry with backoff on HTTP 429 — the site rate-limits aggressively (confirmed empirically: two requests within ~2s triggered a 429).
- Telemetry (lap channels) and setups remain 100% Garage61-sourced — this plan does not touch `ActiveWeekTelemetry`'s telemetry-fetching logic or `SetupLab`'s setup-file logic, only how they determine the active car+track context.
- `driving_sessions`, `official_series_results`, `race_rating_matches`, `v_race_irating_candidates`, and `lib/rating-match.ts` are left in place as unused legacy (not physically dropped) per spec's "Fora de escopo".

---

## File Structure

New files:
- `lib/irstats.ts` — HTTP fetch (with retry/backoff) + cheerio parsing of the two irstats page types. Pure functions, fully unit-testable offline via fixture HTML strings.
- `lib/irstats.test.ts` — vitest unit tests for the parsers.
- `vitest.config.ts` — minimal vitest config.
- `supabase/migrations/20260824000000_race_results.sql` — `race_results` table.
- `supabase/migrations/20260824010000_race_results_views.sql` — `v_season_calendar` + rewritten `v_season_summary`, `v_season_category_summary`, `v_season_weekly_irating`, `v_historical_performance`, plus new `v_race_results_irating`.
- `app/api/sync/irstats/route.ts` — incremental + backfill sync endpoint, orchestrates `lib/irstats.ts` + Supabase writes (mirrors the existing pattern in `app/api/sync/incremental/route.ts`).

Modified files:
- `package.json` — add `cheerio` (dep) and `vitest` (devDep) + a `test` script.
- `app/api/dashboard/overview/route.ts` — swap `official_series_results`/`driving_sessions`/`v_race_irating_candidates` queries for `race_results`/`v_race_results_irating`; races array gains real `series`/`startPosition`/`finishPosition`.
- `app/api/telemetry/active-week/route.ts` — active week + car/track pairs now come from `race_results` instead of `v_season_weekly_irating` time-window + `driving_sessions`.
- `app/api/setup/inventory/route.ts` — `context()` and the car/track pair query now use `race_results` instead of `driving_sessions`.
- `app/api/cron/hourly-sync/route.ts` — drop `syncIncrementalSessions`, `syncRatingHistory`, `recomputeRatingMatches`; add the new irstats incremental sync call.
- `app/page.tsx` — remove the `OfficialResultsUpload`/`OfficialResultsPanel` usage (wins are now automatic, no manual snapshot step needed).

---

### Task 1: Add `cheerio` and `vitest`, wire up the test script

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: a `npm test` script running `vitest run`, and `cheerio` importable as `import * as cheerio from "cheerio"` in later tasks.

- [ ] **Step 1: Install dependencies**

```bash
npm install cheerio
npm install --save-dev vitest
```

- [ ] **Step 2: Add the test script to `package.json`**

Modify the `"scripts"` object in `package.json` to add:

```json
"test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify the empty test setup runs**

Run: `npm test`
Expected: vitest reports "No test files found" (or similar) with exit code 0 — confirms the runner is wired up before any real tests exist.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add cheerio and vitest for irstats parsing"
```

---

### Task 2: `lib/irstats.ts` — race list page parser

**Files:**
- Create: `lib/irstats.ts`
- Test: `lib/irstats.test.ts`

**Interfaces:**
- Produces:
  - `type RaceListEntry = { irstatsRaceId: number }`
  - `function parseRaceListPage(html: string): RaceListEntry[]`
  - `const IRSTATS_BASE_URL = "https://irstats.com"` (exported const, reused by later tasks/route)

Real markup confirmed by inspecting the live page (`https://irstats.com/driver/958741/races?page=0`) via DevTools: the results table has `<thead><tr><th>Date</th><th>Series</th><th>Track</th><th>Start</th><th>Fin</th><th>Inc</th><th>SoF</th><th></th></tr></thead>`, and each `<tbody>` row contains a link `<a href="/race/88132466">Results</a>`. Rows appear newest-first. This task only needs the race IDs, in page order — the authoritative per-race data comes from the detail page (Task 3), not this list.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/irstats.test.ts
import { describe, expect, it } from "vitest";
import { parseRaceListPage } from "./irstats";

const LIST_PAGE_FIXTURE = `
<table>
  <thead>
    <tr><th>Date</th><th>Series</th><th>Track</th><th>Start</th><th>Fin</th><th>Inc</th><th>SoF</th><th></th></tr>
  </thead>
  <tbody>
    <tr>
      <td class="rr-text text-nowrap">Aug 21, 2026 8:30 PM</td>
      <td class="rr-text">Formula B - Super Formula Series<br>Super Formula SF23 - Honda</td>
      <td class="rr-text d-none d-md-table-cell">Autodromo Nazionale Monza<br>Grand Prix</td>
      <td class="text-center d-none d-sm-table-cell">2nd</td>
      <td class="text-center"></td>
      <td class="text-center d-none d-sm-table-cell">1x</td>
      <td class="text-center d-none d-md-table-cell">4487</td>
      <td class="text-center"><a href="/race/88132466">Results</a></td>
    </tr>
    <tr>
      <td class="rr-text text-nowrap">Aug 21, 2026 7:30 PM</td>
      <td class="rr-text">Formula B - Super Formula Series - Fixed<br>Super Formula SF23 - Honda</td>
      <td class="rr-text d-none d-md-table-cell">Autodromo Nazionale Monza<br>Grand Prix</td>
      <td class="text-center d-none d-sm-table-cell">5th</td>
      <td class="text-center">20</td>
      <td class="text-center d-none d-sm-table-cell">2x</td>
      <td class="text-center d-none d-md-table-cell">3258</td>
      <td class="text-center"><a href="/race/88131369">Results</a></td>
    </tr>
  </tbody>
</table>
`;

describe("parseRaceListPage", () => {
  it("extracts race IDs in page order from the Results links", () => {
    const entries = parseRaceListPage(LIST_PAGE_FIXTURE);
    expect(entries).toEqual([{ irstatsRaceId: 88132466 }, { irstatsRaceId: 88131369 }]);
  });

  it("returns an empty array when the table has no rows", () => {
    expect(parseRaceListPage("<table><thead></thead><tbody></tbody></table>")).toEqual([]);
  });

  it("throws when the page has no results table at all (unexpected markup)", () => {
    expect(() => parseRaceListPage("<html><body>Too Many Requests</body></html>")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/irstats.test.ts`
Expected: FAIL — `lib/irstats.ts` doesn't exist yet / `parseRaceListPage` is not exported.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/irstats.ts
import * as cheerio from "cheerio";

export const IRSTATS_BASE_URL = "https://irstats.com";

export type RaceListEntry = { irstatsRaceId: number };

export function parseRaceListPage(html: string): RaceListEntry[] {
  const $ = cheerio.load(html);
  const table = $("table").first();
  if (table.length === 0) {
    throw new Error("irstats race list: no <table> found in page — markup may have changed");
  }

  const entries: RaceListEntry[] = [];
  table.find("tbody tr").each((_, row) => {
    const href = $(row).find('a[href^="/race/"]').attr("href");
    if (!href) return;
    const match = href.match(/^\/race\/(\d+)$/);
    if (!match) return;
    entries.push({ irstatsRaceId: Number(match[1]) });
  });
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/irstats.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/irstats.ts lib/irstats.test.ts
git commit -m "feat: parse irstats race list page for race IDs"
```

---

### Task 3: `lib/irstats.ts` — race detail page parser

**Files:**
- Modify: `lib/irstats.ts`
- Test: `lib/irstats.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 2 besides the module itself.
- Produces:
  - `type RaceResult = { irstatsRaceId: number; racedAt: string; seriesName: string; trackName: string; carName: string; category: "formula_car" | "sports_car"; seasonWeek: number | null; licenseClass: string; safetyRating: number; iratingDisplay: string; iratingDelta: number; gridPosition: number | null; finishPosition: number; positionChange: number | null; laps: number | null; lapsLed: number | null; fastestLapTime: string | null; incidents: number | null; points: number | null; sof: number | null }`
  - `function parseRaceDetailPage(html: string, driverName: string): RaceResult`

Real markup confirmed live on `https://irstats.com/race/88132466`:
- `h1.lb-title` → series name (e.g. `"Formula B - Super Formula Series"`).
- `p.lb-sub` → `"{track} ({config})\n ·Week {N}"` (config may be absent for some tracks; week may be absent for non-championship races — the fixture below and the implementation both treat week as optional).
- `span.race-stat` blocks, each `<b>Label</b> value`, for `SoF`, `Drivers`, `Laps`, `Incidents`, `Category`, `Date`. Only `SoF`, `Category`, and `Date` are needed here.
- The results `<table>` header row (`thead th`) is exactly: `Pos, Driver, License, iR, Car, Grid, +/−, Laps, Led, Fastest, Inc, Pts` (12 columns, confirmed via live DOM read).
- Each `<tbody>` row's 2nd cell (`Driver`) holds the driver's full name as plain text (e.g. `"Vitor Hugo Da Costa"`). The `Pos` cell (1st cell) is **empty for the top 3 finishers** (medal styling, no text) and holds a plain number from 4th place on — so **finish position must be derived from the row's 1-based index in the table**, not from the `Pos` cell text (confirmed live: row 2 = P2, `Pos` cell text was empty).
- The `iR` cell (4th) contains the rounded iRating display as a text node (e.g. `"5.2k"`) plus a nested `<small>` tag holding the signed delta (e.g. `<small class="text-success">+73</small>`); a negative delta uses the same `<small>` structure with a leading `-` (untested live since no negative example was observed, but the parser must handle both signs via the leading `+`/`-` character, never assume the CSS class encodes the sign).
- The `License` cell (3rd) is `"{class} {safetyRating}"` (e.g. `"A 3.31"`).
- `Grid`, `+/−`, `Laps`, `Led`, `Inc`, `Pts` cells are plain integers (the `+/−` cell can be signed, e.g. `"+3"`, `"-4"`, or `"0"`).
- `Fastest` cell is a time string like `"1:27.305"`, or empty if the driver set no representative lap.

- [ ] **Step 1: Write the failing test**

```typescript
// append to lib/irstats.test.ts
import { parseRaceDetailPage } from "./irstats";

const DETAIL_PAGE_FIXTURE = `
<main>
  <h1 class="lb-title mt-1 mb-1">Formula B - Super Formula Series</h1>
  <p class="lb-sub mb-3">Autodromo Nazionale Monza (Grand Prix)
    ·Week 10</p>
  <span class="race-stat"><b>SoF</b> 4487</span>
  <span class="race-stat"><b>Drivers</b> 16</span>
  <span class="race-stat"><b>Laps</b> 24</span>
  <span class="race-stat"><b>Incidents</b> 80 <span class="text-muted">(5.0/driver)</span></span>
  <span class="race-stat"><b>Category</b> Formula Car</span>
  <span class="race-stat"><b>Date</b> Aug 21, 2026 · 20:30 UTC</span>
  <table>
    <thead>
      <tr><th>Pos</th><th>Driver</th><th>License</th><th>iR</th><th>Car</th><th>Grid</th><th>+/−</th><th>Laps</th><th>Led</th><th>Fastest</th><th>Inc</th><th>Pts</th></tr>
    </thead>
    <tbody>
      <tr>
        <td class="text-center fw-semibold"></td>
        <td>Kevin A Foster</td>
        <td class="text-center">A 4.28</td>
        <td class="text-center">7.8k<small class="text-success">+37</small></td>
        <td class="text-center car-cell">Super Formula SF23 - Toyota</td>
        <td class="text-center">1</td>
        <td class="text-center">0</td>
        <td class="text-center">24</td>
        <td class="text-center d-none d-lg-table-cell">23</td>
        <td class="text-center fw-semibold text-primary">1:26.253</td>
        <td class="text-center">4</td>
        <td class="text-center d-none d-lg-table-cell">251</td>
      </tr>
      <tr>
        <td class="text-center fw-semibold"></td>
        <td>Vitor Hugo Da Costa</td>
        <td class="text-center">A 3.31</td>
        <td class="text-center">5.2k<small class="text-success">+73</small></td>
        <td class="text-center car-cell">Super Formula SF23 - Honda</td>
        <td class="text-center">2</td>
        <td class="text-center">0</td>
        <td class="text-center">24</td>
        <td class="text-center d-none d-lg-table-cell">1</td>
        <td class="text-center">1:27.305</td>
        <td class="text-center">1</td>
        <td class="text-center d-none d-lg-table-cell">234</td>
      </tr>
      <tr>
        <td class="text-center fw-semibold">4</td>
        <td>Noddy Emel</td>
        <td class="text-center">A 1.37</td>
        <td class="text-center">5.3k<small class="text-danger">-46</small></td>
        <td class="text-center car-cell">Super Formula SF23 - Toyota</td>
        <td class="text-center">7</td>
        <td class="text-center">+3</td>
        <td class="text-center">24</td>
        <td class="text-center d-none d-lg-table-cell">0</td>
        <td class="text-center">1:26.867</td>
        <td class="text-center">15</td>
        <td class="text-center d-none d-lg-table-cell">200</td>
      </tr>
    </tbody>
  </table>
</main>
`;

describe("parseRaceDetailPage", () => {
  it("extracts the named driver's row and the race-level metadata", () => {
    const result = parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Vitor Hugo Da Costa");
    expect(result).toEqual({
      irstatsRaceId: 0, // caller fills this in from the URL, not the HTML — see Task 5
      racedAt: "2026-08-21T20:30:00.000Z",
      seriesName: "Formula B - Super Formula Series",
      trackName: "Autodromo Nazionale Monza",
      carName: "Super Formula SF23 - Honda",
      category: "formula_car",
      seasonWeek: 10,
      licenseClass: "A",
      safetyRating: 3.31,
      iratingDisplay: "5.2k",
      iratingDelta: 73,
      gridPosition: 2,
      finishPosition: 2,
      positionChange: 0,
      laps: 24,
      lapsLed: 1,
      fastestLapTime: "1:27.305",
      incidents: 1,
      points: 234,
      sof: 4487,
    });
  });

  it("derives finish position from row order even when the Pos cell is blank (top-3 medal styling)", () => {
    const result = parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Kevin A Foster");
    expect(result.finishPosition).toBe(1);
  });

  it("parses a negative iRating delta correctly", () => {
    const result = parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Noddy Emel");
    expect(result.iratingDelta).toBe(-46);
    expect(result.finishPosition).toBe(4);
    expect(result.positionChange).toBe(3);
  });

  it("throws when the named driver is not in the results table", () => {
    expect(() => parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Nobody Here")).toThrow();
  });

  it("throws when the category text is not a recognized value", () => {
    const badCategory = DETAIL_PAGE_FIXTURE.replace(">Formula Car<", ">Nascar<");
    expect(() => parseRaceDetailPage(badCategory, "Vitor Hugo Da Costa")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/irstats.test.ts`
Expected: FAIL — `parseRaceDetailPage` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/irstats.ts`:

```typescript
export type RaceResult = {
  irstatsRaceId: number;
  racedAt: string;
  seriesName: string;
  trackName: string;
  carName: string;
  category: "formula_car" | "sports_car";
  seasonWeek: number | null;
  licenseClass: string;
  safetyRating: number;
  iratingDisplay: string;
  iratingDelta: number;
  gridPosition: number | null;
  finishPosition: number;
  positionChange: number | null;
  laps: number | null;
  lapsLed: number | null;
  fastestLapTime: string | null;
  incidents: number | null;
  points: number | null;
  sof: number | null;
};

function raceStat($: cheerio.CheerioAPI, label: string): string {
  const span = $("span.race-stat").filter((_, el) => $(el).find("b").first().text().trim() === label).first();
  if (span.length === 0) throw new Error(`irstats race detail: missing "${label}" race-stat block — markup may have changed`);
  const clone = span.clone();
  clone.find("b").remove();
  return clone.text().trim();
}

function parseCategory(raw: string): "formula_car" | "sports_car" {
  if (raw === "Formula Car") return "formula_car";
  if (raw === "Sports Car") return "sports_car";
  throw new Error(`irstats race detail: unrecognized category "${raw}"`);
}

function parseIntOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(raw: string): string {
  // raw like "Aug 21, 2026 · 20:30 UTC"
  const match = raw.match(/^(\w+ \d{1,2}, \d{4}) · (\d{2}:\d{2}) UTC$/);
  if (!match) throw new Error(`irstats race detail: unrecognized date format "${raw}"`);
  const isoLike = `${match[1]} ${match[2]} UTC`;
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) throw new Error(`irstats race detail: could not parse date "${raw}"`);
  return parsed.toISOString();
}

export function parseRaceDetailPage(html: string, driverName: string): RaceResult {
  const $ = cheerio.load(html);

  const seriesName = $("h1.lb-title").first().text().trim();
  if (!seriesName) throw new Error("irstats race detail: missing series name (h1.lb-title)");

  const subLine = $("p.lb-sub").first().text().replace(/\s+/g, " ").trim();
  const subMatch = subLine.match(/^(.+?)(?:\s*\(([^)]+)\))?\s*(?:·Week (\d+))?$/);
  if (!subMatch) throw new Error(`irstats race detail: unrecognized track/week line "${subLine}"`);
  const trackName = subMatch[1].trim();
  const seasonWeek = subMatch[3] ? Number(subMatch[3]) : null;

  const category = parseCategory(raceStat($, "Category"));
  const racedAt = parseDate(raceStat($, "Date"));
  const sof = parseIntOrNull(raceStat($, "SoF"));

  const table = $("table").first();
  if (table.length === 0) throw new Error("irstats race detail: no results table found");
  const rows = table.find("tbody tr").toArray();

  const rowIndex = rows.findIndex((row) => $(row).find("td").eq(1).text().trim() === driverName);
  if (rowIndex === -1) throw new Error(`irstats race detail: driver "${driverName}" not found in results table`);

  const cells = $(rows[rowIndex]).find("td");
  const licenseCell = cells.eq(2).text().trim(); // "A 3.31"
  const licenseMatch = licenseCell.match(/^(\S+)\s+([\d.]+)$/);
  if (!licenseMatch) throw new Error(`irstats race detail: unrecognized license cell "${licenseCell}"`);

  const iratingCell = cells.eq(3);
  const iratingDeltaText = iratingCell.find("small").first().text().trim();
  const iratingDeltaMatch = iratingDeltaText.match(/^([+-]\d+)$/);
  if (!iratingDeltaMatch) throw new Error(`irstats race detail: unrecognized iRating delta "${iratingDeltaText}"`);
  const iratingClone = iratingCell.clone();
  iratingClone.find("small").remove();
  const iratingDisplay = iratingClone.text().trim();

  const fastestLapText = cells.eq(9).text().trim();

  return {
    irstatsRaceId: 0,
    racedAt,
    seriesName,
    trackName,
    carName: cells.eq(4).text().trim(),
    category,
    seasonWeek,
    licenseClass: licenseMatch[1],
    safetyRating: Number(licenseMatch[2]),
    iratingDisplay,
    iratingDelta: Number(iratingDeltaMatch[1]),
    gridPosition: parseIntOrNull(cells.eq(5).text()),
    finishPosition: rowIndex + 1,
    positionChange: parseIntOrNull(cells.eq(6).text()),
    laps: parseIntOrNull(cells.eq(7).text()),
    lapsLed: parseIntOrNull(cells.eq(8).text()),
    fastestLapTime: fastestLapText === "" ? null : fastestLapText,
    incidents: parseIntOrNull(cells.eq(10).text()),
    points: parseIntOrNull(cells.eq(11).text()),
    sof,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/irstats.test.ts`
Expected: PASS (8 tests total). Note the first test's expected object includes `irstatsRaceId: 0` — this field is intentionally not parsed from the detail page HTML (it's not present there) and is filled in by the caller from the request URL in Task 5; the test fixture/expectation documents this contract.

- [ ] **Step 5: Commit**

```bash
git add lib/irstats.ts lib/irstats.test.ts
git commit -m "feat: parse irstats race detail page into a RaceResult"
```

---

### Task 4: `lib/irstats.ts` — HTTP fetch with retry/backoff

**Files:**
- Modify: `lib/irstats.ts`
- Test: `lib/irstats.test.ts`

**Interfaces:**
- Consumes: `IRSTATS_BASE_URL` from Task 2.
- Produces:
  - `type FetchImpl = (url: string) => Promise<Response>` (injectable for testing)
  - `async function fetchIrstatsPage(path: string, opts?: { fetchImpl?: FetchImpl; maxRetries?: number; retryDelayMs?: number }): Promise<string>` — returns response body text; retries on HTTP 429 with linear backoff (`retryDelayMs * attempt`), throws after `maxRetries` (default 4) exhausted or on any non-429 non-2xx status.

- [ ] **Step 1: Write the failing test**

```typescript
// append to lib/irstats.test.ts
import { fetchIrstatsPage } from "./irstats";

describe("fetchIrstatsPage", () => {
  it("returns the body text on a 200 response", async () => {
    const fetchImpl = async () => new Response("<html>ok</html>", { status: 200 });
    const body = await fetchIrstatsPage("/driver/958741", { fetchImpl });
    expect(body).toBe("<html>ok</html>");
  });

  it("retries on 429 and succeeds once the mock returns 200", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 3) return new Response("Too Many Requests", { status: 429 });
      return new Response("<html>ok</html>", { status: 200 });
    };
    const body = await fetchIrstatsPage("/driver/958741", { fetchImpl, retryDelayMs: 1 });
    expect(body).toBe("<html>ok</html>");
    expect(calls).toBe(3);
  });

  it("throws after exhausting retries on persistent 429", async () => {
    const fetchImpl = async () => new Response("Too Many Requests", { status: 429 });
    await expect(
      fetchIrstatsPage("/driver/958741", { fetchImpl, maxRetries: 2, retryDelayMs: 1 })
    ).rejects.toThrow(/429/);
  });

  it("throws immediately on a non-429 error status without retrying", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("Not Found", { status: 404 });
    };
    await expect(fetchIrstatsPage("/driver/958741", { fetchImpl })).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/irstats.test.ts`
Expected: FAIL — `fetchIrstatsPage` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/irstats.ts`:

```typescript
export type FetchImpl = (url: string) => Promise<Response>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchIrstatsPage(
  path: string,
  opts: { fetchImpl?: FetchImpl; maxRetries?: number; retryDelayMs?: number } = {}
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 4;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const url = `${IRSTATS_BASE_URL}${path}`;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const response = await fetchImpl(url);
    if (response.ok) return response.text();
    if (response.status === 429 && attempt <= maxRetries) {
      await sleep(retryDelayMs * attempt);
      continue;
    }
    throw new Error(`irstats fetch ${path}: HTTP ${response.status}`);
  }
  throw new Error(`irstats fetch ${path}: exhausted retries`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/irstats.test.ts`
Expected: PASS (12 tests total)

- [ ] **Step 5: Commit**

```bash
git add lib/irstats.ts lib/irstats.test.ts
git commit -m "feat: add retrying fetch helper for irstats pages"
```

---

### Task 5: `race_results` table migration

**Files:**
- Create: `supabase/migrations/20260824000000_race_results.sql`

**Interfaces:**
- Produces: table `public.race_results` with columns exactly as listed below — Task 6's sync route inserts into this shape.

- [ ] **Step 1: Write the migration**

```sql
create table if not exists public.race_results (
  id uuid primary key default gen_random_uuid(),
  irstats_race_id bigint not null unique,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  raced_at timestamptz not null,
  series_name text not null,
  track_name text not null,
  car_name text not null,
  car_id integer references public.cars(id),
  track_id integer references public.tracks(id),
  category text not null check (category in ('formula_car', 'sports_car')),
  season_week integer,
  license_class text not null,
  safety_rating numeric not null,
  irating_display text not null,
  irating_delta integer not null,
  grid_position integer,
  finish_position integer not null,
  position_change integer,
  laps integer,
  laps_led integer,
  fastest_lap_time text,
  incidents integer,
  points integer,
  sof integer,
  imported_at timestamptz not null default now()
);

create index if not exists idx_race_results_driver_raced_at
  on public.race_results (driver_id, raced_at desc);

create index if not exists idx_race_results_driver_category
  on public.race_results (driver_id, category);

alter table public.race_results enable row level security;
grant all on table public.race_results to service_role;

comment on table public.race_results is
  'Official race results scraped from irstats.com (public, no API). irating_delta is exact; irating_display is the rounded value irstats shows and must never be used for calculation — see v_race_results_irating for exact reconstructed iRating via delta-chaining from the Garage61 ratings anchor.';
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db push --dry-run` to confirm it applies cleanly against the linked project, then `npx supabase db push` to apply it.
Expected: migration applies with no errors; `race_results` table exists with the columns above (verify with `npx supabase db diff` showing no drift, or a quick `select * from race_results limit 0;` via the Supabase SQL editor).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260824000000_race_results.sql
git commit -m "feat: add race_results table for irstats-sourced race data"
```

---

### Task 6: `app/api/sync/irstats/route.ts` — incremental and backfill sync

**Files:**
- Create: `app/api/sync/irstats/route.ts`

**Interfaces:**
- Consumes: `parseRaceListPage`, `parseRaceDetailPage`, `fetchIrstatsPage`, `IRSTATS_BASE_URL` from `lib/irstats.ts` (Tasks 2–4); `race_results` table from Task 5; `supabaseAdmin` from `lib/supabase-admin.ts`.
- Produces: `GET /api/sync/irstats?mode=incremental|backfill` (default `incremental`), protected by `CRON_SECRET` header exactly like `app/api/cron/hourly-sync/route.ts`. Returns `{ status: "ok", imported: number, skipped: number }` or `{ status: "error", message }`.

This mirrors the existing pattern in `app/api/sync/incremental/route.ts` (sync_runs bookkeeping, driver lookup) and `app/api/dashboard/overview/route.ts` (`throwSupabaseError` pattern) — reuse the same conventions rather than inventing new ones.

- [ ] **Step 1: Write the implementation**

```typescript
// app/api/sync/irstats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchIrstatsPage, parseRaceDetailPage, parseRaceListPage } from "@/lib/irstats";

const IRSTATS_DRIVER_ID = "958741";
const REQUEST_DELAY_MS = 3000;
const MAX_BACKFILL_PAGES = 30;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveCarTrackIds() {
  const [carsResult, tracksResult] = await Promise.all([
    supabaseAdmin.from("cars").select("id, name"),
    supabaseAdmin.from("tracks").select("id, name"),
  ]);
  if (carsResult.error) throw carsResult.error;
  if (tracksResult.error) throw tracksResult.error;

  const carByName = new Map<string, number>();
  for (const row of carsResult.data ?? []) carByName.set(String(row.name).trim().toLowerCase(), row.id as number);
  const trackByName = new Map<string, number>();
  for (const row of tracksResult.data ?? []) trackByName.set(String(row.name).trim().toLowerCase(), row.id as number);
  return { carByName, trackByName };
}

async function importRace(
  raceId: number,
  driverId: string,
  driverName: string,
  carByName: Map<string, number>,
  trackByName: Map<string, number>
) {
  const html = await fetchIrstatsPage(`/race/${raceId}`, { retryDelayMs: REQUEST_DELAY_MS });
  const parsed = parseRaceDetailPage(html, driverName);
  const row = {
    irstats_race_id: raceId,
    driver_id: driverId,
    raced_at: parsed.racedAt,
    series_name: parsed.seriesName,
    track_name: parsed.trackName,
    car_name: parsed.carName,
    car_id: carByName.get(parsed.carName.trim().toLowerCase()) ?? null,
    track_id: trackByName.get(parsed.trackName.trim().toLowerCase()) ?? null,
    category: parsed.category,
    season_week: parsed.seasonWeek,
    license_class: parsed.licenseClass,
    safety_rating: parsed.safetyRating,
    irating_display: parsed.iratingDisplay,
    irating_delta: parsed.iratingDelta,
    grid_position: parsed.gridPosition,
    finish_position: parsed.finishPosition,
    position_change: parsed.positionChange,
    laps: parsed.laps,
    laps_led: parsed.lapsLed,
    fastest_lap_time: parsed.fastestLapTime,
    incidents: parsed.incidents,
    points: parsed.points,
    sof: parsed.sof,
  };
  const { error } = await supabaseAdmin.from("race_results").upsert(row, { onConflict: "irstats_race_id" });
  if (error) throw error;
}

async function runSync(mode: "incremental" | "backfill") {
  const startedAt = new Date().toISOString();
  const { data: syncRun } = await supabaseAdmin
    .from("sync_runs")
    .insert({ sync_type: `irstats_${mode}`, status: "running", started_at: startedAt })
    .select("id")
    .single();

  try {
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (driverError || !driver) throw new Error("Piloto não encontrado no Supabase");

    const { data: existingIds, error: existingError } = await supabaseAdmin
      .from("race_results")
      .select("irstats_race_id")
      .eq("driver_id", driver.id);
    if (existingError) throw existingError;
    const known = new Set((existingIds ?? []).map((row) => row.irstats_race_id as number));

    const { carByName, trackByName } = await resolveCarTrackIds();

    let imported = 0;
    let skipped = 0;
    const maxPages = mode === "backfill" ? MAX_BACKFILL_PAGES : 1;

    for (let page = 0; page < maxPages; page += 1) {
      await sleep(REQUEST_DELAY_MS);
      const listHtml = await fetchIrstatsPage(`/driver/${IRSTATS_DRIVER_ID}/races?page=${page}`, {
        retryDelayMs: REQUEST_DELAY_MS,
      });
      const entries = parseRaceListPage(listHtml);
      if (entries.length === 0) break;

      let hitKnownId = false;
      for (const entry of entries) {
        if (known.has(entry.irstatsRaceId)) {
          skipped += 1;
          if (mode === "incremental") {
            hitKnownId = true;
            break;
          }
          continue;
        }
        await sleep(REQUEST_DELAY_MS);
        await importRace(entry.irstatsRaceId, driver.id, driver.name, carByName, trackByName);
        known.add(entry.irstatsRaceId);
        imported += 1;
      }
      if (mode === "incremental" && hitKnownId) break;
    }

    if (syncRun) {
      await supabaseAdmin
        .from("sync_runs")
        .update({ status: "success", finished_at: new Date().toISOString(), details: { imported, skipped } })
        .eq("id", syncRun.id);
    }

    return { status: "ok" as const, imported, skipped };
  } catch (error) {
    if (syncRun) {
      await supabaseAdmin
        .from("sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          details: { message: error instanceof Error ? error.message : String(error) },
        })
        .eq("id", syncRun.id);
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "backfill" ? "backfill" : "incremental";

  try {
    const result = await runSync(mode);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

Note: `sync_runs.details` is assumed to be a `jsonb` column accepting arbitrary objects, consistent with how `sync_runs` is used elsewhere (`status`, `started_at`, `finished_at` columns confirmed via `app/api/sync/incremental/route.ts` and `app/api/sync/all/route.ts`). If the `details` column doesn't exist on `sync_runs`, drop the `details:` key from both `.update(...)` calls above — it's non-essential bookkeeping, not required for the sync to function.

- [ ] **Step 2: Manually verify incremental mode against the real site**

Run (with `CRON_SECRET` set in `.env.local` and the dev server running via `npm run dev`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/sync/irstats?mode=incremental"
```

Expected: `{"status":"ok","imported":<N>,"skipped":0}` where `N` is small (first run imports until it exhausts page 0, since nothing is known yet — expect up to 50 imported, not an error). Check Supabase (`select count(*) from race_results;`) shows rows with correct `car_name`/`irating_delta`/`finish_position` matching what's visible on `https://irstats.com/driver/958741/races`.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/irstats/route.ts
git commit -m "feat: add irstats incremental/backfill sync endpoint"
```

---

### Task 7: Run the historical backfill (1,327 races)

**Files:** none (operational step, not a code change)

**Interfaces:**
- Consumes: `GET /api/sync/irstats?mode=backfill` from Task 6.

- [ ] **Step 1: Run the backfill against the deployed (or local) endpoint**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/sync/irstats?mode=backfill"
```

Expected: with `MAX_BACKFILL_PAGES = 30` covering the confirmed 27 pages and `REQUEST_DELAY_MS = 3000`, this call runs for roughly 1,327 races × ~3–6s each (list pagination + per-race fetch) — **expect this single HTTP request to take 60–120+ minutes**. If the Next.js dev server or a serverless function times out before completion, rerun the same command: the sync is idempotent (`onConflict: "irstats_race_id"` plus the `known` set skip logic) and will resume roughly where it left off each time, at the cost of re-walking already-imported pages until it reaches genuinely new IDs — call it repeatedly until `imported` returns `0` and `skipped` matches the full 1,327.

- [ ] **Step 2: Verify completeness**

Run in the Supabase SQL editor:

```sql
select count(*) from public.race_results;
```

Expected: `1327` (or higher, if new races occurred on irstats.com since this plan was written — cross-check against the "Showing 1–50 of 1,XXX races" text on `https://irstats.com/driver/958741/races`).

- [ ] **Step 3: No commit needed** — this is a data operation, not a code change. (If `MAX_BACKFILL_PAGES` needed raising to finish, that code change was already committed in Task 6 — go back and amend that constant/commit if so, don't leave it silently different from what's in git.)

---

### Task 8: `v_season_calendar` + rewritten dashboard views

**Files:**
- Create: `supabase/migrations/20260824010000_race_results_views.sql`

**Interfaces:**
- Consumes: `race_results` table (Task 5), existing `ratings` table (unchanged, populated by `app/api/sync/all/route.ts`).
- Produces: views `v_season_calendar`, `v_race_results_irating`, and rewritten `v_season_summary`, `v_season_category_summary`, `v_season_weekly_irating`, `v_historical_performance` — same column names as the versions read by `app/api/dashboard/overview/route.ts` today (Task 9 consumes these exact names), so Task 9 doesn't need to change its `.select(...)` column lists, only the underlying data source changes.

The season boundaries below are copied verbatim from the existing hardcoded `season_dates` CTE in `supabase/migrations/20260819010000_fix_weekly_activity_race_only.sql` — this migration centralizes that duplication into one reusable view instead of repeating it in four places.

- [ ] **Step 1: Write the migration**

```sql
-- Centralizes the season calendar (previously duplicated in v_season_weekly_irating and the
-- remote_schema views) so race_results-based views share one source of truth.
create or replace view public.v_season_calendar as
select '31'::text as season_id, '2025 Season 4'::text as season_name, '2025-09-16 00:00:00+00'::timestamptz as season_start
union all
select '32', '2026 Season 1', '2025-12-16 00:00:00+00'::timestamptz
union all
select '33', '2026 Season 2', '2026-03-17 00:00:00+00'::timestamptz
union all
select '34', '2026 Season 3', '2026-06-16 00:00:00+00'::timestamptz;

comment on view public.v_season_calendar is
  'Season id/name/start-date calendar shared by all race_results-based views. Add a row here when a new iRacing season starts.';

-- Exact iRating reconstruction: irstats only shows a rounded iRating per race, so we chain the
-- exact irating_delta of every race back from the current exact ratings snapshot (the Garage61
-- anchor). irating_after(race) = anchor - sum(delta of every race for the same driver+category
-- strictly more recent than this one). irating_before(race) = irating_after(race) - delta.
create or replace view public.v_race_results_irating as
select
  rr.*,
  (r.rating - coalesce(
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at desc
      rows between unbounded preceding and 1 preceding
    ), 0
  )) as irating_after,
  (r.rating - coalesce(
    sum(rr.irating_delta) over (
      partition by rr.driver_id, rr.category
      order by rr.raced_at desc
      rows between unbounded preceding and 1 preceding
    ), 0
  )) - rr.irating_delta as irating_before
from public.race_results rr
join public.ratings r
  on r.driver_id = rr.driver_id
 and r.category = rr.category
 and r.rating_type = 'irating';

comment on view public.v_race_results_irating is
  'race_results decorated with exact reconstructed irating_before/irating_after per row, derived by chaining irating_delta backward from the current exact ratings snapshot (never from irstats own rounded display value).';

create or replace view public.v_season_summary as
with season_races as (
  select
    sc.season_id,
    sc.season_name,
    count(*) as race_sessions,
    sum(coalesce(rr.laps, 0)) as total_laps
  from public.v_season_calendar sc
  join public.race_results rr
    on rr.raced_at >= sc.season_start
   and rr.raced_at < sc.season_start + interval '84 days'
  group by sc.season_id, sc.season_name
)
select season_id, season_name, race_sessions, total_laps
from season_races;

create or replace view public.v_season_category_summary as
with season_races as (
  select
    sc.season_id,
    sc.season_name,
    rr.category as rating_category,
    rr.irating_delta as delta_irating
  from public.v_season_calendar sc
  join public.race_results rr
    on rr.raced_at >= sc.season_start
   and rr.raced_at < sc.season_start + interval '84 days'
)
select
  season_id,
  season_name,
  rating_category,
  count(*) as corridas,
  sum(delta_irating) as delta_irating,
  avg(delta_irating) as delta_medio,
  percentile_cont(0.5) within group (order by delta_irating) as mediana,
  100.0 * count(*) filter (where delta_irating > 0) / nullif(count(*), 0) as pct_positivas
from season_races
group by season_id, season_name, rating_category;

create or replace view public.v_season_weekly_irating as
with weeks as (
  select
    sc.season_id,
    sc.season_name,
    sc.season_start,
    gs as week_number,
    sc.season_start + ((gs - 1) * interval '7 days') as week_start,
    sc.season_start + (gs * interval '7 days') as week_end
  from public.v_season_calendar sc
  cross join generate_series(1, 12) gs
),
categories as (
  select 'formula_car'::text as rating_category
  union all
  select 'sports_car'
),
grid as (
  select w.season_id, w.season_name, w.week_number, w.week_start, w.week_end, c.rating_category
  from weeks w
  cross join categories c
),
week_races as (
  select
    sc.season_id,
    rr.category as rating_category,
    coalesce(rr.season_week, floor(extract(epoch from (rr.raced_at - sc.season_start)) / 604800)::int + 1) as week_number,
    rr.raced_at,
    rr.car_name,
    rr.track_name,
    rr.irating_delta,
    v.irating_after,
    v.irating_before
  from public.v_season_calendar sc
  join public.race_results rr
    on rr.raced_at >= sc.season_start
   and rr.raced_at < sc.season_start + interval '84 days'
  join public.v_race_results_irating v
    on v.id = rr.id
),
week_agg as (
  select
    season_id,
    rating_category,
    week_number,
    count(*) as races,
    array_agg(distinct car_name) as cars,
    array_agg(distinct track_name) as tracks,
    (array_agg(irating_before order by raced_at))[1] as irating_first_before,
    (array_agg(irating_after order by raced_at desc))[1] as irating_last_after,
    min(irating_after) as irating_min,
    max(irating_after) as irating_max,
    count(*) as rating_changes
  from week_races
  where week_number between 1 and 12
  group by season_id, rating_category, week_number
)
select
  g.season_id,
  g.season_name,
  g.rating_category,
  g.week_number,
  g.week_start,
  g.week_end,
  wa.irating_first_before as irating_before_week,
  wa.irating_first_before as irating_first,
  coalesce(wa.irating_last_after, wa.irating_first_before) as irating_end_of_week,
  case when wa.irating_last_after is not null and wa.irating_first_before is not null
    then wa.irating_last_after - wa.irating_first_before
    else 0
  end as weekly_delta,
  wa.irating_min,
  wa.irating_max,
  coalesce(wa.rating_changes, 0) as rating_changes,
  coalesce(wa.races, 0) as races,
  coalesce(wa.cars, array[]::text[]) as cars,
  coalesce(wa.tracks, array[]::text[]) as tracks
from grid g
left join week_agg wa
  on wa.season_id = g.season_id
 and wa.rating_category = g.rating_category
 and wa.week_number = g.week_number;

comment on view public.v_season_weekly_irating is
  'Weekly iRating and race activity, sourced from race_results (irstats.com) instead of driving_sessions/rating_history. iRating values are exact (reconstructed via v_race_results_irating), not the rounded irstats display value.';

create or replace view public.v_historical_performance as
with classified as (
  select
    rr.category as rating_category,
    case when rr.car_name = 'Dallara P217' then 'LMP2' else cg.name end as car_class,
    rr.car_name as car,
    rr.track_name as track,
    v.irating_after - v.irating_before as delta_irating
  from public.race_results rr
  join public.v_race_results_irating v on v.id = rr.id
  left join public.car_group_members cgm on cgm.car_id = rr.car_id
  left join public.car_groups cg on cg.id = cgm.car_group_id
)
select
  rating_category,
  car_class,
  car,
  track,
  count(*) as races,
  sum(delta_irating) as delta_irating,
  avg(delta_irating) as avg_delta_irating
from classified
group by rating_category, car_class, car, track;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push --dry-run` then `npx supabase db push`.
Expected: applies cleanly. Since Task 7's backfill should already be complete, spot-check with:

```sql
select * from public.v_season_weekly_irating where races > 0 order by season_id desc, week_number desc limit 5;
select * from public.v_historical_performance order by races desc limit 5;
```

Expected: non-empty, plausible rows (e.g. Super Formula SF23 - Honda with a large race count, matching the "Most Raced" list seen on the irstats profile page).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260824010000_race_results_views.sql
git commit -m "feat: rewrite dashboard views to source from race_results"
```

---

### Task 9: Update `app/api/dashboard/overview/route.ts`

**Files:**
- Modify: `app/api/dashboard/overview/route.ts:386-411` (the `official_series_results`, `driving_sessions`, `v_race_irating_candidates`, `laps`, `cars`, `tracks` queries and the code that builds the `races`/`officialResults` response fields built from them)

**Interfaces:**
- Consumes: `v_season_summary`, `v_season_category_summary`, `v_season_weekly_irating`, `v_historical_performance` (Task 8, same column names as before — no change needed to the `Promise.all([...])` block at lines 172–271 or its types at lines 4–63).
- Produces: unchanged top-level response shape (`race.series`, `race.startPosition`, `race.finishPosition` now populated with real values instead of always `null`; `officialResults` section removed — wins are now folded directly into `kpis.formula.wins`/`kpis.sports.wins` via `race_results`, no separate manual-snapshot section).

This task only touches the section of the file that queries `official_series_results`/`driving_sessions`/`v_race_irating_candidates`/`laps`/`cars`/`tracks` (confirmed at lines 386–411) and whatever code later in the file (`winsFor` at line 438, the `races` array construction, and the `officialResults`/`featureAvailability` response keys around lines 634–812) derives from those query results. Read the file first to find the exact current line ranges for `winsFor`, the races-array-building code, and the response object before editing, since line numbers may have shifted slightly since the Explore pass that reported them — the goal is a faithful replacement of behavior, not a blind line-range overwrite.

- [ ] **Step 1: Read the current file around the sections to change**

Run: Read `app/api/dashboard/overview/route.ts` fully once (it's 869 lines) to get exact current line numbers for: the `official_series_results`/`driving_sessions`/`v_race_irating_candidates`/`laps`/`cars`/`tracks` queries; the `winsFor` function; the races-array construction; the `officialResults` and `featureAvailability` keys in the final response object.

- [ ] **Step 2: Replace the `driving_sessions`/`v_race_irating_candidates`/`laps`/`cars`/`tracks`/`official_series_results` queries with a single `race_results` query**

Replace the block of `.from(...)` calls identified in Step 1 (originally at lines 386–411) with:

```typescript
const { data: currentSeasonRaces, error: racesError } = await supabaseAdmin
  .from("v_race_results_irating")
  .select(
    "irstats_race_id, raced_at, series_name, track_name, car_name, category, grid_position, finish_position, position_change, fastest_lap_time, irating_after, irating_before"
  )
  .eq("driver_id", driver.id)
  .gte("raced_at", currentSeasonStart) // reuse the same variable already computed from v_season_calendar/current season lookup elsewhere in the file
  .lt("raced_at", currentSeasonEnd)
  .order("raced_at", { ascending: false });
if (racesError) throwSupabaseError("v_race_results_irating", racesError);
```

Note: `currentSeasonStart`/`currentSeasonEnd` must be resolved from `v_season_calendar` (Task 8) for the current season — if the file doesn't already have these as variables, add a query `supabaseAdmin.from("v_season_calendar").select("season_id, season_name, season_start").order("season_id", { ascending: false }).limit(1).single()` for the current season, and compute `currentSeasonEnd` as `season_start + 84 days` in JS (`new Date(new Date(season_start).getTime() + 84 * 86_400_000).toISOString()`), mirroring the `interval '84 days'` window used in the SQL views.

- [ ] **Step 3: Rewrite the races-array construction to use `currentSeasonRaces`**

Replace whatever code previously mapped `driving_sessions`/`laps`/`cars`/`tracks` join results into the `races` response array with:

```typescript
const races = (currentSeasonRaces ?? []).map((row) => ({
  id: row.irstats_race_id,
  startedAt: row.raced_at,
  endedAt: row.raced_at,
  durationMinutes: null,
  delta: row.irating_after - row.irating_before,
  ratingCategory: row.category,
  car: row.car_name,
  track: row.track_name,
  bestLap: row.fastest_lap_time,
  series: row.series_name,
  startPosition: row.grid_position,
  finishPosition: row.finish_position,
}));
```

- [ ] **Step 4: Replace `winsFor` to compute wins from `currentSeasonRaces` instead of `official_series_results`**

Replace the `winsFor(seasonId, category)` function body with a version that counts `finish_position === 1` from the already-fetched race rows for the requested season+category — since `currentSeasonRaces` (Step 2) only covers the *current* season, and `winsFor` is called for both current and previous season (confirmed by the Explore report: "filtered by driver_id and season_id in (current, previous)"), fetch **both** seasons' races in Step 2 instead of just the current one:

```typescript
const winsBySeasonCategory = new Map<string, number>();
for (const row of currentSeasonRaces ?? []) {
  if (row.finish_position !== 1) continue;
  const key = `${normalizeSeasonId(/* season id for row.raced_at, resolved via v_season_calendar */)}:${row.category}`;
  winsBySeasonCategory.set(key, (winsBySeasonCategory.get(key) ?? 0) + 1);
}

function winsFor(seasonId: string | number, category: string) {
  return winsBySeasonCategory.get(`${normalizeSeasonId(seasonId)}:${category}`) ?? 0;
}
```

Since determining which season a race falls into requires the full `v_season_calendar` (not just current/previous), change Step 2's query to fetch races for **both** current and previous season (`.gte("raced_at", previousSeasonStart).lt("raced_at", currentSeasonEnd)`), and resolve each row's season by comparing `raced_at` against the fetched `v_season_calendar` rows in JS (find the calendar row where `season_start <= raced_at < season_start + 84 days`).

- [ ] **Step 5: Remove the `officialResults` response key and `OfficialResultsUpload`/`OfficialResultsPanel` dependency**

In the final `NextResponse.json({...})` object, delete the `officialResults: { lastCapturedAt, series: [...] }` key entirely — wins are now always live from `race_results`, so there's nothing to manually capture or display as a "last captured" snapshot. Update `featureAvailability.winsReason` (if it references the manual snapshot process) to something reflecting the new automatic source, e.g. `"Wins vêm automaticamente de irstats.com, sem necessidade de captura manual."`.

- [ ] **Step 6: Manually verify the endpoint**

Run: `npm run dev`, then `curl http://localhost:3000/api/dashboard/overview | jq '.races[0], .kpis.formula.wins'`
Expected: `.races[0].series` and `.races[0].startPosition`/`.finishPosition` are non-null (previously always `null` per the Explore report), and `.kpis.formula.wins.current` is a plausible number (compare against the irstats profile page's Formula Car wins count for the current season).

- [ ] **Step 7: Commit**

```bash
git add app/api/dashboard/overview/route.ts
git commit -m "feat: source dashboard overview races/wins from race_results"
```

---

### Task 10: Update `app/api/telemetry/active-week/route.ts`

**Files:**
- Modify: `app/api/telemetry/active-week/route.ts:55-97`

**Interfaces:**
- Consumes: `race_results` table (Task 5).
- Produces: same response shape as today (`{ status: "ok", week: WeekRow | null, combinations: [...] }`) — only how `week` and the car/track pairs are determined changes, not what downstream code (`components/ActiveWeekTelemetry.tsx`) receives.

- [ ] **Step 1: Replace the `v_season_weekly_irating` time-window query and the `driving_sessions` query**

Replace lines 55–89 (the `weekRows` query through the `sessions`/`pairCounts` construction, confirmed by the Explore report) with:

```typescript
export async function GET() {
  try {
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (driverError || !driver) throw new Error("Driver não encontrado no Supabase");

    const { data: latestRace, error: latestRaceError } = await supabaseAdmin
      .from("race_results")
      .select("raced_at, season_week, category")
      .eq("driver_id", driver.id)
      .order("raced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRaceError) throw latestRaceError;
    if (!latestRace) {
      return NextResponse.json({ status: "ok", week: null, combinations: [] });
    }

    const { data: calendarRow, error: calendarError } = await supabaseAdmin
      .from("v_season_calendar")
      .select("season_id, season_name, season_start")
      .lte("season_start", latestRace.raced_at)
      .order("season_start", { ascending: false })
      .limit(1)
      .single();
    if (calendarError) throw calendarError;

    const weekNumber = latestRace.season_week ?? 1;
    const weekStart = new Date(new Date(calendarRow.season_start).getTime() + (weekNumber - 1) * 7 * 86_400_000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const week: WeekRow = {
      season_id: String(calendarRow.season_id),
      season_name: calendarRow.season_name,
      week_number: weekNumber,
      week_start: weekStart.toISOString(),
      week_end: weekEnd.toISOString(),
    };

    const { data: weekRaces, error: weekRacesError } = await supabaseAdmin
      .from("race_results")
      .select("car_id, track_id")
      .eq("driver_id", driver.id)
      .gte("raced_at", week.week_start)
      .lt("raced_at", week.week_end)
      .not("car_id", "is", null)
      .not("track_id", "is", null);
    if (weekRacesError) throw weekRacesError;

    const pairCounts = new Map<string, { carId: number; trackId: number; sessions: number }>();
    for (const race of weekRaces ?? []) {
      if (typeof race.car_id !== "number" || typeof race.track_id !== "number") continue;
      const key = `${race.car_id}:${race.track_id}`;
      const current = pairCounts.get(key);
      if (current) current.sessions += 1;
      else pairCounts.set(key, { carId: race.car_id, trackId: race.track_id, sessions: 1 });
    }
```

Leave the rest of the function (from the `const pairs = [...pairCounts.values()];` line onward, which resolves car/track names and fetches Garage61 laps for telemetry) unchanged — it already consumes `pairCounts` generically and doesn't care that the source changed from `driving_sessions` to `race_results`.

Note: `car_id`/`track_id` on `race_results` can be `null` when the name-match in Task 6 failed to find a catalog entry — the `.not("car_id", "is", null)` filter above already excludes those rows from telemetry pairing, same defensive behavior as the original code had for `driving_sessions`.

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, then `curl http://localhost:3000/api/telemetry/active-week | jq`
Expected: `week` is non-null and matches the most recent race's actual week/season; `combinations` lists the car+track pair(s) from this week's `race_results` rows, matching what's visible in the app's "ACTIVE WEEK TELEMETRY" section before this change (same cars/tracks, just resolved from the new source).

- [ ] **Step 3: Commit**

```bash
git add app/api/telemetry/active-week/route.ts
git commit -m "feat: derive active week/car-track pairs from race_results"
```

---

### Task 11: Update `app/api/setup/inventory/route.ts`

**Files:**
- Modify: `app/api/setup/inventory/route.ts:8-22`

**Interfaces:**
- Consumes: `race_results` table (Task 5), `v_season_calendar` (Task 8).
- Produces: same `context()` return shape (`{ driverId, seasonId, seasonName }`) and same car/track pairing behavior, sourced from `race_results` instead of `driving_sessions`.

- [ ] **Step 1: Replace the `driving_sessions` query in the `GET` handler**

Replace line 22 (`supabaseAdmin.from("driving_sessions").select("car_id,track_id,started_at,session_type").eq("driver_id", driverId).eq("season_id", seasonId).eq("session_type", 3)`) with:

`race_results` has no `season_id` column — season is derived from `raced_at`, not stored. Resolve the current season's date range via `v_season_calendar` inside `context()` and filter `race_results` by `raced_at` range instead. Update `context()` (lines 8–16) to also return the season's date bounds:

```typescript
async function context() {
  const { data: driver, error: driverError } = await supabaseAdmin.from("drivers").select("id").order("updated_at", { ascending: false }).limit(1).single();
  if (driverError || !driver) throw new Error("Piloto não encontrado");
  const { data: current, error: seasonError } = await supabaseAdmin
    .from("v_season_calendar")
    .select("season_id, season_name, season_start")
    .order("season_start", { ascending: false })
    .limit(1)
    .single();
  if (seasonError || !current) throw new Error("Season atual não encontrada");
  const seasonEnd = new Date(new Date(current.season_start).getTime() + 84 * 86_400_000).toISOString();
  return { driverId: driver.id, seasonId: String(current.season_id), seasonName: current.season_name, seasonStart: current.season_start, seasonEnd };
}
```

Then in `GET`, replace the `context()` destructure and the `driving_sessions` query:

```typescript
const { driverId, seasonId, seasonName, seasonStart, seasonEnd } = await context();
const [sessionsResult, setupsResult, lapsResult] = await Promise.all([
  supabaseAdmin.from("race_results").select("car_id,track_id,raced_at").eq("driver_id", driverId).gte("raced_at", seasonStart).lt("raced_at", seasonEnd),
  supabaseAdmin.from("setup_files").select("id,car_id,track_id,source,setup_kind,filename,file_size,created_at,decoded_at,decoder").eq("driver_id", driverId).eq("season_id", seasonId).order("created_at", { ascending: false }),
  supabaseAdmin.from("laps").select("id,car_id,track_id,can_view_setup,garage61_payload").eq("driver_id", driverId).limit(5000),
]);
```

Then in the `pairMap` construction that follows (line ~30 onward, iterating `sessionsResult.data`), the field name `row.started_at` (if referenced anywhere for `lastRace`) becomes `row.raced_at` — check the code between the query and the response for any reference to `started_at` and rename it to `raced_at` to match the new column.

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, then `curl http://localhost:3000/api/setup/inventory | jq '.pairs'` (or whatever the actual response key is — check the file's response object)
Expected: same car+track pairs as before this change, for the current season (cross-check against the irstats "Most Raced" car+track list filtered to recent activity, or against `race_results` rows directly: `select distinct car_name, track_name from race_results where raced_at >= '<season_start>';`).

- [ ] **Step 3: Commit**

```bash
git add app/api/setup/inventory/route.ts
git commit -m "feat: derive setup lab season car-track pairs from race_results"
```

---

### Task 12: Update the hourly cron

**Files:**
- Modify: `app/api/cron/hourly-sync/route.ts`

**Interfaces:**
- Consumes: `GET /api/sync/irstats?mode=incremental` (Task 6).
- Produces: same `GET` handler contract (Bearer `CRON_SECRET`, returns `{status, ...}`), now calling the irstats sync instead of session/rating-match sync.

- [ ] **Step 1: Replace the sync steps**

Replace the full file with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { POST as syncCatalogAndStatistics } from "@/app/api/sync/all/route";
import { GET as syncIrstatsIncremental } from "@/app/api/sync/irstats/route";

async function readStep(name: string, response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(`${name}: ${result.message ?? response.statusText}`);
  return result;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  try {
    const catalog = await readStep("catalog", await syncCatalogAndStatistics());
    const irstats = await readStep("irstats", await syncIrstatsIncremental(request));
    return NextResponse.json({ status: "ok", catalog, irstats });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

Note: `syncCatalogAndStatistics` (from `sync/all`) is kept because it upserts the `drivers` row, the `cars`/`tracks` catalog (needed for Task 6's name-matching), and — critically — the current `ratings` snapshot that Task 8's `v_race_results_irating` view uses as its exact anchor. `syncIrstatsIncremental` is called with `request` forwarded since `app/api/sync/irstats/route.ts`'s `GET` reads the `CRON_SECRET` header and the `mode` query param from it directly (defaults to `incremental` when absent, which is correct here).

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, then `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/hourly-sync | jq`
Expected: `{"status":"ok","catalog":{...},"irstats":{"status":"ok","imported":0,"skipped":<N>}}` — `imported: 0` is expected here since Task 7's backfill already covers everything up to now; skipped should be > 0 confirming it correctly recognized existing races.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/hourly-sync/route.ts
git commit -m "feat: run irstats incremental sync in the hourly cron, drop session/rating-match steps"
```

---

### Task 13: Remove the manual official-results UI from the dashboard

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing new — this task only removes now-dead UI, since Task 9 removed `officialResults` from the API response.

- [ ] **Step 1: Read `app/page.tsx` to find the exact current lines for the `OfficialResultsUpload` import and usage**

Run: Read `app/page.tsx` fully (320 lines) to confirm the current import statement and the JSX usage (reported by the Explore pass as around line 218, with `onImported={loadDashboard}` — confirm exact line before editing since prior tasks may have caused minor shifts, though this file itself isn't touched by Tasks 9–12).

- [ ] **Step 2: Remove the import and the JSX block**

Delete the `import ... from "@/components/OfficialResultsPanel"` line, and delete the `<OfficialResultsUpload onImported={loadDashboard} />` (or equivalently named) JSX element from the render tree. Also remove the `officialResults` field from the local `DashboardData` type (lines 42–87 per the Explore report) if it's still declared there, since Task 9 removed it from the API response.

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000` in the browser preview.
Expected: page loads with no console errors about missing `officialResults`/undefined props; the manual "upload official results" UI element is gone; KPI wins cards still show correct numbers (now sourced automatically).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: remove manual official-results upload UI, wins are now automatic"
```

---

### Task 14: End-to-end verification in the browser

**Files:** none (verification only)

**Interfaces:** none — this task exercises the full stack built in Tasks 1–13.

- [ ] **Step 1: Start the dev server and load the dashboard**

Use the `preview_start` tool with the project's dev server configuration (create `.claude/launch.json` if it doesn't exist, pointing at `npm run dev` on the Next.js default port), then navigate to `/`.

- [ ] **Step 2: Verify KPIs, races table, and rankings**

Use `read_page`/`get_page_text` on the dashboard to confirm: iRating KPI cards show plausible values (compare against `https://irstats.com/driver/958741` category table); the wins KPI cards show non-zero values without the old manual-upload UI; the race table shows a `series` column populated (previously always empty); the GT3/IMSA/track rankings still render non-empty (confirms `car_id`/`track_id` resolution in Task 6 and the `car_group_members` join in Task 8's `v_historical_performance` worked).

- [ ] **Step 3: Verify the Telemetry and Setup pages still load**

Navigate to `/telemetry` and the Setup tab. Confirm the active week's car+track selector and the Setup Lab's car+track inventory both populate (proving Tasks 10–11 correctly wired `race_results` into the two routes that previously used `driving_sessions`).

- [ ] **Step 4: Take a screenshot and report**

Use `computer` (`action: "screenshot"`) to capture the dashboard for a final visual check, and report any discrepancy against the pre-migration numbers (e.g. total wins should match the 183/44/... totals seen on the irstats profile page, since `race_results` now covers full history via Task 7's backfill).

No commit for this task — it's verification only. If any step surfaces a bug, fix it in the relevant task's file and amend that task's commit (or add a new small fix commit), then re-verify from Step 1.
