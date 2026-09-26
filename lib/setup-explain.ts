// "Comparar dois setups" em linguagem de piloto (Setup Lab, redesign etapa 6).
//
// Parte 100% determinística (sem LLM, sem custo): cada diferença do diff (lib/setup-diff.ts) empurra
// algumas "sensações" do carro para um lado. Somando, sai o que o piloto sente com o setup B em relação
// ao A: vira mais na entrada? tem mais tração na saída? anda mais na reta? Daí saem a frase-resumo,
// "como você vai sentir" por fase da curva, "quando usar cada um", passos de teste específicos e um
// glossário só com os termos que aparecem nessa comparação.

import type { ParsedChange } from "./setup-diff";
import { positionOf } from "./setup-names";

export type Feel = "entryRotation" | "midRotation" | "exitTraction" | "braking" | "straight" | "fastCorner" | "kerbs";
export type SetupExplanation = {
  oneLiner: string;
  feel: { entry: string; mid: string; exit: string };
  whenToUse: string;
  testSteps: string[];
  glossary: Array<{ term: string; meaning: string }>;
  scores: Record<Feel, number>;
};

const THRESHOLD = 0.5;

type Contribution = { scores: Partial<Record<Feel, number>>; terms: string[] };

function signOf(change: ParsedChange): number {
  if (change.numericDelta === null || change.numericDelta === 0) return 0;
  // Cambagem é negativa: "mais cambagem" é o módulo crescer, não o número.
  if (/camber|cambagem/i.test(change.label)) {
    const before = Math.abs(Number(change.before.replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0]));
    const after = Math.abs(Number(change.after.replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0]));
    return Number.isFinite(before) && Number.isFinite(after) && after !== before ? Math.sign(after - before) : 0;
  }
  return Math.sign(change.numericDelta);
}

/** Quanto essa diferença mexe em cada sensação (positivo = o B tem mais daquilo). */
export function contributionOf(change: ParsedChange): Contribution {
  const s = signOf(change);
  if (s === 0) return { scores: {}, terms: [] };
  const key = `${change.label} ${change.section}`.toLowerCase();
  const { axle } = positionOf(change.section, change.label);
  switch (change.category) {
    case "aero":
      if (/rear.*wing|wing.*(angle|setting)|asa.*trase|gurney/.test(key) || (axle === "rear" && /wing|asa/.test(key))) {
        return { scores: { fastCorner: s, straight: -s, midRotation: -0.5 * s, exitTraction: 0.5 * s }, terms: ["asa"] };
      }
      if (/front|flap|diant|splitter/.test(key)) return { scores: { midRotation: s, fastCorner: 0.5 * s, straight: -0.5 * s }, terms: ["asa"] };
      return { scores: { fastCorner: 0.5 * s, straight: -0.5 * s }, terms: ["asa"] };
    case "brakes":
      return { scores: { braking: s, entryRotation: -s }, terms: ["brake bias"] };
    case "arb":
      if (axle === "front") return { scores: { midRotation: -s, entryRotation: -0.5 * s, kerbs: -0.5 * s }, terms: ["barra estabilizadora"] };
      if (axle === "rear") return { scores: { midRotation: s, entryRotation: 0.5 * s, exitTraction: -s }, terms: ["barra estabilizadora"] };
      return { scores: { kerbs: -0.5 * s }, terms: ["barra estabilizadora"] };
    case "springs":
      if (axle === "front") return { scores: { midRotation: -0.5 * s, kerbs: -0.5 * s, fastCorner: 0.5 * s }, terms: ["mola"] };
      if (axle === "rear") return { scores: { midRotation: 0.5 * s, exitTraction: -0.5 * s, kerbs: -0.5 * s, fastCorner: 0.5 * s }, terms: ["mola"] };
      return { scores: { kerbs: -0.5 * s, fastCorner: 0.5 * s }, terms: ["mola"] };
    case "ride_height":
      // Traseira mais alta ou dianteira mais baixa = mais rake: o carro gira mais em curva rápida.
      if (axle === "rear") return { scores: { midRotation: 0.5 * s, kerbs: 0.5 * s }, terms: ["rake"] };
      if (axle === "front") return { scores: { midRotation: -0.5 * s, kerbs: 0.5 * s }, terms: ["rake"] };
      return { scores: { kerbs: 0.5 * s }, terms: ["altura"] };
    case "dampers":
      return { scores: { kerbs: -0.5 * s, fastCorner: 0.3 * s }, terms: ["amortecedor"] };
    case "differential": {
      // Ângulo de rampa/coast/drive maior = MENOS bloqueio; pré-carga e discos a mais = MAIS bloqueio.
      const locking = /angle|ramp|coast|drive/.test(key) && !/preload|clutch|plate/.test(key) ? -s : s;
      const term = /preload|pré/.test(key) ? "pré-carga do diferencial" : "diferencial";
      if (/coast/.test(key)) return { scores: { entryRotation: -locking, braking: 0.5 * locking }, terms: [term] };
      if (/drive|power/.test(key)) return { scores: { exitTraction: 0.5 * locking, midRotation: -0.3 * locking }, terms: [term] };
      return { scores: { entryRotation: -locking, exitTraction: 0.5 * locking }, terms: [term] };
    }
    case "alignment":
      if (/camber|cambagem/.test(key)) return { scores: axle === "front" ? { midRotation: 0.3 * s, braking: -0.3 * s } : { exitTraction: -0.3 * s }, terms: ["cambagem"] };
      if (/toe|converg/.test(key)) return { scores: {}, terms: ["convergência"] };
      return { scores: {}, terms: [] };
    case "tires":
      return { scores: {}, terms: ["pressão"] };
    default:
      return { scores: {}, terms: [] };
  }
}

