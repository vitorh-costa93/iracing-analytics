/** "Ritmo e resultado" da Leitura Rápida dos Debriefs (reescrito na etapa 5 do redesign, 25/09/2026).
 * Antes era uma frase só para o caso "ritmo melhorou, resultado piorou". Agora lê a dispersão ritmo ×
 * resultado (lib/debrief-charts.ts): em quantas weeks/corridas o resultado acompanhou o ritmo e o que
 * aconteceu nas que não acompanharam. A telemetria (distância média até a melhor volta, Garage61)
 * entra como confirmação quando ela contradiz o resultado -- o caso que o piloto pediu para ver em
 * 09/09/2026 ("fui mais rápido, só que cometi erros de tomada de decisão").
 */
import type { PacePoint, Quadrant } from "@/lib/debrief-charts";
import { dec, plural } from "@/lib/debrief-narrative";

const MATERIAL_SECONDS = 0.02;

export type PaceVsResultInput = {
  unit: "week" | "race";
  points: PacePoint[];
  quadrants: Record<Quadrant, number>;
  split: number | null;
  /** Saldo pior/melhor que a referência. */
  netWorse: boolean;
  netBetter: boolean;
  /** Variação da distância média até a melhor volta (telemetria), em segundos; negativo = mais perto. */
  gapDeltaSeconds: number | null;
};

const unitWord = (unit: "week" | "race", count: number) => (unit === "week" ? (count === 1 ? "week" : "weeks") : count === 1 ? "corrida" : "corridas");

export function paceVsResultInsight(input: PaceVsResultInput): string {
  const { unit, points, quadrants, split, netWorse, netBetter, gapDeltaSeconds } = input;
  const total = points.length;
  if (!total || split === null) return "Ainda não há volta de corrida registrada para cruzar ritmo e resultado.";
  const sentences: string[] = [];
  if (unit === "race") {
    const average = points.reduce((sum, point) => sum + point.gapPct, 0) / total;
    sentences.push("Sua melhor volta ficou, em média, a " + dec(average, 1) + "% da sua referência em cada pista.");
  }
  if (total < 3) {
    sentences.push("Ainda são poucas " + unitWord(unit, 2) + " com volta registrada para tirar conclusão.");
    return sentences.join(" ");
  }
  const aligned = quadrants.fastGain + quadrants.slowLoss;
  if (aligned === total) {
    sentences.push("O resultado acompanhou o ritmo em todas as " + String(total) + " " + unitWord(unit, total) + ", sem surpresa.");
  } else {
    sentences.push("O ritmo acompanha o resultado em " + String(aligned) + " de " + plural(total, unitWord(unit, 1), unitWord(unit, 2)) + ".");
    if (quadrants.fastLoss > 0) {
      const fastLossPoints = points.filter((point) => point.gapPct <= split && point.delta <= 0);
      const others = points.filter((point) => !(point.gapPct <= split && point.delta <= 0));
      const incidentsOf = (list: PacePoint[]) => { const values = list.map((point) => point.incidents).filter((value): value is number => value !== null); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
      const lossIncidents = incidentsOf(fastLossPoints), otherIncidents = incidentsOf(others);
      const incidentNote = lossIncidents !== null && otherIncidents !== null && lossIncidents - otherIncidents >= 1 ? ", com mais incidentes que o normal. O problema foi a corrida, não o carro" : "";
      sentences.push((quadrants.fastLoss === 1 ? "Em uma" : "Em " + String(quadrants.fastLoss)) + ", você foi rápido e mesmo assim perdeu iRating" + incidentNote + ".");
    }
    if (quadrants.slowGain > 0) sentences.push((quadrants.slowGain === 1 ? "Em uma" : "Em " + String(quadrants.slowGain)) + ", ganhou mesmo sem o melhor ritmo: boa leitura de corrida.");
  }
  if (gapDeltaSeconds !== null && netWorse && gapDeltaSeconds < -MATERIAL_SECONDS) sentences.push("A telemetria confirma: suas voltas ficaram " + dec(Math.abs(gapDeltaSeconds), 2) + " s mais perto da sua melhor volta do que na referência.");
  else if (gapDeltaSeconds !== null && netBetter && gapDeltaSeconds > MATERIAL_SECONDS) sentences.push("Atenção: na telemetria suas voltas ficaram " + dec(gapDeltaSeconds, 2) + " s mais longe da sua melhor volta. O resultado veio antes do ritmo.");
  return sentences.join(" ");
}
