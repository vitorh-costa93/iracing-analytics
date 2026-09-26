/** "O que fazer" dos Debriefs de season/week (reescrito na etapa 5 do redesign, 25/09/2026).
 * Continua cruzando resultado com ritmo antes de decidir (regra de 09/09/2026: uma perda isolada numa
 * season boa não pode virar "pare de se inscrever"), mas agora fala como engenheiro no rádio: duas
 * frases no máximo, elogia o que funciona e aponta um único foco, usando o momento da corrida em que
 * as perdas grandes acontecem (lib/debrief-charts.ts) quando existe.
 */
import { LOSS_FOCUS } from "@/lib/debrief-narrative";

export type RecommendationInput = {
  net: number;
  netBetter: boolean;
  netWorse: boolean;
  paceImproved: boolean;
  consistencyImproved: boolean;
  paceWorsened: boolean;
  severeCount: number;
  /** Índice do bin (0–25/25–50/50–75/75–100%) com mais perdas grandes, e quantas caíram nele. */
  lossFocus: { bin: number; count: number } | null;
  /** Weeks/corridas em que foi rápido e perdeu iRating, sobre o total com ritmo registrado. */
  fastLoss: number;
  pacePoints: number;
  incidentsWorse: boolean;
};

function focusSentence(severeCount: number, lossFocus: RecommendationInput["lossFocus"]): string {
  if (lossFocus && lossFocus.count >= 2) return " O ponto a olhar é " + LOSS_FOCUS[lossFocus.bin] + ", que apareceu em " + lossFocus.count + " das " + severeCount + " perdas grandes.";
  if (severeCount === 1) return " Reveja o replay da perda grande para saber se foi azar ou algo que pode se repetir.";
  return " Reveja o replay das " + severeCount + " perdas grandes e procure o que elas têm em comum.";
}

export function buildRecommendation(input: RecommendationInput): string {
  const { net, netBetter, netWorse, paceImproved, consistencyImproved, paceWorsened, severeCount, lossFocus, fastLoss, pacePoints, incidentsWorse } = input;
  const paceGood = paceImproved || consistencyImproved;
  const raceCraftIssue = pacePoints >= 3 && fastLoss / pacePoints >= 0.3;

  if (net > 0 && !netWorse) {
    const base = "Continue com a preparação atual, ela está funcionando.";
    if (severeCount) return base + focusSentence(severeCount, lossFocus);
    if (incidentsWorse) return base + " Só fique de olho nos incidentes, que subiram.";
    return base + (paceGood ? " O ritmo também evoluiu, então o ganho é seu, não sorte." : " Repita o que fez: mesma rotina de treino antes de cada corrida.");
  }
  if (net > 0) {
    if (severeCount) return "Saldo positivo, mas abaixo da referência. Mantenha a base." + focusSentence(severeCount, lossFocus);
    return "Saldo positivo, mas abaixo da referência. Mantenha a base" + (incidentsWorse ? " e baixe os incidentes, que subiram." : " e busque ritmo nos treinos da próxima pista.");
  }
  if (paceGood || raceCraftIssue) {
    return "O ritmo está aí; o que está custando iRating é a corrida. Largue mais conservador e escolha melhor onde disputar posição." + (incidentsWorse ? " Menos incidentes é o ganho mais rápido agora." : "");
  }
  if (severeCount) {
    return "Depois de uma perda grande, pare e veja o replay antes de se inscrever de novo." + (lossFocus && lossFocus.count >= 2 ? " Foque em " + LOSS_FOCUS[lossFocus.bin] + ", onde as perdas se repetem." : " Volte quando tiver algumas voltas limpas no seu ritmo normal.");
  }
  if (paceWorsened) return "Falta ritmo. Antes da próxima corrida, faça um treino focado em voltas limpas e parecidas na pista da semana.";
  if (netBetter) return "A perda diminuiu, o caminho está certo. Siga treinando a pista antes de correr e evite arriscar nas primeiras voltas.";
  return "O iRating foi embora aos poucos. Escolha uma pista, treine até ter ritmo constante e só então volte a correr nela.";
}
