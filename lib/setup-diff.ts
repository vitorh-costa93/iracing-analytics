export type DecodedRow = { tab?: string; section?: string; label?: string; metric_value?: string | number; is_mapped?: boolean };
export type ParsedChange = { tab: string; section: string; label: string; before: string; after: string; explanation: string; category: string; actionable: boolean; settable: boolean; numericDelta: number | null };

export function numericOf(value: string) {
  return Number(value.replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0]);
}

export function categoryOf(label: string, section: string) {
  const key = `${label} ${section}`.toLowerCase();
  if (/display|dash|page|shift light|led|alert/.test(key)) return "display";
  if (/wing|asa|aero|gurney|flap|splitter/.test(key)) return "aero";
  if (/brake.*bias|balance|freio/.test(key)) return "brakes";
  if (/anti.?roll|arb|barra/.test(key)) return "arb";
  if (/spring|mola/.test(key)) return "springs";
  if (/ride height|altura/.test(key)) return "ride_height";
  if (/camber|cambagem|toe|converg|steering|direção|ackerman/.test(key)) return "alignment";
  if (/damp|shock|bump|rebound|amort/.test(key)) return "dampers";
  if (/differential|diff|preload|coast|power|ramp.?angle|clutch.*(plate|face)/.test(key)) return "differential";
  if (/pressure|pressao/.test(key)) return "tires";
  if (/gear|ratio|marcha/.test(key)) return "gearing";
  return "other";
}

