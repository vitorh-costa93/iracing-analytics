# Continuidade — iracing-analytics

## Correção do loop de abertura do iRacingUI no agente — 26/11/2026
- **Diagnóstico (`agent.log`):** Quando havia `PendingResult` pendente ou o cooldown de `MinInterval` (10 min) estava ativo, `ExportWithUiAsync` abria o `iRacingUI` a cada 15s antes de checar `CanRunNow()`, além de `WatchProcesses()` rearmar `RequestScan` sobre a própria abertura do agente e `Export()` não limpar `PendingResult` quando todas as 10 corridas de `Recent Races` já estavam confirmadas.
- **Correção (`agent/ResultExporter.cs`, `agent/Program.cs`):**
  - Adicionados `CanRunNow()` (impede abrir o `iRacingUI` durante cooldown ou execução concorrente) e `ShouldAutoOpenUi(store)` (só abre o `iRacingUI` automaticamente em ociosidade quando há `PendingResult` ou a cada **6h**, em vez de ficar abrindo sem corrida nova).
  - `Export()` agora limpa `PendingResult = false` ao confirmar todas as corridas de `Recent Races` ou concluir a varredura sem bloqueio (`stop.Length == 0`).
  - `WatchProcesses()` ignora a transição de abertura enquanto `agentOpeningUi` estiver ativo.
