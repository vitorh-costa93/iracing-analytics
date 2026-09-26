import { describe, expect, it } from "vitest";
import { buildReferenceBody } from "./telemetry-reference-response";

const stored = { original_filename: "ref.csv", channels: ["Speed"], sample_count: 100, uploaded_at: "2026-09-20T00:00:00Z" };

describe("buildReferenceBody", () => {
  it("sem referência cadastrada: ok e null", () => {
    expect(buildReferenceBody(null, null)).toEqual({ status: "ok", reference: null });
  });
  it("arquivo indisponível: unavailable com mensagem, sem lançar", () => {
    const body = buildReferenceBody(stored, null);
    expect(body.status).toBe("unavailable");
    expect(body.reference).toBeNull();
  });
  it("com o CSV: devolve a referência", () => {
    const body = buildReferenceBody(stored, "a,b");
    expect(body.status).toBe("ok");
    expect(body.reference).toMatchObject({ filename: "ref.csv", csv: "a,b", sampleCount: 100 });
  });
});
