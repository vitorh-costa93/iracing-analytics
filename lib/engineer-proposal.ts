// Proposta estruturada do engenheiro (Setup Lab, redesign etapa 6).
//
// A resposta do chat é texto livre em streaming. Para o painel A/B ("O que mudou") o engenheiro é
// instruído a terminar, SÓ quando sugerir uma mudança concreta, com um bloco curto:
//
//   <proposta>{"mudancas":[{"id":"p12","direcao":"diminuir","passos":1,"nome":"Barra dianteira mais macia"}],
//              "o_que_mudou":"...","por_que":"...","melhora":"...","pode_piorar":"...","como_testar":"..."}</proposta>
//
// `id` aponta para a linha numerada da tabela de parâmetros que o servidor mandou no prompt, então o
// casamento com o setup real é exato (sem adivinhar rótulo). O servidor separa o bloco, valida, calcula
// os valores A → B e grava a proposta resolvida junto do turno do assistente. Qualquer falha (bloco
// ausente, JSON quebrado, id inexistente) vira "sem proposta": o chat nunca quebra por causa disso.
// Nenhum arquivo de setup é reescrito; B é só o que o piloto aplica à mão no iRacing.

import { categoryOf, type DecodedRow } from "./setup-diff";
import { PANEL_GROUPS, PANEL_GROUP_ORDER, plainParameterName } from "./setup-names";

export const PROPOSAL_OPEN = "<proposta>";
export const PROPOSAL_CLOSE = "</proposta>";
const MAX_PROMPT_ROWS = 150; // mesmo teto de linhas do prompt de antes (custo por turno)
const MAX_CHANGES = 4;
const MAX_STEPS = 5;
const MAX_TEXT = 500;

export type IndexedRow = { id: string; key: string; tab: string; section: string; label: string; value: string; category: string; name: string };

/** Numera as linhas decodificadas (p1, p2, ...) na mesma ordem para o prompt e para a resolução. */
export function indexRows(rows: DecodedRow[]): IndexedRow[] {
  return rows
    .filter((row) => row.label && row.is_mapped !== false)
    .map((row) => ({ tab: row.tab ?? "Setup", section: row.section ?? "Geral", label: String(row.label), value: String(row.metric_value ?? "—") }))
    .filter((row) => categoryOf(row.label, row.section) !== "display")
    .slice(0, MAX_PROMPT_ROWS)
    .map((row, index) => ({
      ...row,
      id: `p${index + 1}`,
      key: `${row.tab}::${row.section}::${row.label}`,
      category: categoryOf(row.label, row.section),
      name: plainParameterName(row.label, row.section),
    }));
}

/** Separa o texto exibível do bloco de proposta. Durante o streaming também esconde um começo de
 * tag ainda incompleto ("<prop") e a cerca ``` que o modelo às vezes abre antes do bloco. */
export function splitEngineerText(text: string): { visible: string; block: string | null } {
  const open = text.indexOf(PROPOSAL_OPEN);
  if (open === -1) {
    let visible = text;
    const lastLt = visible.lastIndexOf("<");
    if (lastLt !== -1 && PROPOSAL_OPEN.startsWith(visible.slice(lastLt))) visible = visible.slice(0, lastLt);
    return { visible: tidyVisible(visible), block: null };
  }
  const close = text.indexOf(PROPOSAL_CLOSE, open);
  const block = text.slice(open + PROPOSAL_OPEN.length, close === -1 ? undefined : close);
  const after = close === -1 ? "" : text.slice(close + PROPOSAL_CLOSE.length);
  return { visible: tidyVisible(`${text.slice(0, open)}${after.replace(/^\s*```\s*/, "")}`), block };
}

function tidyVisible(value: string): string {
  return value.replace(/```(?:json)?\s*$/i, "").replace(/\s+$/, "");
}

export type ProposalChangeInput = { id: string; steps: number; hint: string | null };
export type ParsedProposal = { changes: ProposalChangeInput[]; what: string; why: string; better: string; worse: string; test: string };

