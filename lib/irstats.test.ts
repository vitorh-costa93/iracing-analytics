// lib/irstats.test.ts
import { describe, expect, it } from "vitest";
import { parseRaceListPage, parseRaceDetailPage, fetchIrstatsPage } from "./irstats";

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

const DETAIL_PAGE_FIXTURE = `
<main>
  <h1 class="lb-title mt-1 mb-1">Formula B - Super Formula Series</h1>
  <p class="lb-sub mb-3">Autodromo Nazionale Monza (Grand Prix)
    ·Week 10</p>
  <span class="race-stat"><b>SoF</b> 4487</span>
  <span class="race-stat"><b>Drivers</b> 16</span>
  <span class="race-stat"><b>Laps</b> 24</span>
  <span class="race-stat"><b>Incidents</b> 80 <span class="text-muted">(5.0/driver)</span></span>
  <span class="race-stat"><b>Category</b>Formula Car</span>
  <span class="race-stat"><b>Date</b> Aug 21, 2026 · 20:30 UTC</span>
  <span class="race-stat"><i class="bi bi-stopwatch-fill text-primary"></i> <b>Fastest Lap</b>
    <a href="/driver/684660" class="link-black-underlined">Kevin A Foster</a>
    <span class="text-muted">1:26.253</span>
  </span>
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
        <td class="text-center fw-semibold"></td>
        <td>Jack David Spickett</td>
        <td class="text-center">A 2.11</td>
        <td class="text-center">6.5k<small class="text-success">+12</small></td>
        <td class="text-center car-cell">Super Formula SF23 - Honda</td>
        <td class="text-center">6</td>
        <td class="text-center">+3</td>
        <td class="text-center">24</td>
        <td class="text-center d-none d-lg-table-cell">0</td>
        <td class="text-center">1:27.259</td>
        <td class="text-center">5</td>
        <td class="text-center d-none d-lg-table-cell">217</td>
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
      trackConfig: "Grand Prix",
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
      raceFastestLapTime: "1:26.253",
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

  it("extracts trackConfig from the parenthesized layout in the track/week line", () => {
    const result = parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Vitor Hugo Da Costa");
    expect(result.trackConfig).toBe("Grand Prix");
  });

  it("extracts the race's overall fastest lap (not the named driver's own) from the Fastest Lap race-stat block", () => {
    const result = parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Vitor Hugo Da Costa");
    // Kevin A Foster set 1:26.253, the fastest in the race; Vitor's own best in this fixture is
    // 1:27.305 — confirms this reads the race-wide stat, not the queried driver's row.
    expect(result.raceFastestLapTime).toBe("1:26.253");
    expect(result.fastestLapTime).toBe("1:27.305");
  });

  it("returns null raceFastestLapTime when the Fastest Lap block is absent", () => {
    const noFastestLap = DETAIL_PAGE_FIXTURE.replace(
      /<span class="race-stat"><i class="bi bi-stopwatch-fill text-primary"><\/i> <b>Fastest Lap<\/b>[\s\S]*?<\/span>\s*<\/span>/,
      ""
    );
    const result = parseRaceDetailPage(noFastestLap, "Vitor Hugo Da Costa");
    expect(result.raceFastestLapTime).toBeNull();
  });

  it("treats the em-dash placeholder in the Fastest column as null, not a literal dash", () => {
    const noLap = DETAIL_PAGE_FIXTURE.replace(
      '<td class="text-center">1:27.305</td>',
      '<td class="text-center">—</td>'
    );
    const result = parseRaceDetailPage(noLap, "Vitor Hugo Da Costa");
    expect(result.fastestLapTime).toBeNull();
  });

  it("treats an unsigned iRating delta as positive", () => {
    const unsigned = DETAIL_PAGE_FIXTURE.replace(
      '<small class="text-success">+73</small>',
      '<small class="text-success">73</small>'
    );
    const result = parseRaceDetailPage(unsigned, "Vitor Hugo Da Costa");
    expect(result.iratingDelta).toBe(73);
  });

  it("parses a Unicode minus sign (U+2212) delta as negative", () => {
    const unicodeMinus = DETAIL_PAGE_FIXTURE.replace(
      '<small class="text-danger">-46</small>',
      '<small class="text-danger">−46</small>'
    );
    const result = parseRaceDetailPage(unicodeMinus, "Noddy Emel");
    expect(result.iratingDelta).toBe(-46);
  });

  it("throws when the named driver is not in the results table", () => {
    expect(() => parseRaceDetailPage(DETAIL_PAGE_FIXTURE, "Nobody Here")).toThrow();
  });

  it("throws when the category text is not a recognized value", () => {
    const badCategory = DETAIL_PAGE_FIXTURE.replace(">Formula Car<", ">Nascar<");
    expect(() => parseRaceDetailPage(badCategory, "Vitor Hugo Da Costa")).toThrow();
  });

  it("accepts the ROAD wallet even when its label has extra whitespace", () => {
    const road = DETAIL_PAGE_FIXTURE.replace(">Formula Car<", ">  Road  <");
    expect(parseRaceDetailPage(road, "Vitor Hugo Da Costa").category).toBe("road");
  });

  it("locates columns by header text, not fixed position, so a multiclass race's extra Cls column doesn't shift every field", () => {
    // Multiclass races (e.g. IMSA: GTP/LMP2/GT3 sharing one race) insert a "Cls" column right
    // after "Pos", shifting every subsequent column one to the right. A fixed-index parser reads
    // the wrong cell for every field and — since the driver row is found by matching the *name*
    // cell's text — fails to find the driver at all, throwing on every real multiclass race.
    const multiclass = `
      <main>
        <h1 class="lb-title mt-1 mb-1">IMSA iRacing Series - Fixed</h1>
        <p class="lb-sub mb-3">Autodromo Nazionale Monza (Grand Prix)
          ·Week 7</p>
        <span class="race-stat"><b>SoF</b> 3111</span>
        <span class="race-stat"><b>Category</b> Sports Car</span>
        <span class="race-stat"><b>Date</b> Aug 3, 2026 · 21:45 UTC</span>
        <table>
          <thead>
            <tr><th>Pos</th><th>Cls</th><th>Driver</th><th>License</th><th>iR</th><th>Car</th><th>Grid</th><th>+/−</th><th>Laps</th><th>Led</th><th>Fastest</th><th>Inc</th><th>Pts</th></tr>
          </thead>
          <tbody>
            <tr>
              <td class="text-center fw-semibold"></td>
              <td class="text-center"></td>
              <td>Dylan W.</td>
              <td class="text-center">A 2.50</td>
              <td class="text-center">3.1k<small class="text-success">+108</small></td>
              <td class="text-center car-cell">Ferrari 499P</td>
              <td class="text-center">1</td>
              <td class="text-center">0</td>
              <td class="text-center">22</td>
              <td class="text-center d-none d-lg-table-cell">22</td>
              <td class="text-center fw-semibold text-primary">1:33.901</td>
              <td class="text-center">0</td>
              <td class="text-center d-none d-lg-table-cell">194</td>
            </tr>
            <tr>
              <td class="text-center fw-semibold">6</td>
              <td class="text-center">6</td>
              <td>Vitor Hugo Da Costa</td>
              <td class="text-center">A 1.37</td>
              <td class="text-center">3.5k<small class="text-success">+9</small></td>
              <td class="text-center car-cell">Ferrari 499P</td>
              <td class="text-center">3</td>
              <td class="text-center">-3</td>
              <td class="text-center">22</td>
              <td class="text-center d-none d-lg-table-cell">0</td>
              <td class="text-center">1:34.213</td>
              <td class="text-center">11</td>
              <td class="text-center d-none d-lg-table-cell">105</td>
            </tr>
          </tbody>
        </table>
      </main>
    `;
    const result = parseRaceDetailPage(multiclass, "Vitor Hugo Da Costa");
    expect(result.finishPosition).toBe(2);
    expect(result.carName).toBe("Ferrari 499P");
    expect(result.gridPosition).toBe(3);
    expect(result.positionChange).toBe(-3);
    expect(result.iratingDelta).toBe(9);
    expect(result.fastestLapTime).toBe("1:34.213");
    expect(result.incidents).toBe(11);
    expect(result.points).toBe(105);
  });
});

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
