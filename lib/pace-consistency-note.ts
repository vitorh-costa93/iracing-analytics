/** 09/09/2026: "qual a diferença entre essas duas análises, não tá clara pra mim" -- distância até a
 * melhor volta e desvio-padrão entre voltas medem coisas diferentes (ritmo absoluto vs. repetibilidade)
 * e podem divergir -- exatamente o caso que o piloto viu: ficou mais consistente (desvio-padrão menor)
 * só que numa marcha mais lenta (mais distante da própria melhor volta). Isso é uma leitura real, não
 * ruído, e merece frase própria em vez de deixar o piloto reconciliar dois números sozinho.
 */

const MATERIAL_SECONDS = 0.02;

export function paceConsistencyNote(gapDeltaSeconds: number | null, stdDeltaSeconds: number | null): string | null {
  const gapImproved = gapDeltaSeconds !== null && gapDeltaSeconds < -MATERIAL_SECONDS;
  const gapWorsened = gapDeltaSeconds !== null && gapDeltaSeconds > MATERIAL_SECONDS;
  const stdImproved = stdDeltaSeconds !== null && stdDeltaSeconds < -MATERIAL_SECONDS;
  const stdWorsened = stdDeltaSeconds !== null && stdDeltaSeconds > MATERIAL_SECONDS;

  if (gapImproved && stdImproved) return "Ritmo e repetibilidade melhoraram juntos, sem contrapartida aparente entre os dois.";
  if (gapWorsened && stdImproved) return "Você ficou mais consistente, mas essa consistência veio numa marcha mais lenta: repetiu o mesmo ritmo sem errar, só que abaixo do seu potencial nessa combinação. Recuperar velocidade sem perder essa repetibilidade é o próximo passo, não o contrário.";
  if (gapImproved && stdWorsened) return "Sua volta média ficou mais rápida, mas menos repetível — sinal de que você buscou mais do carro sem ainda reproduzir esse ritmo com precisão de volta a volta.";
  if (gapWorsened && stdWorsened) return "Ritmo e repetibilidade pioraram juntos. Antes de tentar recuperar velocidade, vale confirmar uma sequência de voltas repetíveis de novo.";
  if (gapImproved || stdImproved) return "Uma das duas melhorou; a outra ficou parecida com a referência.";
  if (gapWorsened || stdWorsened) return "Uma das duas piorou; a outra ficou parecida com a referência.";
  return null;
}