/** Limpa o texto gerado: sem "--" nem travessão solto, espaços normais, tamanho limitado. */
export function cleanSpeech(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\s*--+\s*/g, ", ")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Valida o JSON do bloco. Devolve null se não for uma proposta utilizável. */
export function parseProposalBlock(block: string | null): ParsedProposal | null {
  if (!block) return null;
  const json = block.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let data: unknown;
  try { data = JSON.parse(json); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const rawChanges = Array.isArray(record.mudancas) ? record.mudancas : [];
  const changes: ProposalChangeInput[] = [];
  for (const item of rawChanges) {
    if (!item || typeof item !== "object") continue;
    const change = item as Record<string, unknown>;
    const id = typeof change.id === "string" ? change.id.trim().toLowerCase() : "";
    const direction = typeof change.direcao === "string" ? change.direcao.trim().toLowerCase() : "";
    const sign = /^aument|^subi|^mais/.test(direction) ? 1 : /^diminu|^reduz|^baix|^menos/.test(direction) ? -1 : 0;
    if (!/^p\d+$/.test(id) || sign === 0) continue;
    const rawSteps = Number(change.passos ?? 1);
    const steps = Number.isFinite(rawSteps) ? Math.min(MAX_STEPS, Math.max(1, Math.round(rawSteps))) : 1;
    const hint = cleanSpeech(change.nome, 60) || null;
    if (changes.some((existing) => existing.id === id)) continue;
    changes.push({ id, steps: sign * steps, hint });
    if (changes.length >= MAX_CHANGES) break;
  }
  if (!changes.length) return null;
  return {
    changes,
    what: cleanSpeech(record.o_que_mudou),
    why: cleanSpeech(record.por_que),
    better: cleanSpeech(record.melhora, 240),
    worse: cleanSpeech(record.pode_piorar, 240),
    test: cleanSpeech(record.como_testar, 240),
  };
}

export type ResolvedChange = { key: string; name: string; hint: string | null; group: string; a: string; b: string; steps: number };
export type ProposalTableRow = { name: string; a: string; b: string; changed: boolean };
export type ResolvedProposal = {
  version: 1;
  baseSetupId: string;
  baseName: string;
  changes: ResolvedChange[];
  table: Array<{ group: string; rows: ProposalTableRow[] }>;
  what: string; why: string; better: string; worse: string; test: string;
};

/** Valor B a partir do valor do setup e dos passos (cliques/posições). Só faz conta quando o valor
 * é inteiro (barra 5 → 4, asa 6 → 7, 3 cliques → 2 cliques); valor contínuo (N/mm, %, graus) nunca
 * ganha um número inventado: vira "↑ 1 passo", e o piloto escolhe o próximo valor no jogo. */
export function steppedValue(value: string, steps: number): string {
  if (steps === 0) return value;
  // Inteiro sem unidade física (ou em cliques/posições): 180 N/mm não entra, só "5", "3 clicks".
  const match = value.trim().match(/^(-?\d+)(?![\d.,])(\s*(?:clicks?|cliques?|blades?|pos(?:ition)?|steps?|settings?)?)$/i);
  if (match) return `${Number(match[1]) + steps}${match[2]}`;
  const count = Math.abs(steps);
  return `${steps > 0 ? "↑" : "↓"} ${count} ${count === 1 ? "passo" : "passos"}`;
}

/** Resolve a proposta contra as linhas do setup ativo. Se o piloto estava rodando a proposta
 * anterior (mesmo setup base), os passos se acumulam: B é sempre "arquivo A + tudo que mudar à mão". */
export function resolveProposal(
  parsed: ParsedProposal | null,
  rows: IndexedRow[],
  base: { id: string; name: string },
  previous?: ResolvedProposal | null,
): ResolvedProposal | null {
  if (!parsed) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const net = new Map<string, { steps: number; hint: string | null }>();
  if (previous && previous.baseSetupId === base.id) {
    for (const change of previous.changes) if (byKey.has(change.key)) net.set(change.key, { steps: change.steps, hint: change.hint });
  }
  let matched = 0;
  for (const change of parsed.changes) {
    const row = byId.get(change.id);
    if (!row) continue;
    matched += 1;
    const current = net.get(row.key)?.steps ?? 0;
    net.set(row.key, { steps: current + change.steps, hint: change.hint });
  }
  if (!matched) return null;

  const changes: ResolvedChange[] = [];
  for (const [key, entry] of net) {
    if (entry.steps === 0) continue;
    const row = byKey.get(key)!;
    changes.push({ key, name: row.name, hint: entry.hint, group: PANEL_GROUPS[row.category] ?? "Outros", a: row.value, b: steppedValue(row.value, entry.steps), steps: entry.steps });
  }

  const changedKeys = new Set(changes.map((change) => change.key));
  const groups = new Map<string, ProposalTableRow[]>();
  for (const change of changes) groups.set(change.group, [...(groups.get(change.group) ?? []), { name: change.name, a: change.a, b: change.b, changed: true }]);
  // Contexto: até 2 parâmetros vizinhos (mesma categoria) que ficaram iguais, como o Splitter no mockup.
  const categories = new Set(changes.map((change) => byKey.get(change.key)!.category));
  for (const category of categories) {
    const group = PANEL_GROUPS[category] ?? "Outros";
    const context = rows.filter((row) => row.category === category && !changedKeys.has(row.key)).slice(0, 2);
    for (const row of context) groups.get(group)?.push({ name: row.name, a: row.value, b: row.value, changed: false });
  }
  const table = [...groups.entries()]
    .sort((a, b) => PANEL_GROUP_ORDER.indexOf(a[0]) - PANEL_GROUP_ORDER.indexOf(b[0]))
    .map(([group, tableRows]) => ({ group, rows: tableRows }));

  return { version: 1, baseSetupId: base.id, baseName: base.name, changes, table, what: parsed.what, why: parsed.why, better: parsed.better, worse: parsed.worse, test: parsed.test };
}

/** Confere a forma de uma proposta vinda do banco antes de usá-la na tela. */
export function isResolvedProposal(value: unknown): value is ResolvedProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as Partial<ResolvedProposal>;
  return proposal.version === 1 && typeof proposal.baseSetupId === "string" && Array.isArray(proposal.changes) && Array.isArray(proposal.table);
}

/** Proposta mais recente da conversa (turnos do assistente, do fim para o começo). */
export function latestProposal(messages: ReadonlyArray<{ role: string; proposal?: unknown }>): ResolvedProposal | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && isResolvedProposal(message.proposal)) return message.proposal;
  }
  return null;
}
