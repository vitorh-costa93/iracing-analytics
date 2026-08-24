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
