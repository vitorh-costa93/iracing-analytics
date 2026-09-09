/** 09/09/2026: "eu ganhei iRating em GT3 e a consistência no ritmo foi boa, então eu melhorei,
 * deveria ter sido elogiado" -- a recomendação antiga só olhava perdas severas/sequência negativa
 * pra decidir entre "protocolo de contenção" ou "mantenha a preparação", e IGNORAVA completamente se
 * o saldo da season foi positivo. Uma única corrida ruim isolada numa season claramente boa (GT3:
 * +247 contra -24, ritmo e consistência melhores) disparava a mesma recomendação de "pare de se
 * inscrever" que uma season inteira de perdas -- errado. Agora cruza resultado (net) com ritmo/
 * consistência pra decidir em qual dos 4 quadrantes a season/week está antes de escrever a
 * recomendação, e só trata perdas isoladas como "ponto de atenção", não como o tema principal, quando
 * o resto da amostra está claramente positivo.
 */

export function buildRecommendation(opts: {
  netBetter: boolean;
  netWorse: boolean;
  paceImproved: boolean;
  consistencyImproved: boolean;
  severeCount: number;
  severeThreshold: number;
  worstRunLength: number;
  incidentsWorse: boolean;
}): string {
  const { netBetter, paceImproved, consistencyImproved, severeCount, severeThreshold, worstRunLength, incidentsWorse } = opts;
  const paceGood = paceImproved || consistencyImproved;
  const hadIsolatedTrouble = severeCount > 0 || worstRunLength >= 2;

  if (netBetter && paceGood) {
    const caveatParts: string[] = [];
    if (severeCount) caveatParts.push(severeCount + " perda" + (severeCount === 1 ? "" : "s") + " severa" + (severeCount === 1 ? "" : "s"));
    if (worstRunLength >= 2) caveatParts.push("uma sequência de " + worstRunLength + " corridas seguidas perdendo iRating");
    const caveat = caveatParts.length
      ? " Um ponto isolado pra entender: " + caveatParts.join(" e ") + " apareceu no meio do caminho -- não é o padrão da temporada, mas vale olhar essa corrida específica pra saber se foi um erro pontual ou algo que pode se repetir."
      : "";
    return "Temporada em curva ascendente: resultado e ritmo melhoraram juntos. Continue com a preparação atual -- é isso que está funcionando." + caveat;
  }

  if (netBetter && !paceGood) {
    return "O saldo de iRating melhorou, mas o ritmo ainda não mostra a mesma evolução. Vale não relaxar na preparação: parte do ganho pode estar vindo do nível dos adversários ou de corridas mais tranquilas, não de uma evolução real sua ainda -- confirme isso continuando a acompanhar o ritmo, não só o resultado.";
  }

  if (paceGood) {
    // netWorse (ou estável) com ritmo bom -- o caso "fui mais rápido, mas perdi iRating".
    const incidentNote = incidentsWorse ? " Os incidentes por corrida também subiram, o que reforça essa leitura." : "";
    return "O carro e o ritmo não parecem ser o problema aqui -- o prejuízo está em decisão de corrida." + incidentNote + " Na próxima sessão, o ajuste é de risco, não de setup: saia mais conservador na largada e evite disputa de posição em tráfego até o padrão de perdas parar de se repetir.";
  }

  if (hadIsolatedTrouble) {
    return "Depois de uma queda grande (mais de " + severeThreshold + " de iRating) ou de duas perdas seguidas, pare de se inscrever na próxima e descubra o porquê antes de voltar: foi abandono, perdeu posições logo na largada, ou o ritmo já vinha caindo antes do incidente? Só volte a arriscar depois de confirmar ritmo na sua consistência normal.";
  }

  return "Sem perda grande nem sequência negativa neste recorte -- o trabalho agora é não deixar isso mudar: confirme um ritmo repetível antes de cada corrida e reaja no primeiro sinal de queda de consistência, não depois de já ter perdido posições por causa dela.";
}