// Textos por parâmetro no tom de engenheiro de pista falando com o piloto (redesign etapa 6):
// o que o piloto sente, o que ganha e o que paga, sem "aba • seção", sem "--" e sem travessão solto.
export function effect(label: string, before: string, after: string, section?: string, _tab?: string): { text: string; actionable: boolean; settable: boolean } {
  const key = label.toLowerCase();
  const sectionKey = (section ?? "").toLowerCase();
  const from = numericOf(before), to = numericOf(after), increased = Number.isFinite(from) && Number.isFinite(to) ? to > from : null;
  const isFront = /front|diant/.test(sectionKey) || /front|diant/.test(key);
  const isRear = /rear|trase/.test(sectionKey) || /rear|trase/.test(key);
  const axleLabel = isFront ? "dianteir" : isRear ? "traseir" : null;
  const change = `${before} → ${after}`;

  // Não é ajuste: é o desgaste observado depois da sessão. Fica na lista porque ajuda a ler pressão e cambagem.
  if (/wear|tread|desgaste|remaining/.test(key)) return { text: `Isso não se ajusta: é o desgaste que o pneu mostrou no fim da sessão (${change}). Se um lado gastou bem mais que o outro, olhe a pressão e a cambagem daquele eixo.`, actionable: true, settable: false };
  if (/last.*(hot|temp)|hot.*pressure/.test(key)) return { text: `Isso não se ajusta: é a pressão/temperatura que o pneu mostrou no fim da sessão (${change}). Serve para acertar a pressão fria, não para copiar.`, actionable: true, settable: false };
  if (/\bgap\b|defl/.test(key)) return { text: `Isso é uma leitura da garagem (${change}), consequência da mola e da altura; não se ajusta direto.`, actionable: true, settable: false };

  if (/display|dash|page|shift light|led|alert/.test(key)) return { text: `Só muda o que aparece no painel (${change}); o carro anda igual.`, actionable: false, settable: true };

  if (/rear.*wing|wing.*angle|asa.*trase|gurney/.test(key)) return { text: increased === null ? `A asa traseira mudou (${change}): mexe no apoio de trás e na velocidade de reta.` : increased ? `Mais asa atrás (${change}): a traseira fica mais presa em curva rápida e na saída, mas o carro perde velocidade na reta.` : `Menos asa atrás (${change}): o carro anda mais na reta, mas a traseira fica mais solta em curva rápida.`, actionable: true, settable: true };
  if (/front.*wing|flap.*angle|asa.*diante/.test(key)) return { text: increased ? `Mais asa na frente (${change}): o carro vira mais em curva média e rápida, mas a traseira pode ficar mais leve.` : `Menos asa na frente (${change}): a entrada fica mais calma e o carro tende a empurrar um pouco mais.`, actionable: true, settable: true };
  if (/splitter/.test(key)) return { text: `Splitter (${change}): muda o apoio da frente; mais splitter faz o carro virar mais em curva rápida.`, actionable: true, settable: true };
  if (/wing|asa|aero/.test(key)) return { text: `Mudança de aerodinâmica (${change}): muda o apoio e a velocidade de reta; confira a curva mais rápida e o fim da reta.`, actionable: true, settable: true };
  if (/brake.*bias|balance|freio/.test(key)) return { text: increased === null ? `O brake bias mudou (${change}): muda como o carro se comporta na freada.` : increased ? `Mais freio na frente (${change}): o carro freia mais reto, mas vira menos na entrada e gasta mais o pneu dianteiro.` : `Mais freio atrás (${change}): o carro gira mais fácil na entrada, mas a traseira pode escapar se você frear e virar ao mesmo tempo.`, actionable: true, settable: true };
  if (/anti.?roll|arb|barra/.test(key)) {
    if (axleLabel === "dianteir") return { text: increased ? `Barra da frente mais dura (${change}): o carro responde mais rápido ao volante, mas empurra mais no meio da curva lenta.` : `Barra da frente mais macia (${change}): a frente segura mais e aceita melhor a zebra, com uma resposta de volante um pouco mais lenta.`, actionable: true, settable: true };
    if (axleLabel === "traseir") return { text: increased ? `Barra de trás mais dura (${change}): o carro gira mais na entrada e no meio, mas perde tração na saída.` : `Barra de trás mais macia (${change}): mais tração na saída e mais calma em curva rápida, com o carro empurrando um pouco mais no meio.`, actionable: true, settable: true };
    return { text: `A barra estabilizadora mudou (${change}): muda o quanto o carro inclina e o equilíbrio entre empurrar e sair de traseira.`, actionable: true, settable: true };
  }
  if (/spring|mola/.test(key)) {
    const where = axleLabel === "dianteir" ? " na frente" : axleLabel === "traseir" ? " atrás" : "";
    return { text: increased === null ? `A mola${where} mudou (${change}): mexe na altura do carro em movimento e em como ele passa pela zebra.` : increased ? `Mola mais dura${where} (${change}): o carro fica mais firme em curva rápida e freada forte, mas pula mais na zebra e na ondulação.` : `Mola mais macia${where} (${change}): o carro copia melhor a zebra e segura mais em pista irregular, mas afunda mais em curva rápida.`, actionable: true, settable: true };
  }
  if (/ride height|altura/.test(key)) return { text: `Altura ${axleLabel ? `${axleLabel}a ` : ""}(${change}): muda o quanto o carro fica "empinado" atrás (rake) e a folga para o fundo não raspar na zebra.`, actionable: true, settable: true };
  if (/camber|cambagem/.test(key)) return { text: `Cambagem ${axleLabel ? `${axleLabel}a ` : ""}(${change}): muda o quanto o pneu apoia no meio da curva e na freada em linha reta.`, actionable: true, settable: true };
  if (/toe|converg/.test(key)) return { text: `Convergência ${axleLabel ? `${axleLabel}a ` : ""}(${change}): muda a primeira reação ao volante e a estabilidade na reta.`, actionable: true, settable: true };
  if (/damp|shock|bump|rebound|amort/.test(key)) {
    const isBump = /bump|compress/.test(key), isRebound = /rebound|extens/.test(key);
    if (isBump) return { text: `Amortecedor de compressão ${axleLabel ? `${axleLabel}o ` : ""}(${change}): controla o quanto o carro afunda na freada, na curva e na zebra; mais duro segura melhor, mas bate mais.`, actionable: true, settable: true };
    if (isRebound) return { text: `Amortecedor de extensão ${axleLabel ? `${axleLabel}o ` : ""}(${change}): controla a volta da suspensão depois de afundar; mais duro acalma o carro, mas pode deixar o pneu sem chão em zebra seguida.`, actionable: true, settable: true };
    return { text: `Amortecedor ${axleLabel ? `${axleLabel}o ` : ""}(${change}): muda a velocidade com que o peso passa de um lado para o outro na freada, na curva e na zebra.`, actionable: true, settable: true };
  }
  if (/differential|diff|preload|coast|power|ramp.?angle|clutch.*(plate|face)/.test(key)) return { text: `Diferencial (${change}): muda o quanto as rodas de trás giram juntas. Mais travado deixa o carro estável na freada e na saída, mas ele gira menos na entrada.`, actionable: true, settable: true };
  if (/pressure|pressao/.test(key)) return { text: `Pressão do pneu ${axleLabel ? `${axleLabel}a ` : ""}(${change}): pneu mais cheio responde mais rápido, mas segura menos; mais vazio segura mais, mas esquenta.`, actionable: true, settable: true };
  if (/gear|ratio|marcha/.test(key)) return { text: `Relação de marcha (${change}): muda a força na saída e a velocidade máxima naquela marcha; confira se ainda bate no limitador antes da maior reta.`, actionable: true, settable: true };
  if (/steering|direção|ackerman/.test(key)) return { text: `Geometria de direção (${change}): muda o quanto as rodas da frente viram uma em relação à outra na curva.`, actionable: true, settable: true };
  return { text: `${label} mudou (${change}). Ainda não tenho uma leitura pronta desse ajuste: teste ele sozinho antes de levar para a corrida.`, actionable: false, settable: true };
}

