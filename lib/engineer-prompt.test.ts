import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./engineer-prompt";

describe("buildSystemPrompt", () => {
  it("always includes the car/track header and the non-negotiable framing rules", () => {
    const prompt = buildSystemPrompt({ carName: "McLaren 720S GT3 EVO", trackName: "Spa-Francorchamps", primarySetup: null, diff: null });
    expect(prompt).toContain("McLaren 720S GT3 EVO");
    expect(prompt).toContain("Spa-Francorchamps");
    expect(prompt).toContain("aumente");
    expect(prompt).toContain("diminua");
    expect(prompt).toContain(".sto");
  });

  it("includes the primary setup's decoded parameters as a table when provided", () => {
    const prompt = buildSystemPrompt({
      carName: "McLaren 720S GT3 EVO",
      trackName: "Spa-Francorchamps",
      primarySetup: { filename: "race-setup.sto", rows: [{ tab: "Suspensão", section: "Rear", label: "Spring Rate", metric_value: "180 N/mm" }] },
      diff: null,
    });
    expect(prompt).toContain("race-setup.sto");
    expect(prompt).toContain("Spring Rate");
    expect(prompt).toContain("180 N/mm");
  });

  it("includes the structural diff narrative and changed parameters when two setups are compared, instead of the single-setup table", () => {
    const prompt = buildSystemPrompt({
      carName: "McLaren 720S GT3 EVO",
      trackName: "Spa-Francorchamps",
      primarySetup: { filename: "ignored-when-diff-present.sto", rows: [{ tab: "Suspensão", section: "Rear", label: "Spring Rate", metric_value: "180 N/mm" }] },
      diff: {
        baseLabel: "setup-a.sto",
        comparisonLabel: "setup-b.sto",
        summary: "O setup B é mais macio na traseira.",
        changes: [{ tab: "Suspensão", section: "Rear", label: "Spring Rate", before: "180 N/mm", after: "160 N/mm", explanation: "Mais aderência mecânica.", category: "spring", actionable: true, settable: true, numericDelta: -20 }],
      },
    });
    expect(prompt).toContain("setup-a.sto");
    expect(prompt).toContain("setup-b.sto");
    expect(prompt).toContain("O setup B é mais macio na traseira.");
    expect(prompt).toContain("180 N/mm");
    expect(prompt).toContain("160 N/mm");
    expect(prompt).not.toContain("ignored-when-diff-present.sto");
  });

  it("says explicitly when there is no decoded setup and no diff to ground answers in", () => {
    const prompt = buildSystemPrompt({ carName: "McLaren 720S GT3 EVO", trackName: "Spa-Francorchamps", primarySetup: null, diff: null });
    expect(prompt.toLowerCase()).toContain("não há setup decodificado");
  });
});
