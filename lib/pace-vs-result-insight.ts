/** 09/09/2026: "apesar de ter piorado meu iRating, eu fui mais rápido... meu desvio padrão foi
 * menor, então fui mais consistente, só que cometi erros de tomada de decisão e me envolvi em
 * muitas confusões" -- o piloto validou essa leitura olhando os números; isso cruza os dois lados
 * que hoje vivem em painéis separados (resultado vs. ritmo/consistência) numa frase só, direto na
 * Leitura Rápida, em vez de deixar o piloto somar sozinho. Só dispara quando ritmo e resultado
 * discordam de verdade (ritmo melhora e resultado piora, ou o oposto) -- quando os dois andam juntos
 * não há nada de contraintuitivo pra apontar.
 */

const MATERIAL_SECONDS = 0.02;

export function paceVsResultInsight(opts: {
  netWorse: boolean;
  netBetter: boolean;
  // 09/09/2026: "se o saldo da semana for negativo, não foi bom" -- a frase de "melhorou/piorou"
  // vem pronta de netClause() (lib/race-engineer-analysis.ts) em vez de ser montada aqui, pra nunca
  // chamar uma perda menor de "saldo melhor" -- o mesmo erro de tom que a Leitura Rápida tinha.
  netPhrase: string;
  gapDeltaSeconds: number | null;
  stdDeltaSeconds: number | null;
  incidentsNow: number | null;
  incidentsBefore: number | null;
}): string | null {
  const { netWorse, netBetter, netPhrase, gapDeltaSeconds, stdDeltaSeconds, incidentsNow, incidentsBefore } = opts;
  const paceImproved = gapDeltaSeconds !== null && gapDeltaSeconds < -MATERIAL_SECONDS;
  const paceWorsened = gapDeltaSeconds !== null && gapDeltaSeconds > MATERIAL_SECONDS;
  const consistencyImproved = stdDeltaSeconds !== null && stdDeltaSeconds < -MATERIAL_SECONDS;
  const consistencyWorsened = stdDeltaSeconds !== null && stdDeltaSeconds > MATERIAL_SECONDS;
  const incidentDelta = incidentsNow !== null && incidentsBefore !== null ? incidentsNow - incidentsBefore : null;

  const parts: string[] = [];
  if (paceImproved) parts.push("ficou " + Math.abs(gapDeltaSeconds!).toFixed(3) + "s mais perto da sua melhor volta");
  if (consistencyImproved) parts.push("ficou mais consistente (desvio-padrão " + Math.abs(stdDeltaSeconds!).toFixed(3) + "s menor)");
  const improvedParts = parts.length ? parts.join(" e ") : null;

  const worsenedParts: string[] = [];
  if (paceWorsened) worsenedParts.push("ficou " + Math.abs(gapDeltaSeconds!).toFixed(3) + "s mais distante da sua melhor volta");
  if (consistencyWorsened) worsenedParts.push("ficou menos consistente (desvio-padrão " + Math.abs(stdDeltaSeconds!).toFixed(3) + "s maior)");
  const worsenedText = worsenedParts.length ? worsenedParts.join(" e ") : null;

  if (netWorse && improvedParts) {
    const incidentNote = incidentDelta !== null && incidentDelta >= 1
      ? " Os incidentes por corrida também subiram (" + incidentsNow!.toFixed(1) + " contra " + incidentsBefore!.toFixed(1) + ") -- é o que mais aponta pra decisão de corrida, não pro carro."
      : " O carro e o setup não parecem ser o problema; vale revisar decisões em corrida (largadas, ultrapassagens, gestão de risco em tráfego).";
    return "Seu ritmo " + improvedParts + " em relação à referência, mas " + netPhrase + " mesmo assim." + incidentNote;
  }
  if (netBetter && worsenedText) {
    return "Seu ritmo " + worsenedText + " em relação à referência, mesmo assim " + netPhrase + " -- o resultado veio apesar do carro, não por causa dele.";
  }
  return null;
}