export function mappedRows(rows: DecodedRow[]) {
  return new Map(rows.filter((row) => row.is_mapped !== false && row.label).map((row) => [`${row.tab ?? "Outro"}::${row.section ?? "Geral"}::${row.label}`, String(row.metric_value ?? "—")]));
}

export function diffSetups(baseRows: DecodedRow[], comparisonRows: DecodedRow[]): ParsedChange[] {
  const a = mappedRows(baseRows), b = mappedRows(comparisonRows);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const raw = keys.filter((key) => a.get(key) !== b.get(key)).map((key) => {
    const [tab, section, label] = key.split("::");
    const before = a.get(key) ?? "—", after = b.get(key) ?? "—";
    const { text, actionable, settable } = effect(label, before, after, section, tab);
    const from = numericOf(before), to = numericOf(after);
    const numericDelta = Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
    return { tab, section, label, before, after, explanation: text, category: categoryOf(label, section), actionable, settable, numericDelta };
  });
  return mergeLinkedPairs(raw);
}

/**
 * Several parameters are mechanically mirrored per the official car manuals (e.g. a single physical
 * adjuster sets both left and right ARB blades, or front-left/front-right toe move together on a
 * shared rack) — the raw per-row diff reports each side as an independent change, which reads as two
 * deliberate edits when the driver really made one. Detects same-category pairs whose label differs
 * only by a left/right (or L/R) token and whose numeric deltas move the same direction, and folds
 * them into one combined entry with a note that this was a single mirrored adjustment.
 */
