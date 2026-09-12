import { describe, expect, it } from "vitest";
import { createTrackProjector } from "./track-map";

// 12/09/2026: locks in the fillScale fix -- it used to pick the CONSTRAINING axis's own near-1
// padding headroom (Math.min), making the "default zoom to fill the box" feature a no-op in
// exactly the case it exists for. These fixtures reproduce that case directly.
describe("createTrackProjector fillScale", () => {
  it("stays near 1 when the track's own aspect ratio already matches the box", () => {
    // A roughly square GPS extent in a roughly square box -- neither axis is underused.
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0.01, lon: 0.01 },
    ];
    const projector = createTrackProjector(points, 300, 300, 12, false);
    expect(projector.fillScale).toBeGreaterThanOrEqual(1);
    expect(projector.fillScale).toBeLessThan(1.2);
  });

  it("zooms toward the underused dimension's own fill ratio, not the constraining one", () => {
    // A track whose GPS extent is wide (lon) but barely tall (lat), drawn into a TALL box -- lon
    // constrains the scale (fits width tightly), lat is left mostly empty. Mirrors the real
    // "narrow track in a tall mobile viewport" screenshot this feature was built from.
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0.1 }, // wide in lon, barely moves in lat
    ];
    const projector = createTrackProjector(points, 300, 600, 12, false);
    // Constraining axis (lon/X) only has its own padding headroom (~300/276 ≈ 1.09); the
    // underused axis (lat/Y) has far more room (~600/small drawHeight). fillScale must reflect
    // the underused axis, not collapse to the constraining axis's near-1 ratio.
    expect(projector.fillScale).toBeGreaterThan(1.5);
  });

  it("caps the default zoom so an extreme aspect-ratio mismatch doesn't crop most of the track away", () => {
    // Nearly a straight line in lat, in a tall box -- the underused (lat/Y) axis's own fill ratio
    // would be enormous uncapped; a sane default zoom still leaves room to see context.
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0.00001, lon: 0.1 },
    ];
    const projector = createTrackProjector(points, 300, 600, 12, false);
    expect(projector.fillScale).toBeLessThanOrEqual(2.5);
  });
});
