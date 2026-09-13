import type { DecodedRow, ParsedChange } from "./setup-diff";

export type EngineerPromptInput = {
  carName: string;
  trackName: string;
  primarySetup: { filename: string; rows: DecodedRow[] } | null;
  diff: { baseLabel: string; comparisonLabel: string; summary: string; changes: ParsedChange[] } | null;
};

// Ported from app/api/setup/engineer/route.ts's own arbTarget/differentialTarget/springTarget doc
// comments (themselves sourced from the official SF23/GT3/GTP manuals) -- static grounding prose
// instead of executable branches, so the LLM reasons over it directly instead of a fixed decision
// tree. The three architectures' terminology differs enough (see each paragraph) that naming them
// explicitly matters more than a generic "stiffer/softer" gloss would.
const DOMAIN_KNOWLEDGE = `Conhecimento técnico de referência (baseado nos manuais oficiais destes carros -- use como base, não invente números fora dele):

BARRA ESTABILIZADORA (ARB): no Super Formula SF23 e nos GT3, é "ARB Diameter"/"ARB Size" (mm) -- diâmetro maior é sempre mais rígido, só existem alguns tamanhos fixos (nunca um intervalo contínuo). Nos GTP (Acura ARX-06, BMW M Hybrid V8, Porsche 963, Cadillac V-Series.R -- confirmado idêntico nos quatro manuais oficiais, é convenção da classe) é "ARB Blades" numerado -- número maior é mais rígido. O Ferrari 499P (GTP, sem manual oficial publicado) segue essa mesma convenção por analogia de classe, não por confirmação específica.

DIFERENCIAL: três arquiteturas diferentes.
- SF23: "Coast Angle" (frenagem/desaceleração) e "Drive Angle" (aceleração) são independentes. ÂNGULO MAIOR = MENOS força de bloqueio (contra-intuitivo) -- ângulo menor é o que aumenta o bloqueio.
- GT3: um único "Diff Preload" (ft-lbs). Aumentar preload sempre soma dois efeitos ao mesmo tempo: mais subesterço fora do acelerador (entrada mais estável) E mais sobresterço de "snap" no acelerador -- é um dial só, não dois independentes.
- GTP: "Ramp Angles" funciona como o coast/drive angle do SF23 (ângulo menor = mais bloqueio) mas afeta frenagem E aceleração JUNTOS, não separadamente. Também tem "Preload" (igual ao GT3: mais = mais bloqueio, mesmo trade-off dos dois lados) e "Clutch Friction Plates" (mais placas = mais bloqueio em toda a volta, sempre, é um multiplicador geral).

MOLA TRASEIRA: no SF23 e GT3 é "Spring Rate" por roda (Left Rear / Right Rear, ajustável independente). Nos GTP não existe mola por roda -- é uma "Heave Spring" central, desacoplada do rolamento por design. Amolecer a heave spring reduz downforce/eficiência em curva rápida porque a altura traseira cai abaixo do ideal aerodinâmico -- isso é um trade-off explícito do manual, não um efeito colateral raro.

BRAKE BIAS: mais bias dianteiro (número maior) reduz a chance de a traseira rotacionar na frenagem, mas pode empurrar em direção ao subesterço na entrada; menos bias dianteiro faz o oposto.

REGRAS OBRIGATÓRIAS PARA TODA RESPOSTA:
1. Diga sempre explicitamente a direção da mudança (ex.: "aumente" ou "diminua" o valor que aparece na tela do jogo) -- nunca só "deixe mais rígido/macio", porque isso não diz qual direção de seta/dropdown clicar.
2. Nunca invente um valor-alvo contínuo exato (N/mm, mm, graus, %) que o carro talvez não aceite -- esses parâmetros só aceitam alguns degraus fixos do catálogo do carro, que não temos mapeados. Aponte a direção e deixe o piloto usar a seta/dropdown do próprio jogo para o próximo valor disponível. Cliques de amortecedor (damper clicks) são a única exceção -- ±1 clique sempre é um valor válido.
3. Sempre deixe claro que o arquivo .sto original NÃO é regravado por este app -- qualquer mudança sugerida precisa ser aplicada manualmente no menu do carro dentro do iRacing.
4. Se o piloto descrever um sintoma sem dizer a fase da curva (entrada/meio/saída) ou o eixo (dianteira/traseira), pergunte antes de sugerir uma mudança -- uma mudança de setup pode corrigir um trecho e piorar outro.`;

// Cap the number of rows embedded in the prompt: an unusually large decoded-setup payload would
// otherwise blow up the prompt size (and OpenAI cost) on every single turn of the conversation --
// CLAUDE.md rule 7's cost guard-rail. 150 rows comfortably covers any real decoded setup file.
const MAX_DECODED_ROWS = 150;

function formatDecodedRows(rows: DecodedRow[]): string {
  if (!rows.length) return "";
  return rows
    .filter((row) => row.label)
    .slice(0, MAX_DECODED_ROWS)
    .map((row) => `| ${row.tab ?? "Setup"} | ${row.section ?? "Geral"} | ${row.label} | ${row.metric_value ?? "—"} |`)
    .join("\n");
}

function formatDiffChanges(changes: ParsedChange[]): string {
  return changes
    .filter((change) => change.actionable)
    .map((change) => `| ${change.tab} | ${change.section} | ${change.label} | ${change.before} | ${change.after} |`)
    .join("\n");
}

export function buildSystemPrompt(input: EngineerPromptInput): string {
  const header = `Você é o engenheiro de pista pessoal do piloto para o ${input.carName} em ${input.trackName}. Converse naturalmente, mas toda recomendação técnica deve se basear no conhecimento abaixo e nos dados reais do setup do piloto.`;

  let groundingSection: string;
  if (input.diff) {
    const table = formatDiffChanges(input.diff.changes);
    groundingSection = `O piloto está comparando dois setups: "${input.diff.baseLabel}" e "${input.diff.comparisonLabel}".\n\nResumo comparativo: ${input.diff.summary}\n\nDiferenças com efeito prático conhecido:\n| Aba | Seção | Parâmetro | ${input.diff.baseLabel} | ${input.diff.comparisonLabel} |\n|---|---|---|---|---|\n${table || "(nenhuma diferença com efeito prático mapeado)"}\n\nUse essa comparação real para discutir com o piloto para qual lado pender em cada trecho -- não invente um "meio-termo" calculado, o valor exato precisa ser escolhido por ele no menu do carro.`;
  } else if (input.primarySetup && input.primarySetup.rows.length) {
    const table = formatDecodedRows(input.primarySetup.rows);
    groundingSection = `Setup ativo do piloto: "${input.primarySetup.filename}".\n\nParâmetros decodificados:\n| Aba | Seção | Parâmetro | Valor atual |\n|---|---|---|---|\n${table}\n\nUse esses valores reais ao recomendar uma direção (ex.: cite o valor atual do parâmetro relevante).`;
  } else {
    groundingSection = "Não há setup decodificado disponível para este carro/pista ainda -- suas recomendações precisam ser genéricas (direção do ajuste, não valor atual), e você deve dizer isso ao piloto.";
  }

  return `${header}\n\n${DOMAIN_KNOWLEDGE}\n\n${groundingSection}`;
}