function mergeLinkedPairs(changes: ParsedChange[]): ParsedChange[] {
  const sideToken = /\b(left|right|esquerd[oa]|direit[oa]|\bl\b|\br\b|le|ri)\b/i;
  const groups = new Map<string, ParsedChange[]>();
  for (const change of changes) {
    if (!sideToken.test(change.label)) { groups.set(`solo::${change.tab}::${change.section}::${change.label}`, [change]); continue; }
    const normalizedLabel = change.label.replace(sideToken, "").replace(/\s{2,}/g, " ").trim();
    const key = `pair::${change.tab}::${change.category}::${normalizedLabel}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }

  const result: ParsedChange[] = [];
  for (const group of groups.values()) {
    if (group.length !== 2) { result.push(...group); continue; }
    const [left, right] = group;
    const sameDirection = left.numericDelta !== null && right.numericDelta !== null
      && Math.sign(left.numericDelta) === Math.sign(right.numericDelta) && left.numericDelta !== 0;
    if (!sameDirection) { result.push(...group); continue; }
    const normalizedLabel = left.label.replace(sideToken, "").replace(/\s{2,}/g, " ").trim();
    result.push({
      tab: left.tab, section: left.section, label: `${normalizedLabel} (dois lados)`,
      before: `${left.before} / ${right.before}`, after: `${left.after} / ${right.after}`,
      explanation: `${left.explanation} Os dois lados mudaram juntos: nesse carro é um controle só, então conte como uma mudança, não duas.`,
      category: left.category, actionable: left.actionable, settable: left.settable,
      numericDelta: left.numericDelta,
    });
  }
  return result;
}

export const CATEGORY_LABELS: Record<string, string> = {
  aero: "Aerodinâmica", brakes: "Freios", arb: "Barras estabilizadoras", springs: "Molas",
  ride_height: "Altura do carro", alignment: "Geometria/alinhamento", dampers: "Amortecedores",
  differential: "Diferencial", tires: "Pneus/pressão", gearing: "Relação de marcha", display: "Display", other: "Outros",
};

type Direction = "increase" | "decrease" | "mixed";

/** Frase curta por categoria, usada na narrativa comparativa entre dois setups. */
function categoryTradeoff(category: string, direction: Direction): string {
  const phrases: Record<string, Record<Direction, string>> = {
    aero: {
      increase: "usa mais asa: segura mais em curva rápida e anda menos na reta",
      decrease: "usa menos asa: anda mais na reta e segura menos em curva rápida",
      mixed: "mexe na asa de um jeito diferente na frente e atrás, o que muda o equilíbrio do carro em curva rápida",
    },
    brakes: {
      increase: "joga o freio mais pra frente: freia mais reto e vira menos na entrada",
      decrease: "joga o freio mais pra trás: gira mais fácil na entrada, com a traseira mais viva na freada",
      mixed: "muda o freio sem uma direção clara",
    },
    arb: {
      increase: "endurece as barras: responde mais rápido e segura menos em pista irregular",
      decrease: "amolece as barras: segura mais e aceita melhor a zebra, com resposta mais lenta",
      mixed: "endurece um eixo e amolece o outro nas barras, o que muda o equilíbrio entre empurrar e sair de traseira",
    },
    springs: {
      increase: "usa molas mais duras: firme em curva rápida e freada, mas pula mais na zebra",
      decrease: "usa molas mais macias: copia melhor a zebra, mas afunda mais em curva rápida",
      mixed: "endurece a mola de um eixo e amolece a do outro",
    },
    ride_height: {
      increase: "sobe o carro: mais folga para zebra, menos apoio aerodinâmico",
      decrease: "abaixa o carro: mais apoio, com mais risco de raspar o fundo na zebra",
      mixed: "muda a altura de um jeito diferente na frente e atrás, o que muda o rake",
    },
    alignment: {
      increase: "aumenta cambagem/convergência: apoia mais no meio da curva e gasta mais pneu",
      decrease: "reduz cambagem/convergência: poupa pneu e freia melhor em linha reta",
      mixed: "mexe na geometria das rodas de forma diferente por eixo",
    },
    dampers: {
      increase: "endurece os amortecedores: carro mais contido, pior na zebra",
      decrease: "amolece os amortecedores: melhor na zebra, carro mais solto de movimento",
      mixed: "mistura amortecimento mais duro e mais macio",
    },
    differential: {
      increase: "trava mais o diferencial: estável na freada e na saída, gira menos na entrada",
      decrease: "solta o diferencial: gira mais fácil na entrada, pode patinar uma roda na saída",
      mixed: "muda o diferencial de um jeito na freada e de outro na aceleração",
    },
    tires: {
      increase: "enche mais os pneus: resposta mais direta, menos aderência se passar do ponto",
      decrease: "esvazia um pouco os pneus: mais aderência, com risco de esquentar",
      mixed: "muda a pressão de forma diferente por pneu",
    },
    gearing: {
      increase: "alonga as marchas: mais velocidade final, saída mais lenta",
      decrease: "encurta as marchas: saída mais forte, menos velocidade final",
      mixed: "reescalona o câmbio",
    },
  };
  return phrases[category]?.[direction] ?? "muda ajustes nessa área sem um padrão único";
}

function axleOf(change: ParsedChange): "front" | "rear" | null {
  const key = `${change.label} ${change.section}`.toLowerCase();
  if (/front|diant/.test(key)) return "front";
  if (/rear|trase/.test(key)) return "rear";
  return null;
}

function directionOf(items: ParsedChange[]): Direction {
  const numeric = items.filter((item) => item.numericDelta !== null && item.numericDelta !== 0);
  const increases = numeric.filter((item) => (item.numericDelta as number) > 0).length;
  const decreases = numeric.length - increases;
  return numeric.length === 0 ? "mixed" : increases === decreases ? "mixed" : increases > decreases ? "increase" : "decrease";
}

/**
 * Parâmetros que mudam juntos contam uma história só (ex.: barra da frente mais dura e mola da frente
 * mais macia se compensam na aderência). Agrupa as mudanças por categoria + eixo e confere uma tabela
 * pequena de pares que interagem, para dizer se as mudanças reforçam ou anulam uma à outra.
 */
function crossParameterCorrelations(actionable: ParsedChange[]): string[] {
  const signals = new Map<string, ParsedChange[]>();
  for (const change of actionable) {
    const axle = axleOf(change);
    const key = `${change.category}:${axle ?? "_"}`;
    signals.set(key, [...(signals.get(key) ?? []), change]);
  }
  const dir = (key: string): Direction | null => signals.has(key) ? directionOf(signals.get(key)!) : null;
  const notes: string[] = [];

  const arbFront = dir("arb:front"), arbRear = dir("arb:rear");
  if (arbFront && arbRear && arbFront !== "mixed" && arbRear !== "mixed") {
    if (arbFront !== arbRear) {
      const towards = arbFront === "increase" ? "empurrar mais (mais estável)" : "girar mais";
      notes.push(`As barras da frente e de trás foram para lados opostos: é uma decisão só, e as duas levam o carro a ${towards}, então o efeito é maior do que cada uma sozinha.`);
    } else {
      notes.push(`As duas barras foram para o mesmo lado: o equilíbrio muda pouco, o que muda é o carro inteiro ficar ${arbFront === "increase" ? "mais duro e rápido de resposta" : "mais macio e melhor na zebra"}.`);
    }
  }

  for (const axle of ["front", "rear"] as const) {
    const arbAxle = dir(`arb:${axle}`), springAxle = dir(`springs:${axle}`);
    if (arbAxle && springAxle && arbAxle !== "mixed" && springAxle !== "mixed") {
      const where = axle === "front" ? "Na frente" : "Atrás";
      notes.push(arbAxle !== springAxle
        ? `${where}, barra e mola foram para lados opostos e se compensam em parte: a aderência muda pouco, mas a resposta segue a barra.`
        : `${where}, barra e mola foram para o mesmo lado e somam o efeito: a diferença de aderência nesse eixo é grande.`);
    }
  }

  const wingFront = dir("aero:front"), wingRear = dir("aero:rear");
  if (wingFront && wingRear && wingFront !== "mixed" && wingRear !== "mixed") {
    notes.push(wingFront !== wingRear
      ? `As asas foram para lados opostos: o apoio passa ${wingFront === "increase" ? "para a frente, e o carro vira mais em curva rápida" : "para trás, e o carro fica mais estável e empurra mais em curva rápida"}.`
      : "As duas asas foram para o mesmo lado: o equilíbrio fica parecido, muda o apoio total e a velocidade de reta.");
  }

  const brakeBias = dir("brakes:_"), arbFrontOnly = dir("arb:front");
  if (brakeBias && arbFrontOnly && brakeBias !== "mixed" && arbFrontOnly !== "mixed" && brakeBias === arbFrontOnly) {
    notes.push(brakeBias === "increase"
      ? "Freio mais pra frente e barra da frente mais dura somam: freia reto, mas vira bem menos na entrada."
      : "Freio mais pra trás e barra da frente mais macia somam: gira bem mais na entrada; confira se a traseira não fica viva demais na freada forte.");
  }

  const diffChanged = dir("differential:_"), arbRearOnly = dir("arb:rear");
  if (diffChanged && arbRearOnly) {
    notes.push("Diferencial e barra de trás mudaram juntos e os dois mexem na entrada e na saída; teste um de cada vez para saber qual está fazendo efeito.");
  }

  const rideFront = dir("ride_height:front"), wingFrontOnly = dir("aero:front");
  if (rideFront && wingFrontOnly && rideFront === "decrease" && wingFrontOnly === "increase") {
    notes.push("A frente ficou mais baixa e com mais asa ao mesmo tempo: o carro vira bem mais em curva rápida, mas o risco de raspar o fundo na zebra também soma.");
  }

  return notes;
}

/** Narrativa comparativa por categoria: o que o segundo setup faz de diferente do primeiro. */
export function comparativeSummary(changes: ParsedChange[], baseLabel: string, comparisonLabel: string): string {
  const actionable = changes.filter((change) => change.actionable);
  if (!actionable.length) return `Não achei diferença com efeito claro no carro entre o ${baseLabel} e o ${comparisonLabel}.`;

  const byCategory = new Map<string, ParsedChange[]>();
  for (const change of actionable) byCategory.set(change.category, [...(byCategory.get(change.category) ?? []), change]);

  const categoryStats = [...byCategory.entries()].map(([category, items]) => ({ category, count: items.length, direction: directionOf(items) }))
    .sort((a, b) => b.count - a.count);

  const top = categoryStats.slice(0, 3);
  const sentences = top.map((stat, index) => `${index === 0 ? `O ${comparisonLabel}` : "Também"} ${categoryTradeoff(stat.category, stat.direction)}.`);
  const intro = `Do ${baseLabel} para o ${comparisonLabel} mudam ${actionable.length} ${actionable.length > 1 ? "ajustes" : "ajuste"} que o carro sente.`;
  const correlations = crossParameterCorrelations(actionable);
  return [intro, ...sentences, ...correlations].join(" ");
}