const GLOSSARY: Record<string, string> = {
  "brake bias": "quanto do freio vai pra frente",
  rake: "carro mais \"empinado\" atrás",
  "pré-carga do diferencial": "quanto as rodas travam juntas na saída",
  diferencial: "quanto as rodas de trás giram juntas; mais travado é mais estável e gira menos",
  "barra estabilizadora": "quanto o carro inclina na curva; mais dura responde rápido e segura menos",
  asa: "mais asa gruda o carro em curva e tira velocidade na reta",
  mola: "mais dura segura a altura do carro, mas pula mais na zebra",
  amortecedor: "a velocidade com que o carro sobe e desce",
  cambagem: "a inclinação da roda vista de frente",
  "convergência": "rodas apontando pra dentro ou pra fora",
  "pressão": "pneu mais cheio responde rápido, mas segura menos",
  altura: "distância do assoalho até o chão",
};
const GLOSSARY_LABEL: Record<string, string> = {
  "brake bias": "Brake bias", rake: "Rake", "pré-carga do diferencial": "Pré-carga do diferencial", diferencial: "Diferencial",
  "barra estabilizadora": "Barra estabilizadora", asa: "Asa", mola: "Mola", amortecedor: "Amortecedor", cambagem: "Cambagem",
  "convergência": "Convergência (toe)", "pressão": "Pressão do pneu", altura: "Altura",
};

const TRAIT: Record<Feel, [string, string]> = {
  // [o que o setup TEM a mais, frase curta]
  straight: ["é mais veloz na reta", "anda mais na reta"],
  fastCorner: ["é mais grudado no chão em curva rápida", "segura mais em curva rápida"],
  entryRotation: ["vira mais fácil na entrada", "vira mais fácil"],
  midRotation: ["gira mais no meio da curva", "fecha mais a trajetória"],
  exitTraction: ["sai de curva com mais tração", "acelera melhor"],
  braking: ["freia mais estável", "freia mais reto"],
  kerbs: ["passa melhor por zebra e ondulação", "copia melhor a zebra"],
};

const SITUATION: Record<Feel, string> = {
  straight: "pistas de reta longa ou quando precisar se defender na reta",
  fastCorner: "pistas de curva rápida",
  entryRotation: "pistas travadas, de curva lenta, onde o carro precisa girar",
  midRotation: "pistas de curva média, onde o carro precisa fechar a trajetória",
  exitTraction: "pistas com muitas saídas de curva lenta",
  braking: "pistas com frenagens fortes",
  kerbs: "pistas com zebra alta e ondulação",
};

const CHECK: Record<Feel, (a: string, b: string) => string> = {
  entryRotation: (a, b) => `Nas freadas para curva lenta, repare se o ${b} aponta a frente mais cedo que o ${a} sem a traseira escapar.`,
  midRotation: (a, b) => `No meio das curvas médias, veja com qual o carro fecha a trajetória e com qual ele vai pra fora (${a} ou ${b}).`,
  exitTraction: (a, b) => `Na saída das curvas lentas, veja com qual você volta ao acelerador mais cedo sem a traseira sair (${a} ou ${b}).`,
  braking: (a, b) => `Nas freadas mais fortes, veja com qual o carro freia reto sem travar roda (${a} ou ${b}).`,
  straight: (a, b) => `Compare a velocidade no fim da reta mais longa com o ${a} e com o ${b}.`,
  fastCorner: (a, b) => `Na curva mais rápida da pista, veja com qual você mantém mais velocidade sem corrigir o volante (${a} ou ${b}).`,
  kerbs: (a, b) => `Passe pelas zebras que você usa e sinta com qual o carro assenta mais rápido (${a} ou ${b}).`,
};

function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function ranked(scores: Record<Feel, number>, positive: boolean): Feel[] {
  return (Object.keys(scores) as Feel[])
    .filter((feel) => (positive ? scores[feel] >= THRESHOLD : scores[feel] <= -THRESHOLD))
    .sort((x, y) => Math.abs(scores[y]) - Math.abs(scores[x]));
}

function usageHint(name: string): string | null {
  if (/\bq\b|quali|qualy|classif/i.test(name)) return "classificação";
  if (/\br\b|race|corrida/i.test(name)) return "corrida";
  return null;
}

