/** Textos dos Debriefs de season e week (redesign etapa 5). Regra de linguagem (docs/redesign-plan.md):
 * conversa de engenheiro de pista com um piloto que entende mais de pilotagem que de estatística.
 * Frases curtas, números inteiros de iRating, vírgula decimal, sinal de menos tipográfico (−), sem
 * "p.p.", "coeficiente", "repetibilidade", "concentração", sem "--", sem rótulos repetidos
 * ("Leitura:", "Recomendação:"). Elogia o que está bom e diz o que fazer. Funções puras, cobertas
 * por lib/debrief-narrative.test.ts. */

import { weekShort } from "@/lib/season-week";

export type Scope = "week" | "season";

export const MINUS = "−";

export function signedInt(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return (rounded > 0 ? "+" : MINUS) + String(Math.abs(rounded));
}

export function dec(value: number, decimals = 1): string {
  const text = Math.abs(value).toFixed(decimals).replace(".", ",");
  return (value < 0 && Number(text.replace(",", ".")) !== 0 ? MINUS : "") + text;
}

export function signedDec(value: number, decimals = 1): string {
  const text = Math.abs(value).toFixed(decimals).replace(".", ",");
  if (Number(text.replace(",", ".")) === 0) return text;
  return (value > 0 ? "+" : MINUS) + text;
}

