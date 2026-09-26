import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./engineer-prompt";
import { indexRows, parseProposalBlock, resolveProposal } from "./engineer-proposal";

const rows = indexRows([
  { tab: "Chassis", section: "Front", label: "ARB Blades", metric_value: "5" },
  { tab: "Chassis", section: "Rear", label: "Spring Rate", metric_value: "180 N/mm" },
]);

describe("buildSystemPrompt", () => {
  it("sempre traz carro/pista e as regras inegociáveis (direção, cliques, .sto, fase da curva)", () => {
    const prompt = buildSystemPrompt({ carName: "McLaren 720S GT3 EVO", trackName: "Spa-Francorchamps", activeSetup: null, appliedProposal: null, cited: [] });
    expect(prompt).toContain("McLaren 720S GT3 EVO");
    expect(prompt).toContain("Spa-Francorchamps");
    expect(prompt).toContain("aumente");
    expect(prompt).toContain("diminua");
    expect(prompt).toContain(".sto original NÃO é reescrito");
    expect(prompt).toMatch(/pergunte isso primeiro/);
    expect(prompt).toMatch(/Nunca invente um valor contínuo/);
    expect(prompt).toMatch(/nunca "Setup A" ou "Setup B"/);
  });

  it("não usa '--' nas instruções, para o modelo não copiar", () => {
    const prompt = buildSystemPrompt({ carName: "Carro", trackName: "Pista", activeSetup: { name: "Baseline", rows }, appliedProposal: null, cited: [] });
    expect(prompt).not.toContain("--");
  });

  it("inclui a tabela numerada do setup ativo e o protocolo do bloco de proposta", () => {
    const prompt = buildSystemPrompt({ carName: "Carro", trackName: "Pista", activeSetup: { name: "Baseline", rows }, appliedProposal: null, cited: [] });
    expect(prompt).toContain('SETUP ATIVO: "Baseline"');
    expect(prompt).toContain("| p1 | Barra estabilizadora dianteira | ARB Blades (Front) | 5 |");
    expect(prompt).toContain("| p2 | Mola traseira | Spring Rate (Rear) | 180 N/mm |");
    expect(prompt).toContain("<proposta>");
    expect(prompt).toContain("</proposta>");
  });

  it("sem setup decodificado: diz isso e proíbe o bloco", () => {
    const prompt = buildSystemPrompt({ carName: "Carro", trackName: "Pista", activeSetup: null, appliedProposal: null, cited: [] });
    expect(prompt.toLowerCase()).toContain("não há setup decodificado");
    expect(prompt).toContain("Não escreva bloco de proposta");
  });

  it("descreve a proposta que o piloto está rodando e os setups citados", () => {
    const applied = resolveProposal(parseProposalBlock('{"mudancas":[{"id":"p1","direcao":"diminuir"}]}'), rows, { id: "s1", name: "Baseline" });
    const prompt = buildSystemPrompt({
      carName: "Carro", trackName: "Pista", activeSetup: { name: "Baseline", rows }, appliedProposal: applied,
      cited: [{ name: "Estável", summary: "Do Baseline para o Estável mudam 1 ajuste.", changes: [{ tab: "Chassis", section: "Rear", label: "Spring Rate", before: "180 N/mm", after: "160 N/mm", explanation: "", category: "springs", actionable: true, settable: true, numericDelta: -20 }] }],
    });
    expect(prompt).toContain("Barra estabilizadora dianteira: 5 → 4");
    expect(prompt).toContain('O piloto citou o setup "Estável"');
    expect(prompt).toContain("| Mola traseira | 180 N/mm | 160 N/mm |");
  });
});
