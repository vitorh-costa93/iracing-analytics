import { describe, expect, it } from "vitest";
import { diffSetups, comparativeSummary } from "./setup-diff";
import { explainComparison } from "./setup-explain";
import { plainParameterName, setupDisplayName, shortPairNames } from "./setup-names";

const baseline = [
  { tab: "Chassis", section: "Rear", label: "Rear Wing Angle", metric_value: "6" },
  { tab: "Chassis", section: "Front", label: "ARB Blades", metric_value: "5" },
  { tab: "Chassis", section: "In Car", label: "Brake Pressure Bias", metric_value: "54.0%" },
  { tab: "Chassis", section: "Rear", label: "Ride Height", metric_value: "70 mm" },
];
const apex = [
  { tab: "Chassis", section: "Rear", label: "Rear Wing Angle", metric_value: "8" },
  { tab: "Chassis", section: "Front", label: "ARB Blades", metric_value: "3" },
  { tab: "Chassis", section: "In Car", label: "Brake Pressure Bias", metric_value: "54.0%" },
  { tab: "Chassis", section: "Rear", label: "Ride Height", metric_value: "74 mm" },
];

describe("setupDisplayName / plainParameterName", () => {
  it("tira pasta de season e extensão do nome do setup", () => {
    expect(setupDisplayName("26S4\\TS 26S4 SF23 W01 Interlagos Race")).toBe("TS 26S4 SF23 W01 Interlagos Race");
    expect(setupDisplayName("P1Doks_296GT3_Silverstone_R.sto")).toBe("P1Doks 296GT3 Silverstone R");
  });
  it("traduz rótulos do iRacing para nomes de piloto com eixo e lado", () => {
    expect(plainParameterName("ARB Blades", "Front")).toBe("Barra estabilizadora dianteira");
    expect(plainParameterName("Spring Rate", "Left Rear")).toBe("Mola traseira esquerda");
    expect(plainParameterName("Brake Pressure Bias", "In Car Dials")).toBe("Distribuição de freio (brake bias)");
    expect(plainParameterName("Toe-in", "Right Front")).toBe("Convergência dianteira direita (toe)");
    expect(plainParameterName("Tire Compound", "Tires")).toBe("Composto do pneu");
  });
});

describe("explainComparison", () => {
  const changes = diffSetups(baseline, apex);
  const explanation = explainComparison(changes, "Baseline", "Apex");

  it("resume a diferença com os nomes dos setups, sem 'Setup A/B'", () => {
    expect(explanation.oneLiner).toContain("Apex");
    expect(explanation.oneLiner).toContain("Baseline");
    expect(explanation.oneLiner).toMatch(/curva rápida/);
    expect(explanation.oneLiner).toMatch(/reta/);
    expect(explanation.oneLiner).not.toMatch(/Setup [AB]/);
  });

  it("descreve entrada, meio e saída e diz quando usar cada um", () => {
    expect(explanation.feel.mid).toContain("Apex");
    expect(explanation.feel.exit).toMatch(/Baseline anda mais na reta|Apex acelera melhor/);
    expect(explanation.whenToUse).toMatch(/Use o Apex em pistas de curva/);
    expect(explanation.whenToUse).toMatch(/Use o Baseline em pistas de reta longa/);
  });

  it("monta passos de teste específicos e glossário só com termos usados", () => {
    expect(explanation.testSteps[0]).toContain("Baseline");
    expect(explanation.testSteps.length).toBeGreaterThanOrEqual(3);
    const terms = explanation.glossary.map((item) => item.term);
    expect(terms).toEqual(expect.arrayContaining(["Asa", "Barra estabilizadora", "Rake"]));
    expect(terms).not.toContain("Brake bias");
  });

  it("não usa '--' nem 'aba • seção' em nenhum texto", () => {
    const all = [explanation.oneLiner, explanation.whenToUse, ...Object.values(explanation.feel), ...explanation.testSteps, comparativeSummary(changes, "Baseline", "Apex"), ...changes.map((change) => change.explanation)].join(" ");
    expect(all).not.toContain("--");
    expect(all).not.toContain(" • ");
    expect(all).not.toContain(" — ");
  });

  it("brake bias pra frente: freia mais estável e vira menos", () => {
    const bias = explainComparison(diffSetups(
      [{ tab: "Chassis", section: "In Car", label: "Brake Pressure Bias", metric_value: "53%" }],
      [{ tab: "Chassis", section: "In Car", label: "Brake Pressure Bias", metric_value: "56%" }],
    ), "Quali", "Race");
    expect(bias.feel.entry).toMatch(/Race freia mais reto/);
    expect(bias.feel.entry).toMatch(/Quali vira mais fácil/);
    expect(bias.whenToUse).toMatch(/Quali foi feito para classificação e o Race para corrida/);
    expect(bias.glossary[0]).toEqual({ term: "Brake bias", meaning: "quanto do freio vai pra frente" });
  });

  it("ângulo de diferencial maior é MENOS bloqueio (gira mais na entrada)", () => {
    const diff = explainComparison(diffSetups(
      [{ tab: "Drivetrain", section: "Differential", label: "Coast Angle", metric_value: "40" }],
      [{ tab: "Drivetrain", section: "Differential", label: "Coast Angle", metric_value: "60" }],
    ), "A1", "B1");
    expect(diff.scores.entryRotation).toBeGreaterThan(0);
  });

  it("setups iguais: diz que ficam parecidos", () => {
    const same = explainComparison([], "Fixed", "Baseline");
    expect(same.oneLiner).toMatch(/mesmos ajustes/);
    expect(same.feel.entry).toBe("praticamente igual nos dois.");
  });

  it("nomes iguais ganham número para não confundir", () => {
    expect(explainComparison(changes, "fixed", "fixed").oneLiner).toMatch(/fixed \(2\)/);
  });
});

describe("shortPairNames e leituras da sessão", () => {
  it("encurta nomes longos para a parte que os diferencia", () => {
    expect(shortPairNames("TS 26S4 SF23 W01 Interlagos Quali", "TS 26S4 SF23 W01 Interlagos Race")).toEqual(["Quali", "Race"]);
    expect(shortPairNames("fixed", "fixed")).toEqual(["fixed", "fixed"]);
  });
  it("pressão quente, pneu restante e folga da mola não contam como ajuste", () => {
    const changes = diffSetups(
      [{ tab: "Tires", section: "Left Front", label: "Last Hot Pressure", metric_value: "131 kPa" }, { tab: "Chassis", section: "Front", label: "Heave Spring Gap", metric_value: "11.3 mm" }],
      [{ tab: "Tires", section: "Left Front", label: "Last Hot Pressure", metric_value: "138 kPa" }, { tab: "Chassis", section: "Front", label: "Heave Spring Gap", metric_value: "10.5 mm" }],
    );
    expect(changes.map((change) => [change.label, change.settable])).toEqual([["Last Hot Pressure", false], ["Heave Spring Gap", false]]);
    expect(plainParameterName("Heave Spring Gap", "Front")).toBe("Folga da mola central dianteira");
    expect(explainComparison(changes, "A1", "B1").glossary).toEqual([]);
  });
});

describe("comparativeSummary", () => {
  it("fala com os nomes dos setups e sem jargão de aba", () => {
    const summary = comparativeSummary(diffSetups(baseline, apex), "Baseline", "Apex");
    expect(summary.startsWith("Do Baseline para o Apex mudam 3 ajustes")).toBe(true);
    expect(summary).toContain("O Apex usa mais asa");
  });
});