export const plural = (count: number, singular: string, pluralForm: string) => String(count) + " " + (count === 1 ? singular : pluralForm);
const points = (value: number) => plural(Math.abs(Math.round(value)), "ponto", "pontos");
const NUMBER_WORDS = ["nenhuma", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
const feminine = (count: number) => (count >= 0 && count <= 10 ? NUMBER_WORDS[count] : String(count));
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function movement(net: number): string {
  const rounded = Math.round(net);
  if (rounded > 0) return "o iRating subiu " + points(rounded);
  if (rounded < 0) return "o iRating caiu " + points(rounded);
  return "o iRating ficou no zero a zero";
}

/** Parte da corrida em que a maioria das perdas grandes aconteceu (índice do bin 0–25/…/75–100%). */
export const LOSS_PHASE = ["no começo da corrida", "antes da metade da corrida", "na segunda metade da corrida", "no fim da corrida"] as const;
const LOSS_FOCUS = ["a largada e a primeira volta", "o começo da corrida, antes da metade", "a segunda metade da corrida", "o fim da corrida"] as const;

export type SummaryInput = {
  scope: Scope;
  races: number;
  referenceRaces: number;
  net: number;
  /** Season: saldo total da season anterior. Week: saldo total das demais semanas. */
  referenceNet: number;
  wins: number;
  referenceWins: number;
  severeCount: number;
  severeLossTotal: number;
  gainTotal: number;
  lossTotal: number;
  incidentsNow: number | null;
  incidentsRef: number | null;
  /** Só week: posição desta semana entre as semanas da season (saldo). */
  weekRank?: { best: boolean; worst: boolean; weeks: number };
};

/** Resumo da Leitura Rápida: resultado, o que pesou e (quando muda algo) incidentes. */
export function quickSummary(input: SummaryInput): string {
  const { scope, races, referenceRaces, net, referenceNet, wins, referenceWins, severeCount, severeLossTotal, gainTotal, lossTotal, incidentsNow, incidentsRef, weekRank } = input;
  if (!races) return scope === "week" ? "Nenhuma corrida nesta semana ainda." : "Nenhuma corrida nesta season ainda.";
  const sentences: string[] = [];
  if (scope === "season") {
    const winsText = wins ? "Você teve " + plural(wins, "vitória", "vitórias") + " nesta season, contra " + String(referenceWins) + " na anterior, e " : referenceWins ? "Ainda sem vitória nesta season (na anterior, " + (referenceWins === 1 ? "foi uma" : "foram " + String(referenceWins)) + "), e " : "Em " + plural(races, "corrida", "corridas") + " nesta season, ";
    const reference = referenceRaces ? " (na anterior, " + (Math.round(referenceNet) === 0 ? "ficou no zero a zero" : Math.round(referenceNet) > 0 ? "subiu " + points(referenceNet) : "caiu " + points(referenceNet)) + ")" : "";
    sentences.push(winsText + movement(net) + reference + ".");
  } else {
    const perRace = net / races, refPerRace = referenceRaces ? referenceNet / referenceRaces : null;
    let compare = "";
    if (refPerRace !== null) {
      const gap = perRace - refPerRace, refText = "média de " + signedInt(refPerRace) + " por corrida";
      compare = gap >= 3 ? ", bem acima das outras semanas (" + refText + ")" : gap <= -3 ? ", abaixo das outras semanas (" + refText + ")" : ", parecido com as outras semanas (" + refText + ")";
    }
    sentences.push("Nesta semana você fez " + plural(races, "corrida", "corridas") + " e " + movement(net) + compare + ".");
    const winsTail = wins ? ", com " + plural(wins, "vitória", "vitórias") : "";
    if (weekRank && weekRank.weeks >= 3 && weekRank.best && net > 0) sentences.push("Foi a sua melhor semana da season" + winsTail + ".");
    else if (weekRank && weekRank.weeks >= 3 && weekRank.worst && net < 0) sentences.push("Foi a semana mais cara da season.");
    else if (wins) sentences.push(wins === 1 ? "Teve uma vitória." : "Foram " + String(wins) + " vitórias.");
  }
  if (severeCount > 0) {
    const count = feminine(severeCount), noun = severeCount === 1 ? "perda grande" : "perdas grandes";
    if (net > 0 && gainTotal > 0) {
      const share = severeLossTotal / gainTotal;
      const amount = share >= 0.9 ? "quase tudo" : share >= 0.4 && share <= 0.6 ? "quase metade" : Math.round(share * 100) + "%";
      sentences.push("Mas " + count + " " + noun + " " + (severeCount === 1 ? "engoliu " : "engoliram ") + amount + " do que você ganhou.");
    } else if (lossTotal > 0) {
      const share = Math.round(severeLossTotal / lossTotal * 100);
      sentences.push(capitalize(count) + " " + noun + " " + (severeCount === 1 ? "responde" : "respondem") + " por " + share + "% de tudo o que você perdeu.");
    }
  } else if (net > 0) {
    sentences.push("Nenhuma perda grande: você ganhou sem sustos.");
  } else if (net < 0) {
    sentences.push("Não teve perda grande. O iRating foi embora aos poucos, em várias corridas.");
  }
  if (incidentsNow !== null && incidentsRef !== null) {
    const change = incidentsNow - incidentsRef;
    if (change >= 1) sentences.push("Os incidentes subiram: " + dec(incidentsNow) + " por corrida, contra " + dec(incidentsRef) + ".");
    else if (change <= -0.5) sentences.push("E você correu mais limpo: " + dec(incidentsNow) + " incidentes por corrida, contra " + dec(incidentsRef) + ".");
  }
  return sentences.join(" ");
}

/** Leitura da parte "Quando as perdas acontecem". Volta em três pedaços para o trecho do meio
 * aparecer em negrito na página. */
export type RichText = { before: string; strong?: string; after?: string };

export function lossTimingText(input: { scope: Scope; severeCount: number; bins: number[]; sample: number; averagePct: number | null; referenceSample: number; referenceAveragePct: number | null }): RichText {
  const { scope, severeCount, bins, sample, averagePct, referenceSample, referenceAveragePct } = input;
  const period = scope === "week" ? "nesta semana" : "nesta season";
  if (!severeCount) return { before: "Sem perdas grandes " + period + ". Nada para corrigir aqui." };
  if (!sample) return { before: "As perdas grandes " + period + " não têm telemetria de tempo em pista, então não dá para dizer em que ponto da corrida aconteceram." };
  const top = bins.indexOf(Math.max(...bins));
  const tied = bins.filter((value) => value === bins[top]).length > 1;
  if (sample === 1) return { before: "A única perda grande com telemetria aconteceu ", strong: LOSS_PHASE[top], after: "." + advice(top) };
  if (tied) return { before: "As perdas grandes ficaram espalhadas pela corrida, sem um momento que se repita." };
  let compare = "";
  if (averagePct !== null && referenceAveragePct !== null && referenceSample > 0) {
    const shift = Math.round(averagePct - referenceAveragePct);
    if (Math.abs(shift) >= 5) compare = ", em média " + String(Math.abs(shift)) + "% da corrida " + (shift < 0 ? "mais cedo" : "mais tarde") + " que na referência";
  }
  return { before: "A maioria das suas perdas grandes acontece ", strong: LOSS_PHASE[top], after: compare + "." + advice(top) };
}

function advice(bin: number): string {
  if (bin === 0) return " Largada e primeira volta são o problema, não o ritmo.";
  if (bin === 3) return " Você chega ao fim e perde no resultado: segure a posição em vez de arriscar nas últimas voltas.";
  return " É no meio da corrida, no tráfego: escolha melhor onde disputar posição.";
}

/** Legenda do gráfico "Pressão por semana". */
export function weekPressureSubtitle(weeks: Array<{ week: number; delta: number | null }>): string {
  const withDelta = weeks.filter((item): item is { week: number; delta: number } => item.delta !== null);
  if (!withDelta.length) return "Saldo de cada semana.";
  const worst = withDelta.reduce((a, b) => (b.delta < a.delta ? b : a));
  const best = withDelta.reduce((a, b) => (b.delta > a.delta ? b : a));
  if (worst.delta >= 0) return "Saldo de cada semana. Nenhuma fechou no vermelho; a melhor foi a " + weekShort(best.week) + " (" + signedInt(best.delta) + ").";
  return "Saldo de cada semana. A W" + worst.week + " foi a mais cara da season (" + signedInt(worst.delta) + ").";
}

/** Legenda do gráfico "Corridas da semana". */
export function weekRacesSubtitle(severeCount: number, races: number): string {
  if (!races) return "Nenhuma corrida nesta semana.";
  if (!severeCount) return "Sem perdas grandes nesta semana";
  return capitalize(feminine(severeCount)) + " " + (severeCount === 1 ? "perda grande" : "perdas grandes") + " nesta semana";
}

export { LOSS_FOCUS };
