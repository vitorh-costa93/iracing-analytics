import { talkDuration, talkTime } from "./engineer-talk";
import type { LapCorner } from "./corner-sequences";
import type { SelfSection } from "./self-consistency";

/**
 * Textos do Race Debrief na voz do engenheiro de pista (redesign etapa 4, 26/09/2026). Mesmas regras
 * de lib/engineer-talk.ts: décimos/centésimos, metros, km/h; nada de "p.p.", "Δ" solto, "--",
 * "coeficiente" ou "repetibilidade". Frases-modelo variam por trecho (índice) para a lista não ler
 * como um formulário repetido.
 */

function decimal(value: number, digits: number) {
  return value.toFixed(digits).replace(".", ",");
}

function cap(text: string) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function joinE(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function pick<T>(options: T[], index: number) {
  return options[Math.abs(index) % options.length];
}

/** "na Curva 5", "na sequência 3–4", "em La Source", "em Eau Rouge–Raidillon". */
export function whereIn(corners: LapCorner[]) {
  if (corners.length === 1) return corners[0].name ? `em ${corners[0].name}` : `na Curva ${corners[0].number}`;
  if (corners.every((corner) => corner.name)) return `em ${Array.from(new Set(corners.map((corner) => corner.name as string))).join("–")}`;
  const numbers = corners.map((corner) => corner.number);
  const consecutive = numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1);
  return consecutive ? `na sequência ${numbers[0]}–${numbers[numbers.length - 1]}` : `na sequência ${joinE(numbers.map(String))}`;
}

/** Junta dois lugares encurtando o segundo: "na sequência 6–7 e na 8". */
function joinPlaces(sections: Pick<SelfSection, "corners">[]) {
  const places = sections.map((section) => whereIn(section.corners));
  if (places.length === 2 && places[0].startsWith("na ") && places[1].startsWith("na Curva ")) places[1] = places[1].replace("na Curva ", "na ");
  return joinE(places);
}

/** "1 a cada 3", "2 de 5", "quase todas", "todas". */
export function hitPhrase(hit: number, of: number) {
  if (of <= 0) return "";
  if (hit === of) return "em todas as voltas";
  const ratio = hit / of;
  if (hit === 0) return "em nenhuma volta";
  if (ratio >= 0.85) return "em quase todas as voltas";
  for (const denominator of [2, 3, 4]) {
    if (hit * denominator === of || Math.abs(ratio - 1 / denominator) < 0.02) return `em 1 a cada ${denominator} voltas`;
  }
  return `em ${hit} de ${of} voltas`;
}

function meters(value: number) {
  return `${Math.round(Math.abs(value))} m`;
}

const STABLE_FAST = ["Você repete quase igual em todas as voltas.", "Estável nas voltas boas e nas ruins.", "Pouca diferença entre as voltas rápidas e as lentas."];
const STABLE_IF = ["Ponto forte: pouca variação. Só mantenha.", "Nada a corrigir aqui.", "Continue fazendo igual."];

export type SelfSectionTalk = { fastLaps: string; ifAlways: string; tone: "gain" | "loss" | "neutral" };

