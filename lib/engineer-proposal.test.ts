import { describe, expect, it } from "vitest";
import { indexRows, latestProposal, parseProposalBlock, resolveProposal, splitEngineerText, steppedValue } from "./engineer-proposal";

const rows = indexRows([
  { tab: "Chassis", section: "Front", label: "ARB Blades", metric_value: "5" },
  { tab: "Chassis", section: "Rear", label: "Rear Wing Angle", metric_value: "6" },
  { tab: "Chassis", section: "Front", label: "Splitter", metric_value: "2" },
  { tab: "Chassis", section: "Left Front", label: "Spring Rate", metric_value: "180 N/mm" },
  { tab: "Chassis", section: "In Car", label: "Brake Pressure Bias", metric_value: "54.5%" },
  { tab: "Dash", section: "Pages", label: "Dash Page", metric_value: "2" },
]);
const block = '{"mudancas":[{"id":"p1","direcao":"diminuir","passos":1,"nome":"Barra dianteira mais macia"},{"id":"p2","direcao":"aumentar","passos":1,"nome":"Asa traseira um pouco maior"}],"o_que_mudou":"Frente mais macia -- asa maior.","por_que":"Você disse que empurra na 3.","melhora":"A 3 vira melhor.","pode_piorar":"Menos reta.","como_testar":"Se soltar na 5, volte a asa."}';
const reply = `Então vale amaciar a frente.\n\n<proposta>${block}</proposta>`;

describe("indexRows", () => {
  it("numera as linhas em ordem, com nome em português, e deixa o painel (dash) de fora", () => {
    expect(rows.map((row) => row.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(rows[0].name).toBe("Barra estabilizadora dianteira");
    expect(rows[1].name).toBe("Asa traseira");
    expect(rows.some((row) => row.label === "Dash Page")).toBe(false);
  });
});

describe("splitEngineerText", () => {
  it("separa o texto exibido do bloco de proposta", () => {
    const { visible, block: found } = splitEngineerText(reply);
    expect(visible).toBe("Então vale amaciar a frente.");
    expect(found).toBe(block);
  });
  it("esconde o começo de uma tag ainda chegando no streaming", () => {
    expect(splitEngineerText("Teste isso.\n<prop").visible).toBe("Teste isso.");
    expect(splitEngineerText("Teste isso.\n```json\n<proposta>{\"mud").visible).toBe("Teste isso.");
  });
  it("deixa texto sem bloco intacto", () => {
    expect(splitEngineerText("Na freada ou no meio da curva?")).toEqual({ visible: "Na freada ou no meio da curva?", block: null });
  });
});

describe("parseProposalBlock", () => {
  it("lê mudanças válidas e limpa '--' dos textos", () => {
    const parsed = parseProposalBlock(block)!;
    expect(parsed.changes).toEqual([
      { id: "p1", steps: -1, hint: "Barra dianteira mais macia" },
      { id: "p2", steps: 1, hint: "Asa traseira um pouco maior" },
    ]);
    expect(parsed.what).toBe("Frente mais macia, asa maior.");
    expect(parsed.what).not.toContain("--");
  });
  it("cai em null com JSON quebrado, sem mudanças ou direção inválida", () => {
    expect(parseProposalBlock('{"mudancas":[{"id":"p1"')).toBeNull();
    expect(parseProposalBlock('{"mudancas":[]}')).toBeNull();
    expect(parseProposalBlock('{"mudancas":[{"id":"p1","direcao":"mexer"}]}')).toBeNull();
    expect(parseProposalBlock(null)).toBeNull();
  });
  it("aceita cerca de código e limita passos a 5 e mudanças a 4", () => {
    const parsed = parseProposalBlock('```json\n{"mudancas":[{"id":"p1","direcao":"aumentar","passos":9},{"id":"p2","direcao":"diminuir"},{"id":"p3","direcao":"diminuir"},{"id":"p4","direcao":"diminuir"},{"id":"p5","direcao":"diminuir"}]}\n```')!;
    expect(parsed.changes).toHaveLength(4);
    expect(parsed.changes[0].steps).toBe(5);
    expect(parsed.changes[1].steps).toBe(-1);
  });
});

describe("steppedValue", () => {
  it("faz a conta só para inteiros sem unidade física (posições, cliques)", () => {
    expect(steppedValue("5", -1)).toBe("4");
    expect(steppedValue("3 clicks", 2)).toBe("5 clicks");
  });
  it("nunca inventa valor contínuo", () => {
    expect(steppedValue("180 N/mm", 1)).toBe("↑ 1 passo");
    expect(steppedValue("54.5%", -2)).toBe("↓ 2 passos");
    expect(steppedValue("-2.5 deg", 1)).toBe("↑ 1 passo");
  });
});

describe("resolveProposal", () => {
  const base = { id: "setup-1", name: "Baseline" };
  it("calcula A → B e monta a tabela por grupo com vizinhos sem mudança", () => {
    const resolved = resolveProposal(parseProposalBlock(block), rows, base)!;
    expect(resolved.baseName).toBe("Baseline");
    expect(resolved.changes.map((change) => [change.name, change.a, change.b])).toEqual([
      ["Barra estabilizadora dianteira", "5", "4"],
      ["Asa traseira", "6", "7"],
    ]);
    const aero = resolved.table.find((group) => group.group === "Aerodinâmica")!;
    expect(aero.rows).toContainEqual({ name: "Splitter", a: "2", b: "2", changed: false });
    expect(resolved.table[0].group).toBe("Suspensão");
  });
  it("ignora ids que não existem e devolve null se nenhum casar", () => {
    expect(resolveProposal(parseProposalBlock('{"mudancas":[{"id":"p99","direcao":"aumentar"}]}'), rows, base)).toBeNull();
  });
  it("acumula sobre a proposta anterior do mesmo setup e remove o que voltou ao original", () => {
    const first = resolveProposal(parseProposalBlock(block), rows, base)!;
    const second = resolveProposal(parseProposalBlock('{"mudancas":[{"id":"p2","direcao":"diminuir","passos":1}]}'), rows, base, first)!;
    expect(second.changes.map((change) => [change.name, change.b])).toEqual([["Barra estabilizadora dianteira", "4"]]);
  });
  it("não acumula sobre proposta de outro setup", () => {
    const first = resolveProposal(parseProposalBlock(block), rows, base)!;
    const other = resolveProposal(parseProposalBlock('{"mudancas":[{"id":"p2","direcao":"diminuir"}]}'), rows, { id: "setup-2", name: "Estável" }, first)!;
    expect(other.changes.map((change) => change.b)).toEqual(["5"]);
  });
});

describe("latestProposal", () => {
  it("pega a proposta mais recente e ignora lixo", () => {
    const resolved = resolveProposal(parseProposalBlock(block), rows, { id: "s", name: "Baseline" })!;
    const messages = [
      { role: "assistant", proposal: resolved },
      { role: "user" },
      { role: "assistant", proposal: { foo: 1 } },
      { role: "assistant" },
    ];
    expect(latestProposal(messages)).toBe(resolved);
    expect(latestProposal([{ role: "assistant" }])).toBeNull();
  });
});
