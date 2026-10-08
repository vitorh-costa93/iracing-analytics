# Continuidade — iracing-analytics

## Exportação ociosa de JSON — implementada e validada ao vivo 08/10/2026
- Controle correto: primeiro ícone do rodapé do modal de resultado (botão `menu-button-` à esquerda de "Share Results") -> item "Download JSON". O botão sem nome da lista (~1742;342) baixa outro JSON (lista de sessões), nunca usar. Localizador: `menu-button-` na mesma linha de "Share*" e à esquerda dele. Nomes de botões/links têm caracteres invisíveis: casar por `Contains`/AutomationId, não por `==`.
- Fluxo: Invoke (UIA, sem foco, janela minimizada) -> Download JSON gera `<GUID>.tmp` completo em Downloads e abre diálogo Salvar nativo (#32770, sem título "blob:"; detectar por `FileNameControlHost`). Ler o .tmp com `FileShare.ReadWrite|Delete`, depois BM_CLICK no Cancelar (AutomationId `2`): o Chromium apaga o .tmp, nada fica local.
- `ResultExporter.cs`: ocioso (60 s) + sim fechado, 10 min entre tentativas, 6 h entre varreduras, máx. 5/execução e 20/dia, para na primeira corrida conhecida (GET `/api/agent/ingest` -> ids de 120 dias, 400 linhas), fecha o modal sempre. Teste dev: `RacingAnalyticsAgent.exe --dev-url http://localhost:3000/api/agent/ingest --export-once <arquivo>` (pula só o portão de ociosidade). É app GUI: use `Start-Process -Wait`.
- Validado: 1ª corrida (89199619) lida e reconhecida como conhecida; modal/diálogo/.tmp limpos; `--self-test` PASS (inclui known-skip/dedupe do `EnqueueOfficial`). Ainda não exercitado ao vivo com corrida realmente nova (nenhuma disponível).

## Exportação ociosa de JSON — sondagem 08/10/2026 (sem código alterado)
- Migration `20261008150000` já estava aplicada (`db push --linked` = up to date). API oficial de dados do iRacing descartada: só OAuth2 e a iRacing pausou a criação de client IDs.
- Decisão do usuário: automação em momento ocioso (sim fechado + usuário inativo), exporta os resultados novos, confronta com o Supabase, envia incremental e apaga os JSON locais.
- Achados no iRacingUI.exe (CEF, janela minimizada em -32000): a árvore UIA continua completa com a janela minimizada. Botões `Results` (um por linha da lista) têm InvokePattern e abrem o modal. Há botão `Enter Subsession ID` e paginação (`Last page`/`First page`, 10 por página). Linha da lista: coluna tipo (`P`/`R`) permite filtrar só corridas.
- `PostMessage` de WM_LBUTTON* ao HWND principal (coordenadas de tela convertidas) abriu o menu `Share Results` sem foco. Esse menu só mostra `Copy Permalink` e `Facebook` por nome; o controle de download CSV/JSON do modal NÃO foi achado na árvore UIA (nem por nome JSON/CSV/Download). `AutomationElement.FromPoint` falha com a janela minimizada.
- Na lista há 3 botões sem nome em y≈462 (ordenação, favoritos, download da lista) — o de download da lista pode exportar CSV com todos os subsession IDs; não testado.
- Próximo passo: mostrar a janela sem ativar (`ShowWindow SW_SHOWNOACTIVATE`) e capturar a tela para localizar o controle de download por corrida (só renderiza visível); depois decidir invocação por UIA/clique. Cuidado: abrir modais altera o estado do app do usuário.

## Agente: gravação automática + resultado do SessionInfo — 08/10/2026
- Agente lê a memória compartilhada do SDK (`agent/SimMonitor.cs`), pede início de gravação por broadcast oficial (TelemCommand=**10**, Start=1; o valor 7 é ReloadTextures) e captura a Race do SessionInfo ao vivo (`agent/SessionResult.cs`). Contrato `ibt_result` em `agent/README.md`.
- Servidor: `lib/agent-ibt-result.ts` + `app/api/agent/ingest/route.ts`; migration `20261008150000_agent_ibt_result.sql`. `irating_delta` é ESTIMATIVA (official_irating_* null). Precedência: iracing_agent > irstats > iracing_ibt; o bookmarklet do iRStats reimporta linhas estimadas (knownIds exclui `iracing_ibt`; upsert grava `result_source='irstats'`).
- Achados reais (24 .ibt): SessionInfo do .ibt é snapshot da abertura do arquivo, nenhum com Race oficial; `Position` base 1, `ClassPosition` base 0; `RaceWeek` base 0; DriverInfo usa `UserID`. `IsDiskLogging*` não verificados ao vivo.

## Agente: revisão e teste local — 08/10/2026
- Migration renomeada para `20261008131811` (igual ao remoto). Correções da revisão: upload só tolera 409, `Road` -> `road`, resultados primeiro na fila do agente, retry do debrief só em rede/5xx.
- Teste local (next dev + `--dev-url`, Supabase de produção): resultado de Motegi enviado pelo agente (result_source=iracing_agent, iRating 3370->3421) e 2 voltas com telemetria. Token provisionado (device 475549f8), guardado por DPAPI no estado Dev.
- Exportação em segundo plano: a árvore UIA do iRacing UI hoje expõe os controles (modal-results, botões Results), mas "Share Results" só oferece ExpandCollapse e o Expand não abre o menu; sem InvokePattern não há exportação sem foco. Pendente: decidir entre exportação em momento ocioso ou o usuário exportar manualmente. As últimas 11 corridas ainda não foram reenviadas.
- Não feito: push/deploy; revisão pendente (hash conflito 422 em reexportação, cota compartilhada).

## Ingestão de Motegi — 08/10/2026
- JSON oficial aplicado em race_results no Supabase PRD; linha existente preservada; race_fastest_lap_time preenchida. Uma linha após replay; view confirmou iRating 3370→3421.
- Documentação: PROJECT_CONTEXT.md e docs/IRACING_AGENTE_PROVA.md. Sem código/schema alterado; testes/build não aplicáveis.
- Pendente: importador recorrente e proveniência para impedir sobrescrita pelo iRStats. Esta ingestão não elimina sozinha o fluxo antigo.

## Prova de resultado pelo iRacing UI — 08/10/2026
- Teste concluído: aplicativo autenticado exporta CSV e JSON da subsessão 89199619; ratings e resultado conferidos. Evidência e limites em `docs/IRACING_AGENTE_PROVA.md`.
- Sem código/DB/publicação. Payloads permanecem privados em Downloads.
- Próximo passo: provar exportação sem tomar foco; operação em segundo plano ainda não demonstrada. Cuidado com simsession_type externo e posição com índice zero.

## Estudo MyRaceCraft — 08/10/2026
- Objetivo: explorar o app autenticado e propor oportunidades; relatório em `docs/MYRACECRAFT_ANALISE.md`.
- Estado: módulos principais visitados; duas sessões examinadas; recursos pagos, eventos importados e live timing sem validação integral.
- Validação: evidência de UI e comparação com trechos de PROJECT_CONTEXT; nenhuma alteração funcional, teste/build ou publicação nesta etapa de estudo.
- Pendências: confirmar contratos reais antes de implementar; sugestão inicial é sessão completa + volta ideal auditável + ocorrências. Não é roadmap aprovado.
- Efeito incidental no serviço externo: Novo plano criou Plano sem nome vazio e salvo; preservado por não haver indicação de exclusão recuperável.
- Alterações locais anteriores preservadas; não incluir em commit sem revisar seu escopo.

Atualizado: 05/10/2026. Otimização das instruções instalada; nenhum código funcional alterado nesta etapa.

## Estado e próximo passo
- Não há tarefa funcional em andamento registrada por esta instalação. Confirme `git status -sb` e histórico local antes de continuar; não sobrescreva alterações existentes.
- Leia somente as referências necessárias ao pedido. Regras obrigatórias em `AGENTS.md`.
- Ao encerrar a próxima etapa, substitua este estado pelo objetivo, decisões, caminhos alterados, verificações executadas e pendências reais.
- No live-coach, separar iRacing V3 e AMS2 no registro.

## Entrega mais recente
- Objetivo: a preencher na próxima tarefa funcional.
- Evidência de validação: a preencher; testes da aplicação não foram executados por esta instalação de instruções.
- Pendências: a confirmar pelo usuário/pedido atual; não inferir conclusão de planos históricos.

## Mensagem para novo chat
Trabalhe em `C:\Users\Vitor\Documents\iracing-analytics`. Leia AGENTS.md e as seções pertinentes deste registro; confirme Git e implemente o pedido atual com validação proporcional.