/** "O que muda nas suas voltas rápidas" e "Se você fizer sempre assim" de um trecho. */
export function describeSelfSection(section: SelfSection, index: number, canCompareFastSlow: boolean): SelfSectionTalk {
  const diff = section.diff;
  const gain = section.gainIfRepeat ?? 0;
  const hits = section.hits;
  const hitsText = hits && hits.of > 0 && hits.hit < hits.of ? ` Hoje isso sai ${hitPhrase(hits.hit, hits.of)}.` : "";
  const gainText = gain >= 0.01 ? talkTime(gain) : null;

  if (!diff) {
    const reason = canCompareFastSlow
      ? "Poucas passagens com telemetria neste trecho para separar as voltas rápidas das lentas."
      : "Com menos de 5 voltas com telemetria não dá para separar as rápidas das lentas.";
    const worst = worstVariation(section);
    const ifAlways = !worst
      ? "Você repete bem o que faz aqui."
      : worst === "brake" ? "O ponto de freio é o que mais muda: escolha uma referência na pista e freie sempre nela."
        : worst === "throttle" ? "O acelerador é o que mais muda: pise sempre no mesmo momento, sem tranco."
          : "O volante é o que mais muda: vire uma vez só, sem corrigir no meio.";
    return { fastLaps: reason, ifAlways, tone: worst ? "loss" : "neutral" };
  }

  const n = diff.fastLaps;
  // Complemento da frase principal, no mesmo tempo verbal dela ("freou ... e acelerou" / "leva ... e acelera").
  const extraClause = (tense: "past" | "present") => {
    if (section.lever !== "throttle-earlier" && diff.throttleEarlierSeconds !== null && diff.throttleEarlierSeconds >= 0.1) {
      return ` e ${tense === "past" ? "acelerou" : "acelera"} ${decimal(diff.throttleEarlierSeconds, 1)} s mais cedo`;
    }
    if (section.lever !== "carry-speed" && diff.minSpeedGainKmh !== null && diff.minSpeedGainKmh >= 2) {
      return ` e ${tense === "past" ? "levou" : "leva"} ${Math.round(diff.minSpeedGainKmh)} km/h a mais no ponto mais lento`;
    }
    return "";
  };

  switch (section.lever) {
    case "stable":
      return { fastLaps: pick(STABLE_FAST, index), ifAlways: pick(STABLE_IF, index), tone: "gain" };
    case "brake-later":
      return {
        fastLaps: `Nas suas ${n} voltas mais rápidas: freou ${meters(diff.brakeLaterMeters ?? 0)} mais tarde${extraClause("past")}.`,
        ifAlways: `Se você repetir a freada tardia em toda volta, ganha ${gainText ?? "pouco, mas ganha"}.${hitsText}`,
        tone: "loss",
      };
    case "throttle-earlier":
      return {
        fastLaps: `Nas voltas rápidas você volta ao acelerador ${talkDuration(diff.throttleEarlierSeconds ?? 0)} antes${extraClause("present")}.`,
        ifAlways: `Acelerando assim em toda passagem, sobram ${gainText ?? "alguns milésimos"} por volta.${hitsText}`,
        tone: "loss",
      };
    case "no-lift":
      return {
        fastLaps: "Nas voltas lentas você levantou o pé no meio da curva.",
        ifAlways: `Se mantiver o acelerador até o ápice, como nas voltas rápidas, recupera ${gainText ?? "um pouco"}.${hitsText}`,
        tone: "loss",
      };
    case "carry-speed":
      return {
        fastLaps: `Nas voltas rápidas você leva ${Math.round(diff.minSpeedGainKmh ?? 0)} km/h a mais no ponto mais lento${extraClause("present")}.`,
        ifAlways: section.brakeZone
          ? `Soltando o freio um pouco antes em toda volta, dá para buscar ${gainText ?? "um pouco"}.`
          : `Levando essa velocidade até o meio da curva em toda volta, dá para buscar ${gainText ?? "um pouco"}.`,
        tone: "loss",
      };
    case "less-steering":
      return {
        fastLaps: `Nas voltas rápidas você gira ${Math.round(diff.steeringLessDeg ?? 0)}° a menos o volante.`,
        ifAlways: `Virando uma vez só, sem fechar a mais no meio, vale ${gainText ?? "pouco, mas vale"}.`,
        tone: "loss",
      };
    case "smoother":
      return {
        fastLaps: "Nas voltas rápidas você corrige menos o volante aqui.",
        ifAlways: `Com o carro mais assentado em toda passagem, ganha ${gainText ?? "um pouco"}.`,
        tone: "loss",
      };
    default:
      return {
        fastLaps: "Voltas rápidas e lentas parecidas nos pedais: a diferença deve estar no traçado.",
        ifAlways: gainText ? `Tem ${gainText} entre sua média e suas melhores passagens aqui. Compare o traçado no mapa.` : "Pouco a ganhar aqui.",
        tone: gainText ? "loss" : "neutral",
      };
  }
}

function worstVariation(section: SelfSection): "brake" | "throttle" | "steering" | null {
  const entries = (["brake", "throttle", "steering"] as const)
    .map((key) => ({ key, item: section.variation[key] }))
    .filter((entry) => entry.item && entry.item.tone !== "ok");
  if (!entries.length) return null;
  const rank = { warn: 1, bad: 2 } as const;
  return entries.sort((a, b) => rank[b.item!.tone as "warn" | "bad"] - rank[a.item!.tone as "warn" | "bad"])[0].key;
}

