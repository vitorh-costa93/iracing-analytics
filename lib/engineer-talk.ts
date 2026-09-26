import type { LapCorner } from "./corner-sequences";
import type { SectionMetrics, SectionResult } from "./lap-analysis";

/**
 * Textos do Telemetry Lab na voz de um engenheiro de pista (redesign etapa 3, 25/09/2026).
 *
 * O piloto entende mais de pilotagem que de telemetria: fala em décimos/centésimos de segundo,
 * metros mais cedo/tarde, km/h e % de pedal. Nada de "p.p.", "pontos percentuais", "Δ" solto, "--" ou
 * frases de relatório ("Também reparei que", "Ganho relevante aqui:"). Direção (esquerda/direita) só
 * aparece quando lib/lap-analysis.ts marcou o lado como confiável.
 */

export type Tone = "loss" | "gain" | "neutral";
export type TalkChip = { k: string; v: string; tone: Tone };
export type SectionTalk = { note: string; detail: string; chips: TalkChip[]; tag: "Onde perde" | "Ponto forte" };

const MINUS = "−";

function decimal(value: number, digits: number) {
  return value.toFixed(digits).replace(".", ",");
}

/** "+0,093 s" / "−0,172 s" (ganho positivo, perda negativa, como na lista curva a curva). */
export function formatSignedSeconds(gainSeconds: number, digits = 3) {
  const rounded = Number(gainSeconds.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${decimal(Math.abs(rounded), digits)} s`;
}

/** "0,318 s" sem sinal. */
export function formatSeconds(seconds: number, digits = 3) {
  return `${decimal(Math.abs(seconds), digits)} s`;
}

/** Diferença de tempo falada: "uns 5 centésimos", "cerca de 1,7 décimo", "cerca de 1,2 segundo". */
export function talkTime(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 0.005) return "menos de 1 centésimo";
  if (s < 0.095) {
    const n = Math.round(s * 100);
    return n <= 1 ? "cerca de 1 centésimo" : `uns ${n} centésimos`;
  }
  if (s < 0.995) {
    const tenths = Math.round(s * 100) / 10;
    const text = Number.isInteger(tenths) ? String(tenths) : decimal(tenths, 1);
    return `cerca de ${text} décimo${tenths >= 2 ? "s" : ""}`;
  }
  const secs = Math.round(s * 10) / 10;
  const text = Number.isInteger(secs) ? String(secs) : decimal(secs, 1);
  return `cerca de ${text} segundo${secs >= 2 ? "s" : ""}`;
}

/** Duração curta falada: "meio segundo", "3 décimos de segundo", "1,2 segundo". */
export function talkDuration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s >= 0.45 && s < 0.55) return "meio segundo";
  if (s < 0.95) {
    const n = Math.max(1, Math.round(s * 10));
    return `${n} décimo${n > 1 ? "s" : ""} de segundo`;
  }
  const secs = Math.round(s * 10) / 10;
  return `${Number.isInteger(secs) ? secs : decimal(secs, 1)} segundo${secs >= 2 ? "s" : ""}`;
}

/** "0,5 s" para os chips. */
function chipDuration(seconds: number) {
  return `${decimal(Math.abs(seconds), 1)} s`;
}

type PartRef = { sub: string; de: string; em: string };

/** Como falar de uma curva no meio da frase: "a 3" / "da 3" / "na 3", ou pelo nome verificado. */
export function partRef(corner: LapCorner): PartRef {
  if (corner.name) return { sub: corner.name, de: `de ${corner.name}`, em: `em ${corner.name}` };
  return { sub: `a ${corner.number}`, de: `da ${corner.number}`, em: `na ${corner.number}` };
}

function cap(text: string) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function joinClauses(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

type ClauseKind =
  | "brake-early" | "brake-late" | "brake-own" | "brake-ref"
  | "min-slow" | "min-fast" | "throttle-late" | "throttle-early"
  | "exit-slow" | "exit-fast" | "throttle-less" | "throttle-more"
  | "brake-harder" | "brake-softer" | "steer-more" | "steer-less" | "gear" | "line";

type Clause = { kind: ClauseKind; bad: boolean; weight: number; long: string; short: string; chip: TalkChip };

const ADVICE: Partial<Record<ClauseKind, string>> = {
  "brake-early": "Vá adiando a freada aos poucos, de 2 em 2 metros.",
  "brake-own": "Tente passar só tirando o pé, sem frear, e veja se o carro aguenta.",
  "min-slow": "Tente soltar o freio um pouco antes e levar mais velocidade até o ponto mais lento.",
  "throttle-late": "Tente voltar ao acelerador assim que o carro apontar para a saída.",
  "exit-slow": "Priorize a saída: aponte o carro mais cedo e acelere com o volante mais aberto.",
  "throttle-less": "Segure o pé no acelerador um pouco mais de tempo.",
  "brake-harder": "Tente pisar um pouco mais leve no freio e soltar de forma mais suave.",
  "steer-more": "Tente virar uma vez só, sem corrigir no meio da curva.",
  "gear": "Teste a marcha da referência no treino antes de levar para a corrida.",
  "line": "Confira no mapa o traçado da referência e tente passar pelo mesmo ponto.",
  "brake-late": "Você freia mais tarde, mas perde no resto da curva: tente frear um pouco antes e soltar o freio mais cedo.",
};

/** Achados do trecho, na voz "você" (sem o sujeito, que vem da frase anterior). */
export function sectionClauses(metrics: SectionMetrics, isSequence: boolean): Clause[] {
  const clauses: Clause[] = [];
  const m = metrics;
  const apex = isSequence && m.apexCorner ? ` ${partRef(m.apexCorner).em}` : " no meio da curva";

  if (m.brakeUse === "both" && m.brakeDeltaMeters !== null && Math.abs(m.brakeDeltaMeters) >= 5) {
    const meters = Math.round(Math.abs(m.brakeDeltaMeters));
    const early = m.brakeDeltaMeters < 0;
    clauses.push({
      kind: early ? "brake-early" : "brake-late", bad: early, weight: meters * 1.5,
      long: early ? `freia uns ${meters} metros antes da referência` : `freia uns ${meters} metros depois da referência`,
      short: early ? "freia cedo demais" : "freia mais tarde",
      chip: { k: "Ponto de freio", v: `${meters} m mais ${early ? "cedo" : "tarde"}`, tone: early ? "loss" : "gain" },
    });
  } else if (m.brakeUse === "own") {
    clauses.push({ kind: "brake-own", bad: true, weight: 14, long: "pisa no freio onde a referência passa sem frear", short: "freia onde a referência não freia", chip: { k: "Freio", v: "você freia, a referência não", tone: "loss" } });
  } else if (m.brakeUse === "ref") {
    clauses.push({ kind: "brake-ref", bad: false, weight: 14, long: "passa sem frear onde a referência freia", short: "passa sem frear", chip: { k: "Freio", v: "a referência freia, você não", tone: "gain" } });
  }

  if (m.minSpeedDeltaKmh !== null && Math.abs(m.minSpeedDeltaKmh) >= 2) {
    const v = Math.round(Math.abs(m.minSpeedDeltaKmh));
    const slow = m.minSpeedDeltaKmh < 0;
    clauses.push({
      kind: slow ? "min-slow" : "min-fast", bad: slow, weight: v * 3,
      long: slow ? `chega ${v} km/h mais devagar${apex}` : `leva ${v} km/h a mais${apex}`,
      short: slow ? `chega devagar${apex}` : `leva mais velocidade${apex}`,
      chip: { k: "Velocidade no meio", v: `${v} km/h mais ${slow ? "devagar" : "rápido"}`, tone: slow ? "loss" : "gain" },
    });
  }

  if (m.throttleOnDelaySeconds !== null && Math.abs(m.throttleOnDelaySeconds) >= 0.1) {
    const late = m.throttleOnDelaySeconds > 0;
    clauses.push({
      kind: late ? "throttle-late" : "throttle-early", bad: late, weight: Math.abs(m.throttleOnDelaySeconds) * 60,
      long: late ? `só volta ao acelerador ${talkDuration(m.throttleOnDelaySeconds)} depois` : `volta ao acelerador ${talkDuration(m.throttleOnDelaySeconds)} antes`,
      short: late ? "demora a voltar ao acelerador" : "acelera mais cedo",
      chip: { k: "Acelerador na saída", v: `${chipDuration(m.throttleOnDelaySeconds)} mais ${late ? "tarde" : "cedo"}`, tone: late ? "loss" : "gain" },
    });
  }

  if (m.exitSpeedDeltaKmh !== null && Math.abs(m.exitSpeedDeltaKmh) >= 2) {
    const v = Math.round(Math.abs(m.exitSpeedDeltaKmh));
    const slow = m.exitSpeedDeltaKmh < 0;
    clauses.push({
      kind: slow ? "exit-slow" : "exit-fast", bad: slow, weight: v * 2.5,
      long: slow ? `sai ${v} km/h mais devagar` : `sai ${v} km/h mais rápido`,
      short: slow ? "sai mais devagar" : "sai mais rápido",
      chip: { k: "Velocidade na saída", v: `${v} km/h mais ${slow ? "devagar" : "rápido"}`, tone: slow ? "loss" : "gain" },
    });
  }

  if (m.throttleAvgDeltaPct !== null && Math.abs(m.throttleAvgDeltaPct) >= 8) {
    const p = Math.round(Math.abs(m.throttleAvgDeltaPct));
    const less = m.throttleAvgDeltaPct < 0;
    clauses.push({
      kind: less ? "throttle-less" : "throttle-more", bad: less, weight: p * 1.2,
      long: less ? `usa ${p}% a menos de acelerador no trecho` : `usa ${p}% a mais de acelerador no trecho`,
      short: less ? "alivia o acelerador" : "fica mais tempo no acelerador",
      chip: { k: "Acelerador", v: `${p}% a ${less ? "menos" : "mais"}`, tone: less ? "loss" : "gain" },
    });
  }

  if (m.brakePeakDeltaPct !== null && Math.abs(m.brakePeakDeltaPct) >= 8) {
    const p = Math.round(Math.abs(m.brakePeakDeltaPct));
    const harder = m.brakePeakDeltaPct > 0;
    clauses.push({
      kind: harder ? "brake-harder" : "brake-softer", bad: harder, weight: p * 0.8,
      long: harder ? `pisa ${p}% mais forte no freio` : `pisa ${p}% mais leve no freio`,
      short: harder ? "pisa forte demais no freio" : "freia mais leve",
      chip: { k: "Freio", v: `${p}% a ${harder ? "mais" : "menos"}`, tone: harder ? "loss" : "gain" },
    });
  }

  if (m.steeringDeltaDeg !== null && Math.abs(m.steeringDeltaDeg) >= 8) {
    const d = Math.round(Math.abs(m.steeringDeltaDeg));
    const more = m.steeringDeltaDeg > 0;
    clauses.push({
      kind: more ? "steer-more" : "steer-less", bad: more, weight: d * 0.8,
      long: more ? `gira o volante ${d}° a mais que a referência` : `gira o volante ${d}° a menos que a referência`,
      short: more ? "gira mais o volante" : "vira menos o volante",
      chip: { k: "Volante", v: `${d}° ${more ? "mais fechado" : "mais aberto"}`, tone: more ? "loss" : "gain" },
    });
  }

  if (m.gearAtApex && m.gearAtApex.own !== m.gearAtApex.ref && m.gearAtApex.own > 0 && m.gearAtApex.ref > 0) {
    const { own, ref } = m.gearAtApex;
    clauses.push({
      kind: "gear", bad: true, weight: 12,
      long: `usa a ${own}ª onde a referência usa a ${ref}ª`,
      short: "usa outra marcha",
      chip: { k: "Marcha no ponto mais lento", v: `${own}ª, a referência usa ${ref}ª`, tone: "neutral" },
    });
  }

  if (m.lineOffsetMeters !== null && m.lineOffsetMeters >= 1.5) {
    const meters = Math.round(m.lineOffsetMeters);
    const where = m.lineSide ? `mais à ${m.lineSide} que a referência` : "longe do traçado da referência";
    clauses.push({
      kind: "line", bad: true, weight: meters * 6,
      long: `passa uns ${meters} metros ${where}${apex}`,
      short: "faz outro traçado",
      chip: { k: "Traçado", v: m.lineSide ? `${meters} m mais à ${m.lineSide}` : `${meters} m afastado`, tone: "neutral" },
    });
  }

  return clauses.sort((a, b) => b.weight - a.weight);
}

const TIE_SECONDS = 0.005;

/** Ordem em que as coisas acontecem na curva: a causa-raiz é a primeira fase que dá errado (frear
 * cedo leva a chegar devagar, que leva a acelerar tarde), então o conselho mira nela. */
const PHASE: Record<ClauseKind, number> = {
  "brake-early": 0, "brake-late": 0, "brake-own": 0, "brake-ref": 0, "brake-harder": 1, "brake-softer": 1,
  "steer-more": 2, "steer-less": 2, "line": 3, "min-slow": 4, "min-fast": 4, "gear": 5,
  "throttle-late": 6, "throttle-early": 6, "throttle-less": 7, "throttle-more": 7, "exit-slow": 8, "exit-fast": 8,
};
const byPhase = (a: Clause, b: Clause) => PHASE[a.kind] - PHASE[b.kind];

function tradeOff(section: SectionResult): { note: string | null; detail: string | null } {
  if (!section.isSequence) return { note: null, detail: null };
  const parts = section.parts.map((part) => ({ ...part, gain: -part.lostSeconds, ref: partRef(part.corner) }));
  const payers = parts.filter((part) => part.gain < -TIE_SECONDS);
  const winners = parts.filter((part) => part.gain > TIE_SECONDS);
  const net = -section.lostSeconds;
  if (payers.length && winners.length) {
    const payer = payers.reduce((a, b) => (a.gain < b.gain ? a : b));
    const winner = winners.reduce((a, b) => (a.gain > b.gain ? a : b));
    const payerFirst = parts.indexOf(payer) < parts.indexOf(winner);
    if (payerFirst && net >= 0) {
      return {
        note: `você sacrifica ${payer.ref.sub} para sair forte ${winner.ref.de}, e a troca compensa`,
        detail: `Você entra um pouco devagar ${payer.ref.em} (perde ${talkTime(payer.gain)}), só que isso deixa o carro alinhado e você ganha ${talkTime(winner.gain)} ${winner.ref.em}.`,
      };
    }
    if (payerFirst) {
      return {
        note: `você sacrifica ${payer.ref.sub}, mas não recupera tudo ${winner.ref.em}`,
        detail: `Você perde ${talkTime(payer.gain)} ${payer.ref.em} e recupera só ${talkTime(winner.gain)} ${winner.ref.em}: a troca ainda não paga.`,
      };
    }
    return {
      note: `você entra forte ${winner.ref.em}, mas paga ${payer.ref.em}`,
      detail: `Você ganha ${talkTime(winner.gain)} ${winner.ref.em}, mas paga ${talkTime(payer.gain)} ${payer.ref.em}.${net < 0 ? ` Aqui costuma valer entrar um pouco mais devagar ${winner.ref.em} para sair melhor ${payer.ref.de}.` : ""}`,
    };
  }
  if (payers.length) {
    const total = payers.reduce((sum, part) => sum + part.gain, 0);
    const worst = payers.reduce((a, b) => (a.gain < b.gain ? a : b));
    if (payers.length === 1 || worst.gain / total >= 0.7) return { note: null, detail: `A perda está quase toda ${worst.ref.em} (${talkTime(worst.gain)}).` };
    return { note: null, detail: "A perda se espalha pela sequência inteira." };
  }
  if (winners.length) {
    const best = winners.reduce((a, b) => (a.gain > b.gain ? a : b));
    return { note: null, detail: `O ganho vem principalmente ${best.ref.em}.` };
  }
  return { note: null, detail: null };
}

function sequenceIntro(section: SectionResult) {
  const first = partRef(section.corners[0]);
  const last = partRef(section.corners[section.corners.length - 1]);
  const names = section.corners.length === 2
    ? `${cap(first.sub)} e ${last.sub} são uma coisa só`
    : `${cap(joinClauses(section.corners.map((corner) => partRef(corner).sub)))} são uma sequência só`;
  return `${names}: o que você faz na entrada ${first.de} decide como você sai ${last.de}.`;
}

function neutralChips(metrics: SectionMetrics): TalkChip[] {
  const chips: TalkChip[] = [];
  if (metrics.minSpeedDeltaKmh !== null) chips.push({ k: "Velocidade no meio", v: "igual", tone: "neutral" });
  if (metrics.throttleOnDelaySeconds !== null) chips.push({ k: "Acelerador na saída", v: "igual", tone: "neutral" });
  if (metrics.brakeDeltaMeters !== null) chips.push({ k: "Ponto de freio", v: "igual", tone: "neutral" });
  if (metrics.exitSpeedDeltaKmh !== null) chips.push({ k: "Velocidade na saída", v: "igual", tone: "neutral" });
  return chips;
}

/** Texto completo de um trecho (linha da lista + popup). */
export function describeSection(section: SectionResult, options: { isBiggestLoss?: boolean } = {}): SectionTalk {
  const gain = -section.lostSeconds;
  const loss = gain < -TIE_SECONDS;
  const tie = Math.abs(gain) <= TIE_SECONDS;
  const clauses = sectionClauses(section.metrics, section.isSequence);
  const bad = clauses.filter((clause) => clause.bad);
  const good = clauses.filter((clause) => !clause.bad);
  const trade = tradeOff(section);

  const chips: TalkChip[] = clauses.slice(0, 3).sort(byPhase).map((clause) => clause.chip);
  for (const chip of neutralChips(section.metrics)) {
    if (chips.length >= 3) break;
    if (!chips.some((item) => item.k === chip.k)) chips.push(chip);
  }

  const sentences: string[] = [];
  if (section.isSequence) sentences.push(sequenceIntro(section));
  if (trade.detail) sentences.push(trade.detail);

  let note: string;
  if (tie) {
    sentences.push(section.isSequence ? "No total você fica empatado com a referência na sequência." : "Aqui você fica empatado com a referência.");
    sentences.push("Nada a corrigir.");
    note = "Igual à referência.";
  } else if (loss) {
    const time = talkTime(gain);
    const where = section.isSequence ? "na sequência" : "aqui";
    sentences.push(options.isBiggestLoss && Math.abs(gain) >= 0.1
      ? `É a maior oportunidade da volta: você perde ${time} ${where}.`
      : `Você perde ${time} ${where}.`);
    const top = bad.slice(0, 3).sort(byPhase);
    const causes = top.map((clause) => clause.long);
    if (causes.length) {
      sentences.push(`${cap(causes.length === 1 ? `você ${causes[0]}` : joinClauses(causes))}.`);
      const primary = top[0].kind;
      const steeringToo = bad.some((clause) => clause.kind === "steer-more");
      sentences.push(primary === "throttle-late" && steeringToo ? "Tente abrir o volante um pouco antes para poder pisar mais cedo." : ADVICE[primary] ?? ADVICE["line"]!);
    } else {
      sentences.push("Não aparece um motivo claro nos pedais nem no volante. Compare os traçados no mapa e veja se você passa pelo mesmo ponto.");
    }
    const shorts = bad.slice(0, 2).sort(byPhase).map((clause) => clause.short);
    note = trade.note
      ? `${cap(trade.note)}.`
      : shorts.length ? `Você ${joinClauses(shorts)}.` : "Perde tempo sem um motivo claro nos pedais; confira o traçado.";
  } else {
    const time = talkTime(gain);
    sentences.push(section.isSequence ? `No total sobra ${time} a seu favor.` : `Você ganha ${time} aqui.`);
    const reasons = good.slice(0, 2).sort(byPhase).map((clause) => clause.long);
    if (reasons.length) sentences.push(`${cap(reasons.length === 1 ? `você ${reasons[0]}` : joinClauses(reasons))}.`);
    sentences.push(section.isSequence ? "Não mexa nisso." : "Continue assim.");
    const shorts = good.slice(0, 2).sort(byPhase).map((clause) => clause.short);
    note = trade.note
      ? `Ponto forte. ${cap(trade.note)}.`
      : shorts.length ? `Ponto forte. Você ${joinClauses(shorts)}.` : "Ponto forte, sem diferença clara nos pedais.";
  }

  return { note, detail: sentences.join(" "), chips, tag: loss ? "Onde perde" : "Ponto forte" };
}