- **Validação e entrega:** Publicado `--self-contained true -r win-x64` em `C:\Users\Vitor\Documents\RacingAnalyticsAgent\app\`, `--self-test` PASS e bandeja ativa (PID `5588`).

## Auditoria geral, limpeza de legado e escala 1:1 — 24/11/2026
- **Agente (`agent/Program.cs`):** Adicionado botão `"Puxar últimas corridas agora (abre iRacing UI)"` na janela e item `"Puxar últimas corridas agora"` no menu da bandeja (`RunManualRefresh` / `ExportWithUiAsync`), permitindo que o agente abra o `iRacingUI`, limpe o cache local `SentRaces`, puxe todas as corridas novas contra o servidor, envie via `store.Send` e feche o `iRacingUI` automaticamente. Republicado `--self-contained true -r win-x64`, `--self-test` PASS (18/18) e bandeja ativa (PID `3880`).
- **Escala dos eixos (`RaceScatter`):** `components/overview/RaceScatter.tsx` agora mede o container via `ResizeObserver` mantendo `viewBox` 1:1 em pixels reais (`fontSize={11}`), eliminando o zoom desproporcional dos rótulos dos eixos no desktop.
- **Limpeza Garage61/iRStats:** `lib/data-sync-action.ts`, `app/api/sync/status/route.ts`, `lib/use-sync-status.ts` e `components/AppHeader.tsx` passaram a revalidar diretamente o Supabase e exibir heartbeat/consumo diário do `RacingAnalyticsAgent` (sem chamar `/api/sync/all`, `/api/sync/telemetry`, `/api/sync/rating-history` nem extensão/bookmarklets). `SetupLabView.tsx` removeu `<AppTabs />`, `app/api/setup/inventory/route.ts` removeu a query ociosa em `laps.garage61_payload` e `app/debriefs/page.tsx` redireciona para `/telemetry?tab=debrief`.
- **UX e performance (`Deep Dive` / `Setup Lab`):** `CarCompareView.tsx` (mantido apenas para classes multimarca reais `GT3` e `GTP`) ganhou cache em memória de traces e preservação dos filtros em caso de erro; `RaceDebriefView.tsx` sincroniza `?raceId=`, exibe erros mesmo com debrief prévio e colapsa `BestPassDetail` em `<details>`; `BestPassDetail.tsx` exibe leitura numérica no hover (`%` freio/acel. e `km/h`); `RaceFieldView.tsx` adiciona `<title>` nos pontos do scatter; `EngineerChat.tsx` anexa chips de sintoma sem apagar rascunho; `SetupLabView.tsx` sinaliza setups ainda sem parâmetros decodificados.
- **Cota do agente (`agent/Store.cs` e `supabase/migrations/20261124100000_agent_reserve_25mb_results_exempt.sql`):** `agent_reserve` alinhado com `25 MiB/dia` (`26214400` bytes) e isenção de bytes/requests para `result_field:` e `ibt_result:` (assim como `ibt_setup:`), mantendo o teto de Storage em `700 MiB` e o download budget em `100 MB/dia`.
- **Validação:** `npm test` (557 passed, 1 skipped), `npm run build` PASS, `dotnet build agent/RacingAgent.csproj -c Release` PASS (0 erros/avisos).

## Refresh de Profile > Stats no agente & limpeza Garage61/iRStats na UI — 21/11/2026
- `agent/ResultExporter.cs` e `agent/Program.cs`: `ResultExporter.Export` agora re-navega `Profile > Stats` quando `LastScan >= 30s` (evitando DOM stale do `iRacingUI` aberto) e `Program.cs` passa `WorkingDirectory` ao abrir `iRacingUI.exe`. Republicado `--self-contained true`, `--self-test` PASS e bandeja iniciada (PID `10048`).
- `app/page.tsx`, `components/AppHeader.tsx`, `components/debriefs/DebriefField.tsx`, `components/telemetry/RaceDebriefView.tsx`, `components/setup/SetupComparator.tsx` e `components/setup/SetupLabView.tsx`: removidos atalhos e menções de interface ao `Garage61` e `iRStats` (exibindo `Resultados` / `Telemetria` e `agente`).

## Correções mobile, eixo X semanal e agente self-contained — 20/11/2026
- `RacingAnalyticsAgent`: o último publish (`--self-contained false`) falhou no boot de hoje (`09:55:59`, Event Viewer) por ausência do runtime `.NET 9.0.0` global. Republicado com `--self-contained true -r win-x64`, `--self-test` PASS (18/18) e bandeja iniciada (PID `3908`).
- `app/page.tsx`: removido o card extra de `Safety Rating` no mobile (mantendo os mesmos 3 KPIs do desktop com selo no `iRating`).
- `components/debriefs/DebriefCharts.tsx` e `app/night-grid-debriefs.css`: `WeekPressureBars` (`Δ de iRating por semana`) convertido para altura e linha zero em `%` (`46%` / `40%`), impedindo o eixo X (`W1..W12`) de vazar do painel em qualquer dispositivo sem escalar fonte.
- Validação: `npm test` (557 passed), `npx tsc --noEmit` e `npm run build` PASS.

## Agente: teto 25 MiB/dia e gatilho ocioso de 10 min (mouse/teclado/volante) — 18/11/2026
- Diagnóstico: fila local tinha 20 arquivos retidos após bater `Limite de 10 MiB/dia atingido` em 18/11 (`agent.log`).
- `agent/Store.cs`, `agent/ResultBackfill.cs`, `agent/Program.cs`: teto diário elevado de `10 MiB/dia` para `25 MiB/dia` (`27 MiB` com folga de resultados).
- `agent/IdleMonitor.cs` e `agent/Program.cs`: monitoramento passivo de ociosidade em mouse/teclado (`GetLastInputInfo`) e volante/pedais (`winmm.dll` `joyGetPosEx` sem HidHide). Quando todos os dispositivos ficam ociosos por >= 10 min com simulador fechado e há varredura pendente (`exporter.Due(store)`), o agente abre `iRacingUI.exe`, executa a verificação de resultados e fecha o `iRacingUI.exe` ao concluir.
- Validação: `dotnet build` (0 erros/avisos), `--self-test` (18/18 checks PASS), publicado em `Documents\RacingAnalyticsAgent\app` e bandeja reiniciada (PID 20632).

## Redesign da Visão Geral (Home) — 17/11/2026
- `app/page.tsx`, `app/night-grid-overview.css`, `components/overview/RaceScatter.tsx` e `components/debriefs/DebriefCharts.tsx`: layout split 2 colunas alinhado (`align-items: stretch`, zero espaço vazio) — esquerda com KPIs (`iRating`, `Vitórias`, `Resultado vs Esperado` no lugar de `Sequência`), cabeçalho compartilhado de categoria (`Sports Car` / `Formula Car`) controlando `Race Survival` (`tall` 680×290) e `Δ de iRating por semana` (`WeekPressureBars` `heightPx=230`); direita com `ActiveWeekTelemetry` embarcado.
- `components/ActiveWeekTelemetry.tsx`, `components/telemetry/CornerByCorner.tsx`, `components/telemetry/LapMap.tsx` e `lib/track-map.ts`: no modo embarcado da Visão Geral, exibe os cards históricos de `weeklyContexts` no topo, rotaciona automaticamente o `LapMap` em 90° (`preferLandscape`) quando a pista é mais alta que larga (`210px` de altura), remove a coluna `"Em uma frase"` do `Curva a Curva` compacto com os 4 KPIs em linha única, e abre automaticamente no contexto da última corrida.
- `app/api/dashboard/overview/route.ts`: adiciona `expectedVsReal` por categoria (`formula_car` / `sports_car`) usando `fieldMetricsFor` (`lib/debrief-field-data.ts`).
- `components/overview/LatestRaces.tsx`, `components/TelemetryTabs.tsx`, `components/telemetry/RaceDebriefView.tsx` e `app/api/telemetry/race-debrief/route.ts`: cada corrida na tabela `Últimas corridas` tem ícone direto para `/telemetry?tab=debrief&raceId=<irstats_race_id>`.
- `components/overview/RaceScatter.tsx` e `components/debriefs/DebriefCharts.tsx` (`app/night-grid-debriefs.css`): tooltip equilibrada no `RaceScatter` (`11.5px`/`10px` em `214×48`) e tooltip no hover das colunas de `Δ de iRating por semana` exibindo pista(s) e carro(s) daquela week.
- `app/api/telemetry/history/route.ts`, `components/telemetry/HistoryView.tsx` e `app/night-grid-overview.css`: nova rota `/api/telemetry/history` servindo todo o histórico do iRacing por padrão (com filtro opcional de Season), populando KPIs compactos (sem Saldo Acumulado), `DeltaByContext`/`GapToWinner` em `s/km` com linhas compactas de 1 linha, Matriz Ritmo × Conversão e Sobrevivência/Deixado na pista.
- `app/night-grid-overview.css`, `app/night-grid-debriefs.css`, `app/page.tsx`, `components/debriefs/DebriefCharts.tsx` e `components/telemetry/HistoryView.tsx`: revisão completa do layout mobile (`<= 760px`) — `Curva a Curva` compacto em 3 colunas (sem barra lateral) + 2×2 nos 4 KPIs, `Δ de iRating por semana` em `140px` com toque para abrir a tooltip de pista/carro, e `Deep Dive -> Histórico` com ranking em 2 linhas, controles empilhados e quebra limpa nas listas.
- Validação: `npm test` (557 passed), `npx tsc --noEmit` e `npm run build` PASS.

## Frescor e orçamento de cache — 21/10/2026
- Baseline local/GitHub igual a 684fb41; apenas agent/backfill-run.out e agent/resumo.txt locais não versionados, preservados. Cache de overview gerado 20/10 e reports 17/10; dirty_refreshes=64, refreshes=0. Supabase compartilhado tem migrations de outros projetos: não fazer db push indiscriminado.
- Correção: migration 20261022000128 aplicada; reserva64 para results/ref, fallback normal128, teto192 e leases intactos. lib/analytics-warm-plan.ts prioriza leituras principais, deduplica versões e exclui fresh antes de aquecer. Status/overview revalidam ao foco e 120s visível sem sync.
- SQL real em rollback: fallback64→normal, reserva com normal128, teto192, lease único, histórico/lap-only sem consumir reserva, snapshot STALE sem regressão e upsert idempotente PASS. npm test 544 PASS +1 skip; build PASS. Código e261e94 publicado em PRD READY dpl_FJB341pqHzz5awyL7tPGtrKW3Ybq.
- UI Chrome confirmou quatro linhas em Últimas corridas. HTTP overview HIT com quatro IDs e race-debrief HIT com quatro labels (2,438s), reports week formula/gt3 HIT (569/307ms). Não foi reexecutado sync/backfill nem apagado dado fonte. Contador de downloads estava sem EXECUTE para service_role nos logs; grant server-only restaurado e teste de execução em rollback PASS.
- Migrations adicionais PRD 20261022000631 (reserva hot), 20261022000758 (progresso STALE), 20261022000922 (contador server-only). Sem mudança de código posterior ao build aprovado. Snapshot pendente desaparece por atualização normal; não resetar cotas nem filas para corrigir apresentação.
- Quatro resultados de 21/10 confirmados: 89536363/89538576 Spa SF23, 89537745/89542108 Mugello Aston. Última Mugello enviada automaticamente 22/10 00:00UTC após cota10MiB; não houve bypass ou reimportação manual.

## Correção permanente e PRD — 14/10/2026
- GitHub: 9273f58 (retenção/contrato/referências), d576831 (retry por lease), 11393bd (cache versionado e rotação). PRD Vercel READY em iracing-analytics.vercel.app, deployment dpl_2Nv7wmeHPxBF5C7oygQFFfViLihR. Agente instalado atualizado, bandeja ativa, DPAPI/checkpoints preservados.
- Migrations preserve_agent_telemetry e agent_reference aplicadas. Replay de dois recibos lap_v2 retornou duplicate. Retenção nativa não remove temporada desconhecida; Garage61 não tenta buscar ira_.
- Validação final: npm test 507 PASS + 1 skipped; npm run build PASS; .NET publish/self-test PASS, incluindo escopo DriverInfo, fila, HTTP, lease e rotação de combinações.
- APIs PRD: Semana ativa inclui Imola; referências Corvette/Porsche Indianapolis e SF23 Imola retornam CSV e status ok; resposta no-store. Debrief da primeira Imola tem 15 traces de Race; segunda Imola 24. Todas as oito corridas recentes listadas já têm traces, incluindo 07/10 Ferrari296/Motegi e Ferrari499P/RedBullRing.
- Recuperação completa adicional ficou na fila persistente: 163 payloads restantes no último snapshot, zero quarentena, 74 requests locais e 9.3 MB usados no dia. Cotas originais mantidas; ao alcançar 10 MiB, agente retoma no próximo dia UTC. Não afirmar que todas as voltas históricas já foram restauradas. Sem cron novo ou monitor por LLM.
- Arquivos locais anteriores não relacionados continuam sem commit (relatórios, exemplos, migration 20261013130000 redundante com a reparação nova). Nenhum IBT/JSON privado ou token foi publicado.

## Recuperação SF23 Imola — 14/10/2026
- Instalação local em Documents/RacingAnalyticsAgent/app atualizada a partir do HEAD 297f030; publish self-contained e self-test PASS, token DPAPI e fila preservados; bandeja reiniciada.
- Resultado 89364467 confirmado no Supabase PRD: uma linha iracing_agent, P1, 15 voltas, iRating 5147→5196 (+49). Telemetria já tinha 15 voltas Race + 2 Qualify.
- A varredura --export-once retornou zero novos mesmo com Imola ausente no banco. Recuperação por exportação assistida do JSON no iRacing UI para Downloads; agente enviou com sucesso, fila vazia, PendingResult=false. Não tratar esta recuperação como prova de exportação automática corrigida.
- Referências: Corvette Indianapolis TrackID448 agora disponível na pasta 26S4; Imola SF23 disponível; Porsche Indianapolis localizado no ZIP Downloads. Reprocessamento de referências já coletadas e diagnóstico da varredura automática continuam pendentes. Alterações locais do endpoint/migration de outro trabalho preservadas.

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