/** Quadros "O que você faz certo" / "O que você faz de errado" (no máximo 2 itens cada). */
export function rightAndWrong(sections: SelfSection[]): { right: string[]; wrong: string[] } {
  const right: string[] = [];
  const wrong: string[] = [];

  const steadyBrakes = sections.filter((section) => section.variation.brake?.tone === "ok").sort((a, b) => a.variation.brake!.value - b.variation.brake!.value).slice(0, 2);
  if (steadyBrakes.length) right.push(`Freio muito constante ${joinPlaces(steadyBrakes)}: você acerta o ponto quase sempre.`);
  const steadyThrottle = sections.filter((section) => section.variation.throttle?.tone === "ok" && !steadyBrakes.includes(section)).sort((a, b) => a.variation.throttle!.value - b.variation.throttle!.value).slice(0, 2);
  if (steadyThrottle.length) right.push(`Retomada do acelerador igual em toda volta ${joinPlaces(steadyThrottle)}.`);
  if (right.length < 2) {
    const stable = sections.filter((section) => section.lever === "stable" && !steadyBrakes.includes(section) && !steadyThrottle.includes(section)).slice(0, 2);
    if (stable.length) right.push(`${cap(joinPlaces(stable))} você faz igual nas voltas boas e nas ruins.`);
  }

  const shakyThrottle = sections.filter((section) => section.variation.throttle && section.variation.throttle.tone !== "ok").sort((a, b) => b.variation.throttle!.value - a.variation.throttle!.value).slice(0, 2);
  if (shakyThrottle.length) wrong.push(`${cap(joinPlaces(shakyThrottle))} o acelerador varia muito: às vezes pisa cedo, às vezes demora.`);
  const missedLever = sections
    .filter((section) => (section.lever === "brake-later" || section.lever === "throttle-earlier" || section.lever === "no-lift")
      && section.hits && section.hits.of > 0 && section.hits.hit / section.hits.of < 0.6 && (section.gainIfRepeat ?? 0) >= 0.02)
    .sort((a, b) => (b.gainIfRepeat ?? 0) - (a.gainIfRepeat ?? 0))[0];
  if (missedLever) {
    const what = missedLever.lever === "brake-later" ? "a freada tardia" : missedLever.lever === "throttle-earlier" ? "a retomada cedo do acelerador" : "o pé embaixo até o ápice";
    wrong.push(`${cap(whereIn(missedLever.corners))} você só acerta ${what} ${hitPhrase(missedLever.hits!.hit, missedLever.hits!.of)}.`);
  }
  if (wrong.length < 2) {
    const shakyBrake = sections.filter((section) => section.variation.brake && section.variation.brake.tone !== "ok").sort((a, b) => b.variation.brake!.value - a.variation.brake!.value)[0];
    if (shakyBrake) wrong.push(`${cap(whereIn(shakyBrake.corners))} o ponto de freio muda uns ${meters(shakyBrake.variation.brake!.value * 2)} de uma volta para outra.`);
  }
  if (wrong.length < 2) {
    const shakySteer = sections.filter((section) => section.variation.steering?.tone === "bad").sort((a, b) => b.variation.steering!.value - a.variation.steering!.value)[0];
    if (shakySteer) wrong.push(`${cap(whereIn(shakySteer.corners))} o volante muda bastante entre as voltas: sinal de traçado diferente a cada passagem.`);
  }
  return { right: right.slice(0, 2), wrong: wrong.slice(0, 2) };
}

export type DebriefFacts = {
  gridPosition: number | null;
  finishPosition: number | null;
  incidents: number | null;
  laps: number | null;
  bestLap: number | null;
  cleanAverage: number | null;
  /** segunda metade menos primeira metade das voltas limpas, em segundos (positivo = caiu) */
  paceTrend: number | null;
  microPerMinute: number | null;
  referenceMicroPerMinute: number | null;
  /** fração das freadas a menos de 3 m da mediana do trecho */
  brakeRepeatShare: number | null;
  worstSector: { label: string; spread: number } | null;
  sections: SelfSection[];
};

