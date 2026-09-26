/** Frase curta que reconcilia as duas medidas de ritmo da telemetria (distância média até a melhor
 * volta e variação entre voltas), mostrada no item "Consistência dos pedais" da Evidência dos
 * Debriefs. Reescrita na etapa 5 do redesign (25/09/2026) em linguagem de pista: "constante" em vez
 * de "repetibilidade"/"desvio-padrão". Elas podem divergir (09/09/2026: mais constante, só que mais
 * lento), e isso merece ser dito em vez de deixar o piloto reconciliar dois números.
 */

const MATERIAL_SECONDS = 0.02;

export function paceConsistencyNote(gapDeltaSeconds: number | null, stdDeltaSeconds: number | null): string | null {
  if (gapDeltaSeconds === null && stdDeltaSeconds === null) return null;
  const gapImproved = gapDeltaSeconds !== null && gapDeltaSeconds < -MATERIAL_SECONDS;
  const gapWorsened = gapDeltaSeconds !== null && gapDeltaSeconds > MATERIAL_SECONDS;
  const stdImproved = stdDeltaSeconds !== null && stdDeltaSeconds < -MATERIAL_SECONDS;
  const stdWorsened = stdDeltaSeconds !== null && stdDeltaSeconds > MATERIAL_SECONDS;

  if (gapImproved && stdImproved) return "Mais rápido e mais constante que na referência. É isso que sustenta o resultado.";
  if (gapWorsened && stdImproved) return "Você ficou mais constante, só que num ritmo mais lento. Agora é buscar velocidade sem perder essa constância.";
  if (gapImproved && stdWorsened) return "Suas voltas ficaram mais rápidas, mas variaram mais. Falta repetir esse ritmo volta após volta.";
  if (gapWorsened && stdWorsened) return "Ritmo e constância caíram. Antes de buscar tempo, volte a fazer voltas limpas e parecidas.";
  if (gapImproved) return "Suas voltas ficaram mais perto da sua melhor volta; a constância ficou igual. Bom sinal.";
  if (stdImproved) return "Você ficou mais constante volta a volta; o ritmo ficou igual. Bom sinal.";
  if (gapWorsened) return "Suas voltas ficaram mais longe da sua melhor volta; a constância ficou igual.";
  if (stdWorsened) return "Suas voltas variaram mais que na referência; o ritmo médio ficou igual.";
  return "Ritmo e constância parecidos com a referência.";
}