/** Explicação completa em linguagem de piloto. `nameA`/`nameB` são os nomes curtos dos setups. */
export function explainComparison(changes: ParsedChange[], rawNameA: string, rawNameB: string): SetupExplanation {
  const sameName = rawNameA.trim().toLowerCase() === rawNameB.trim().toLowerCase();
  const nameA = sameName ? `${rawNameA} (1)` : rawNameA;
  const nameB = sameName ? `${rawNameB} (2)` : rawNameB;
  const scores: Record<Feel, number> = { entryRotation: 0, midRotation: 0, exitTraction: 0, braking: 0, straight: 0, fastCorner: 0, kerbs: 0 };
  const termCount = new Map<string, number>();
  for (const change of changes.filter((item) => item.actionable && item.settable)) {
    const contribution = contributionOf(change);
    for (const [feel, value] of Object.entries(contribution.scores) as Array<[Feel, number]>) scores[feel] += value;
    for (const term of contribution.terms) termCount.set(term, (termCount.get(term) ?? 0) + 1);
  }
  for (const feel of Object.keys(scores) as Feel[]) scores[feel] = Math.round(scores[feel] * 10) / 10;

  const bTraits = ranked(scores, true).slice(0, 2);
  const aTraits = ranked(scores, false).slice(0, 2);
  let oneLiner: string;
  if (!bTraits.length && !aTraits.length) {
    oneLiner = changes.length
      ? `O ${nameA} e o ${nameB} deixam o carro muito parecido: as diferenças são pequenas ou em ajustes que não mudam o comportamento de um jeito claro.`
      : `O ${nameA} e o ${nameB} têm os mesmos ajustes decodificados pelo Garage61.`;
  } else if (bTraits.length && aTraits.length) {
    oneLiner = `O ${nameB} ${join(bTraits.map((feel) => TRAIT[feel][0]))}; o ${nameA} ${join(aTraits.map((feel) => TRAIT[feel][0]))}.`;
  } else if (bTraits.length) {
    oneLiner = `O ${nameB} ${join(bTraits.map((feel) => TRAIT[feel][0]))}; no resto, o ${nameA} fica bem parecido.`;
  } else {
    oneLiner = `O ${nameA} ${join(aTraits.map((feel) => TRAIT[feel][0]))}; no resto, o ${nameB} fica bem parecido.`;
  }

  const phase = (feels: Feel[]): string => {
    // Agrupa por setup: "o Race fecha mais a trajetória e segura mais em curva rápida".
    const bySetup = new Map<string, string[]>();
    for (const feel of feels.filter((item) => Math.abs(scores[item]) >= THRESHOLD)) {
      const owner = scores[feel] > 0 ? nameB : nameA;
      bySetup.set(owner, [...(bySetup.get(owner) ?? []), TRAIT[feel][1]]);
    }
    const parts = [...bySetup.entries()].map(([owner, traits]) => `o ${owner} ${join(traits)}`);
    return parts.length ? `${parts.join("; ")}.` : "praticamente igual nos dois.";
  };
  const feel = {
    entry: phase(["entryRotation", "braking"]),
    mid: phase(["midRotation", "fastCorner"]),
    exit: phase(["exitTraction", "straight"]),
  };

  const usageA = usageHint(nameA), usageB = usageHint(nameB);
  const sentences: string[] = [];
  if (usageA && usageB && usageA !== usageB) sentences.push(`Pelo nome, o ${nameA} foi feito para ${usageA} e o ${nameB} para ${usageB}.`);
  if (bTraits.length) sentences.push(`Use o ${nameB} em ${SITUATION[bTraits[0]]}.`);
  if (aTraits.length) sentences.push(`Use o ${nameA} em ${SITUATION[aTraits[0]]}.`);
  if (!bTraits.length && !aTraits.length) sentences.push("Qualquer um serve: escolha o que você já conhece melhor e foque na pilotagem.");
  else if (!aTraits.length) sentences.push(`Fora disso, fique com o ${nameA} se ele já te deixa confortável.`);
  else if (!bTraits.length) sentences.push(`Fora disso, fique com o ${nameB} se ele já te deixa confortável.`);
  const whenToUse = sentences.join(" ");

  const focus = [...bTraits, ...aTraits].slice(0, 2);
  const testSteps = [
    `Rode 3 voltas com o ${nameA} e 3 com o ${nameB}, com o mesmo combustível e o mesmo pneu.`,
    ...focus.map((item) => CHECK[item](nameA, nameB)),
    "Fique com o que deu a volta mais rápida e que você consegue repetir sem sustos.",
  ];

  const glossary = [...termCount.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([term]) => term)
    .filter((term) => GLOSSARY[term])
    .slice(0, 4)
    .map((term) => ({ term: GLOSSARY_LABEL[term] ?? term, meaning: GLOSSARY[term] }));

  return { oneLiner, feel, whenToUse, testSteps, glossary, scores };
}