/** Pontos fortes e de melhoria (3 cada, no máximo), em linguagem de conversa. */
export function strengthsAndImprovements(facts: DebriefFacts): { strengths: string[]; improvements: string[] } {
  const strengths: string[] = [];
  const improvements: string[] = [];
  const gained = facts.gridPosition !== null && facts.finishPosition !== null ? facts.gridPosition - facts.finishPosition : null;

  if (gained !== null && gained >= 2) strengths.push(`Você ganhou ${gained} posições: largou em P${facts.gridPosition} e terminou em P${facts.finishPosition}.`);
  if (facts.brakeRepeatShare !== null && facts.brakeRepeatShare >= 0.7) strengths.push(`Você freou no mesmo ponto em ${Math.round(facts.brakeRepeatShare * 100)}% das freadas. Isso dá confiança pra atacar.`);
  const roundest = facts.sections.filter((section) => section.lever === "stable").sort((a, b) => a.laps - b.laps).pop();
  if (roundest) strengths.push(`${cap(whereIn(roundest.corners).replace(/^(na|em) /, ""))} é o seu trecho mais redondo: quase nada muda de volta para volta.`);
  if (facts.paceTrend !== null && Math.abs(facts.paceTrend) <= 0.15) strengths.push("Ritmo estável do começo ao fim da corrida: sem queda por desgaste de pneu.");
  else if (facts.paceTrend !== null && facts.paceTrend < -0.15) strengths.push(`Você foi ficando mais rápido: a segunda metade da corrida saiu ${talkTime(facts.paceTrend)} por volta mais rápida.`);
  if (facts.incidents === 0) strengths.push("Corrida limpa, sem nenhum incidente.");
  if (facts.bestLap && facts.cleanAverage && facts.cleanAverage - facts.bestLap <= facts.bestLap * 0.005) strengths.push(`Sua média das voltas limpas ficou a só ${talkTime(facts.cleanAverage - facts.bestLap)} da melhor volta: ritmo de corrida perto do seu limite.`);
  if (facts.microPerMinute !== null && facts.referenceMicroPerMinute !== null && facts.microPerMinute <= facts.referenceMicroPerMinute * 0.9) strengths.push(`Você corrige menos o volante que a referência (${Math.round(facts.microPerMinute)} contra ${Math.round(facts.referenceMicroPerMinute)} por minuto): carro na mão.`);

  if (gained !== null && gained <= -2) improvements.push(`Você perdeu ${-gained} posições: largou em P${facts.gridPosition} e terminou em P${facts.finishPosition}. Vale rever no replay onde elas foram.`);
  if (facts.incidents !== null && facts.laps && facts.incidents / facts.laps >= 0.15) improvements.push(`Foram ${facts.incidents} incidentes em ${facts.laps} voltas. Antes de buscar ritmo, feche a porta para os toques e as saídas de pista.`);
  const biggest = [...facts.sections].filter((section) => (section.gainIfRepeat ?? 0) >= 0.03).sort((a, b) => (b.gainIfRepeat ?? 0) - (a.gainIfRepeat ?? 0))[0];
  if (biggest) {
    const how = biggest.lever === "brake-later" ? "freia cedo demais nas voltas lentas" : biggest.lever === "throttle-earlier" ? "demora a voltar ao acelerador nas voltas lentas" : biggest.lever === "no-lift" ? "tira o pé no meio da curva nas voltas lentas" : "não repete o que faz nas voltas boas";
    improvements.push(`${cap(whereIn(biggest.corners).replace(/^(na|em) /, ""))}: você ${how}. É onde está mais tempo a ganhar (${talkTime(biggest.gainIfRepeat ?? 0)} por volta).`);
  }
  if (facts.worstSector && facts.worstSector.spread >= 0.1) improvements.push(`O ${facts.worstSector.label} é onde você mais varia: uns ${talkTime(facts.worstSector.spread)} para mais ou para menos entre as voltas.`);
  if (facts.paceTrend !== null && facts.paceTrend > 0.2) improvements.push(`O ritmo caiu ${talkTime(facts.paceTrend)} por volta na segunda metade. Poupe os pneus nas primeiras voltas.`);
  if (facts.bestLap && facts.cleanAverage && facts.cleanAverage - facts.bestLap > facts.bestLap * 0.01) improvements.push(`Sua média ficou ${talkTime(facts.cleanAverage - facts.bestLap)} acima da melhor volta: falta repetir a volta boa.`);
  if (facts.microPerMinute !== null && facts.referenceMicroPerMinute !== null && facts.microPerMinute >= facts.referenceMicroPerMinute * 1.15) improvements.push(`Você corrige mais o volante que a referência (${Math.round(facts.microPerMinute)} contra ${Math.round(facts.referenceMicroPerMinute)} por minuto). Menos correção costuma ser mais tempo.`);

  if (!strengths.length) strengths.push("Você completou a corrida com voltas suficientes para a análise. Use os trechos abaixo para achar o que manter.");
  if (!improvements.length) improvements.push("Nenhum ponto fraco claro nesta corrida. Busque tempo nos trechos com mais diferença entre suas voltas.");
  return { strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 3) };
}

/** Rótulo curto de variação para as barras: "±4,2 m", "±0,21 s", "±5°". */
export function formatVariation(kind: "brake" | "throttle" | "steering", value: number) {
  if (kind === "brake") return `±${decimal(value, 1)} m`;
  if (kind === "throttle") return `±${decimal(value, 2)} s`;
  return `±${Math.round(value)}°`;
}
