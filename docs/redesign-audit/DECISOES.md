# Decisões da auditoria (26/09/2026)

Regra do piloto: "Se você fez algo que agora é melhor, perfeito, mas se tiver dúvida se é melhor, me pergunte."
Portanto: RESTAURAR o que existia e estava correto (reaproveitando o código/rota original de `94c4d8d`, não reescrevendo);
manter o que é claramente melhor; NÃO decidir sozinho o que é julgamento: registrar como pergunta no relatório final.

## APLICAR (decidido)
Visão Geral / Setup Lab (relatório A):
- A1 Evolução semanal: manter os minigráficos E restaurar o gráfico antigo (SeasonChart, com hover, delta por semana e Safety Rating, código em 94c4d8d:components/SeasonChart.tsx) num painel recolhível abaixo dos KPIs, com a paleta Night Grid. Semana sem `iratingEnd`: repetir o último valor conhecido (regra do CLAUDE.md), nunca plotar `iratingFirst`/`iratingBeforeWeek` como se fosse final.
- A2 Gap para o vencedor: manter por segmento (aba) e voltar a mostrar o gap geral (todas as classes) como linha de resumo.
- A3 Limiares de "atrasado" no cabeçalho (Garage61 36 h, iRStats 7 dias): manter.
- Restaurar: colunas Melhor volta e Série e o ano na data na tabela de corridas; na comparação A/B exibir topCategories, topContributors, skippedCount e total verificado (a rota já devolve); DataFreshness com falha recente do Garage61 e data dos setups fora do tooltip; frase de amostra mínima de 2 corridas e "volta elegível" nos contextos; valor absoluto da season anterior no KPI de iRating; versionar a chave de cache `iracing-dashboard-overview-v1` para v2; prompt do engenheiro com aviso do .sto em toda resposta com proposta e alinhar `passos` (prompt x código); frase de biblioteca local privada.
Telemetry Lab (relatório B):
- B5 Semana ativa: voltar o comparativo de microcorreções contra a referência (dado em lib/microcorrections.ts) no popup/resumo; RPM e média de inputs ficam de fora.
- B6 Gráfico da volta: seção recolhível "Mais canais" (fechada por padrão) com os canais antigos (volante, RPM, embreagem, aceleração lateral/longitudinal, yaw), reaproveitando o código de 94c4d8d:components/ActiveWeekTelemetry.tsx.
- B7 Race Debrief: voltar mapa local e curvas de freio/acelerador da melhor passagem (idealLine da rota antiga) para os 3 trechos com mais ganho, dentro da linha do trecho.
- B8 Race Debrief: piso de 5 voltas (não 3); manter o descarte em duas pontas (lentas e sujas).
- B9 Dispersão do ritmo por volta: voltar, compacta, dentro do painel Ritmo, com as voltas descartadas marcadas.
- B10 Curva a curva do debrief: manter o "terço mais rápido" e mostrar também a melhor passagem individual.
- B11 Comparação de carros: manter o foco (você × 1 rival) e restaurar o aviso `conditionsNote` (pista molhada x seca, borracha).
- Restaurar: `selectionExplanation` e a legenda da volta (data/hora) da volta representativa; resíduo `straightsLostSeconds` ("retas e transições") no resumo do curva a curva e da comparação; consistência por setor pelo critério RELATIVO antigo (`consistencyLabel(sd, avg)`: 0,3%/0,8%/1,6%, de 94c4d8d:app/api/telemetry/sectors/route.ts) no lugar do limite absoluto; tirar dados de race_results/iRating do payload em cache do Race Debrief (como o winnerGap antigo); corrigir o rótulo do KPI de microcorreções (a referência é a volta enviada pelo piloto); corrigir docs/DATA_ARCHITECTURE.md (Meu Debrief com 5 voltas).
Debriefs (relatório C):
- C12 Ritmo × resultado: aceitar o eixo "sua melhor volta no mesmo carro e pista"; título "Você foi perto do seu melhor, mas perdeu iRating?".
- C13 Restaurar a tabela melhorou/piorou/estável (lib/season-comparison.ts + bloco seasonComparison da rota) dentro de Evidência.
- C14 Manter o resumo no lugar da "Leitura do engenheiro"; conferir se cobre; se um achado do tipo watch (atenção) do modal antigo não aparecer em nenhuma frase, restaurar só esse.
- C16 Contextos: ranking e barra por MÉDIA por corrida, nas duas telas (Visão Geral e Debriefs), mesmo critério de mínimo de corridas.
- Restaurar: severidade completa em Evidência (taxa, referência, total, share, pior sequência = `base.severity`), gap e desvio-padrão em segundos (`gapDeltaSeconds`, `stdDeltaSeconds`), tempo/progresso e chip de confiança (driver/confirmed/probable) nos abandonos, `avgPositionChange` e `shareOfLosses` nos contextos, frase "Referência: média das outras weeks..." na week; remover do payload o que a tela não usa, sem mexer em regras.

## NÃO MEXER até o piloto responder (perguntar no relatório final)
- Q4 texto "como você vai sentir / quando usar" da comparação de setups (heurístico): deixar como está, apenas garantir que a tela diga que é orientação.
- Q15 correlação com o ritmo (mín. 15 voltas): não implementar ainda (Telemetry Lab ou Evidência?).
- Q17 ordem de prioridade em lib/recommendation.ts (e pace-vs-result-insight/pace-consistency-note): NÃO alterar; montar um comparativo lado a lado (antes x agora, com 4 a 6 cenários de entrada) em docs/redesign-audit/comparativo-recomendacao.md para o piloto decidir.

## INTOCÁVEIS
lib/corner-detection.ts e lib/track-corners.ts (revisão do piloto); regra de session_type = 3; guard-rails de custo do plano gratuito.
