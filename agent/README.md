# Agente Windows — Racing Analytics

Aplicativo WinForms de bandeja para Windows x64. A coleta funciona em segundo plano sem abrir ou clicar em janelas. Nenhum IBT bruto é enviado. Token pessoal emitido pela aplicação; não usa `service_role`, OAuth de terceiros nem extração de cookies.

## Instalação

1. Copie a pasta publicada para um caminho permanente e execute `RacingAnalyticsAgent.exe`.
2. Cole o token pessoal na caixa mascarada e pressione **Salvar token**. O token fica protegido por Windows DPAPI, vinculado à sua conta Windows.
3. Se desejar, marque **Iniciar com Windows**. O agente cria somente uma entrada em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` com `--tray`. Mover o executável exige desmarcar e marcar a opção novamente.
4. Fechar a janela minimiza para a bandeja. Use **Sair** no menu da bandeja para encerrar.

O agente varre `Documents\iRacing\telemetry\*.ibt` e `Downloads\eventresult*.json` a cada 15 segundos. Aguarda 30 segundos sem alteração e abre o arquivo exclusivamente antes da leitura. O simulador deve ter fechado o IBT. Ative a gravação de telemetria no iRacing; o agente não habilita gravação silenciosamente.

Arquivos anteriores à primeira execução são excluídos da coleta normal. A ativação, os hashes e a fila sobrevivem a reinícios. Histórico exige ação explícita:

```powershell
.\RacingAnalyticsAgent.exe --backfill
```

Encerre a instância da bandeja antes de executar o backfill. O comando coleta arquivos elegíveis para a fila e termina; reabra o agente para enviar. O backfill continua respeitando limites de tamanho e arquivos ainda abertos. Uma instância por usuário/sessão Windows.

Provisionamento local por arquivo privado: `RacingAnalyticsAgent.exe --configure-token-file caminho.txt` lê o token, protege por DPAPI e termina sem imprimir o conteúdo. Encerre a bandeja primeiro. O agente não apaga o arquivo fornecido; quem provisiona deve removê-lo imediatamente.

## Resultados e limitações

Use **Abrir resultados no iRacing**, abra Results no aplicativo e exporte seu JSON para Downloads. A exportação automática ainda está indisponível nesta implementação base; não há automação por coordenadas, captura de foco nem extração de sessão de navegador. O botão abre o iRacing UI instalado em Program Files somente por ação explícita; se não localizado, orienta abrir manualmente.

A opção **Exportação ociosa de resultados (experimental)** vem ligada por padrão. Com o simulador fechado (sem exigir inatividade do usuário), o agente usa o Windows UI Automation (sem foco, sem coordenadas, sem porta de depuração) no iRacing UI: vai ao perfil (`Profile` → `Stats`) e lê a lista **Recent Races**, que contém só corridas. Se a corrida mais recente for a mesma de `LastTopRace`, não abre nada. Caso contrário abre cada corrida (da mais recente para a mais antiga), lê o `subsessionId` no modal **antes de baixar** e só então aciona o primeiro ícone do rodapé e "Download JSON": lê o `.tmp` completo em Downloads e cancela o diálogo Salvar nativo (o iRacing descarta o arquivo; nada fica local). Confere corrida por corrida e pula as que o servidor já considera conhecidas (`GET /api/agent/ingest`: 120 dias, 400 linhas; conhecida = resultado com o campo da corrida gravado), enfileirando só as novas. `LastResultIds` (últimos 20 ids, informativo) e `LastTopRace` ficam em `state.json`; na primeira execução desta versão (`FieldMigrated`) ambos são zerados e o filtro local deixa de impedir reenvios, de modo que as corridas já gravadas sem campo são reenviadas uma vez (respeitando 5/execução e 20/dia). Guard-rails: 10 min entre tentativas, 6 h entre varreduras, máx. 5 downloads por execução e 20 por dia (checado só na hora de baixar), não opera com simulador aberto nem com modal/diálogo já aberto.

Antes de entrar na fila, o JSON oficial é reduzido no cliente (`ResultReducer.cs`) mantendo o mesmo envelope `{type:"event_result", data}`: saem `livery`, `helmet`, `suit`, `flair_*`, `carcfg`, `friend`, `watched`, pontos de liga/campeonato, CPI/TT rating, `license_change_*`, `weather_result`, entradas de IA, sessões que não sejam Practice/Qualify/Race (simsession_type 3/4/6) e alguns campos do evento (`allowed_licenses`, `series_logo`, ...). Ficam identidade, carro/classe, posições, intervalos, voltas, incidentes, tempos, ratings/licenças antes e depois, `reason_out`, `division`, cabeçalho do evento, clima, pista e splits. A chave do envelope é calculada sobre o JSON reduzido.

### Backfill histórico (explícito, nunca automático)

Baixa os resultados oficiais de **todas as corridas** (só Race, todas as disciplinas e licenças) de 2023 Season 4 até hoje, uma busca por Year/Season em Results & Stats > Results Archive > **Find Past Results** (Year, Season, All Weeks; Practice/Qualifying/Time Trial desmarcados), paginando de 50 em 50, da mais recente à mais antiga. Em cada linha abre o modal **Results**, lê o `subsessionId` antes de baixar, pula ids que o servidor já tem (`GET /api/agent/ingest?scope=all`), baixa, reduz, enfileira e envia (no máximo 8 envios/min; pausa de 2 a 4 s entre corridas). Só com o simulador fechado e sem modal/diálogo aberto. Ignora `MaxPerRun`, `MaxPerDay` e o intervalo de 10 min, mas para limpo no primeiro erro inesperado, quando o envio do agente atingir o limite diário (`DailyLimit`, até 128 requests, e 10 MiB/dia) ou em qualquer recusa do servidor (429/orçamento). Retoma de onde parou (`BackfillDone`, `BackfillKey`, `BackfillIndex` em `state.json`). Progresso em `%LOCALAPPDATA%\RacingAnalyticsAgentackfill.log` (temporada, página, baixadas/conhecidas, motivo da parada; sem nomes nem payloads).

```powershell
# feche o agente da bandeja antes (instância única); o iRacing UI aberto e o simulador fechado
.\RacingAnalyticsAgent.exe --backfill-results [--from 2023-4] [--to 2026-4] [--limit N] [--out resumo.txt]
.\RacingAnalyticsAgent.exe --backfill-results --dry-run [--probe-ids] [--from 2023-4] [--out resumo.txt]
```

`--dry-run` não baixa nem envia: lista a quantidade de corridas por temporada (`--probe-ids` também abre cada modal só para ler o id e contar as já conhecidas). `--limit N` para depois de N downloads (teste). Também há o item **Backfill histórico de resultados** no menu da bandeja (pede confirmação). Dry-run e `--dump-ui` podem rodar com a bandeja aberta.

Ferramentas de desenvolvimento (não usadas em produção): `--export-once [saida]` roda uma passada normal; `--export-test N [saida] [--send]` exporta as N últimas ignorando os ids conhecidos e, com `--send`, envia pela fila real; `--dump-ui saida [comandos]` despeja a árvore UIA para diagnóstico (comandos: nome do elemento, `#AutomationId`, `@focus:id` abre o menu de um campo, `@set:id=valor`, `@patterns:id`, `@id`, `@close`; mostra estado de toggle/seleção/valor).

Somente JSON com `type: "event_result"` e `data` é coletado. O servidor valida a exportação e a associação com o piloto autenticado. As séries são identificadas pelo resultado; o agente não deduz série pela classe/carro.

No IBT são incluídas todas as voltas com início próximo de 0%, fim próximo de 100% e mudança observada para a volta seguinte na mesma sessão. A primeira volta parcial e a última sem cruzamento observado são omitidas. Voltas com boxes/incidentes são enviadas com `clean=false`; incidentes ausentes são `null` e nunca contam como volta limpa. O tempo decorre da passagem observada, com precisão limitada à frequência original do simulador. A origem UTC usa o timestamp de início de gravação do cabeçalho menos o primeiro `SessionTime`; season ausente no YAML é omitida. GPS vem exclusivamente de `Lat`/`Lon`, sem geometria sintética. Dados de sessões sem identificação de piloto, carro ou sessão são recusados.

### Sessões offline e referências de outro piloto (13/10/2026)

- **Test Drive:** `SessionType: Offline Testing` é tratado como Practice. Esses arquivos têm `SubSessionID` 0; o agente usa o instante de início da gravação como id substituto (só para Practice; Race offline é recusada com `ibt_offline_session`). Precisa ser confirmado com um `.ibt` real de Test Drive. A regra de prevalência (corrida > prática, qualify fora) continua sendo do servidor (`active-week`).
- **Referências:** ao coletar uma volta própria com `CarPath` e `TrackID`, o agente procura `Documents\iRacing\setups\<CarPath>\<YYSQ>\*.ibt` (só `.ibt`; nunca abre `.sto`). Compara o `TrackID` do YAML de cada arquivo, lê só as voltas desse arquivo e envia **uma** volta (a mais rápida limpa, sem P2P/Overtake) como `kind: "reference"` com `sourceFile` (só o nome do arquivo). Uma busca por carro/pista/temporada; sem arquivo, tenta de novo no máximo 1x/dia. O servidor guarda uma referência por carro/pista (upsert) e **nunca sobrescreve uma referência enviada manualmente**: o nome da do agente começa com `agent:`.

## Segurança, limites e recuperação

- Endpoint fixo: `https://iracing-analytics.vercel.app/api/agent/ingest`, POST com Bearer token. Redirecionamentos HTTP não são seguidos.
- Limites: IBT 512 MiB; CSV descomprimido 2 MiB/volta; gzip 128 KiB/volta; request de telemetria 512 KiB; resultado 1 MiB; fila + quarentena 100 MiB; 10 requests/minuto; 60 requests/dia UTC por padrão, configurável até 128; 10 MiB de payload/dia UTC.
- CSV com canais compatíveis com `lib/telemetry-trace.ts`, no máximo 20 Hz. Quando necessário, reduz por fatores de dois para caber no gzip, preservando primeira e última amostras. `metadata.sampleRateHz` informa o teto nominal após a redução e `SessionTime` no CSV permite verificar os intervalos reais. Apenas uma volta ocupa memória durante o parsing.
- Estado em `%LOCALAPPDATA%\RacingAnalyticsAgent`: `credential.bin` (DPAPI), `state.json`, `queue/`, `quarantine/`. Payloads da fila têm dados pessoais da sessão e ficam no perfil local; proteja sua conta Windows. Não são logs. Não há logging de token, nomes ou payloads.
- Persistência atômica com flush antes de registrar checkpoint do arquivo. Chaves determinísticas permitem reprocessar após crash sem criar duplicatas no servidor. Sucesso HTTP remove o payload; 401 pausa até salvar novo token; 429 espera pelo menos uma hora ou `Retry-After` maior; 400/422 vão para quarentena; erros temporários usam backoff exponencial com jitter até uma hora.
- Quarentena exige revisão manual. Após corrigir a causa, com o agente fechado, mova os JSONs desejados de `quarantine/` para `queue/` para reenviar. Arquivos incompatíveis continuam no diretório original e o estado indica intervenção necessária. Não remova `state.json` para simular retry, pois isso reinicia a data de ativação e os contadores.
- Falta de disco ou fila cheia preserva o arquivo de origem e não confirma seu checkpoint. Evite remover arquivos originais antes de ver o sucesso.

## Contrato v1

Uma volta por request, `kind: "telemetry"`, `key` = SHA-256 UTF-8 de `subsessionId:customerId:sessionNumber:lapNumber`. `metadata` contém subsessionId/customerId, carName/trackName/trackConfig, sessionNumber/sessionType (`Race`, `Practice`, `Qualify`), startedAt/endedAt ISO UTC, trackLengthMeters; nativeCarId/nativeTrackId e seasonYear/seasonQuarter somente quando presentes no YAML. `lap` contém number, time em segundos, clean, incidents nullable, fuelLevel/fuelUsed nullable e csvGzipBase64. Fuel usado não é negativo: aumento de combustível retorna null.

Resultado: `{version:1,kind:"result",key,export:<JSON original>}`. A chave é SHA-256 da serialização UTF-8 compacta com propriedades ordenadas ordinalmente de forma recursiva; arrays conservam ordem e valores conservam seu JSON numérico original. O backend adapta o JSON original.

Resultado do SessionInfo (`kind: "ibt_result"`, ≤128 KiB): `{version:1,kind:"ibt_result",key,result}`, `key` = SHA-256 UTF-8 de `ibt_result:subsessionId:customerId` (um por subsessão; o agente também deduplica por subsessão em `state.json`). `result` contém origin (`live`|`ibt`), resultsOfficial, official (sempre true; eventos não oficiais não são enviados), customerId, subsessionId, seriesId, seasonId, category (`SportsCar`|`FormulaCar`|`Road`; oval/dirt não), raceWeek (base 0), racedAt (início da sessão Race, ISO UTC), trackId/trackName/trackConfig, `driver{carIdx,carId,carName,licLevel,licSubLevel,lapsLed,incidents,gridPosition}` e `entrants[]` (≤128, só humanos: carIdx, classId, irating, started, position, classPosition, lapsComplete, fastestTime). Nunca contém nomes, UserIDs de terceiros, setup (`CarSetup`) ou o YAML bruto. No SessionInfo real `ResultsPositions.Position` é base 1 e `ClassPosition`/`QualifyResultsInfo.Position` são base 0; o servidor reordena por posição e tolera lacunas.

O servidor grava `race_results` com `result_source='iracing_ibt'`, `points` e `official_irating_*` nulos e `irating_delta` **estimado** (fórmula Elo-like da comunidade, calculada só dentro da classe do piloto; não é o valor oficial). Série: nome da série já conhecida para o mesmo carro/pista em ±7 dias, senão `iRacing série <id>`. Precedência por subsessão: JSON oficial (`iracing_agent`) > iRStats (`irstats`, deltas reais) > estimativa (`iracing_ibt`). A estimativa só insere quando a linha não existe e só atualiza a própria linha; o JSON oficial e o bookmarklet do iRStats a substituem; uma linha `iracing_agent` nunca é rebaixada (trigger `protect_native_result`).

Origem: o SessionInfo dentro do `.ibt` é um snapshot de quando o arquivo abriu (`sessionInfoUpdate=0`), então raramente contém a Race final; o `.ibt` só é usado se a Race estiver com `ResultsOfficial: 1`. A fonte normal é a memória compartilhada oficial do SDK (`Local\IRSDKMemMapFileName`, somente leitura) enquanto o simulador está aberto: o resultado é enviado somente quando fica oficial. Se o piloto sair da sessão/fechar o sim antes da oficialização, o snapshot provisório é descartado (nunca é enviado); a corrida fica marcada como pendente e a exportação ociosa lê Recent Races a cada 10 min (sem o intervalo de 6 h) até trazer o JSON oficial.

Gravação automática (opção da UI, ligada por padrão): com o carro na pista, fora de replay, gravação em disco habilitada no iRacing e `IsDiskLoggingActive=0`, envia a broadcast oficial `RegisterWindowMessage("IRSDK_BROADCASTMSG")` via `SendNotifyMessage(HWND_BROADCAST)` com `irsdk_BroadcastTelemCommand=10` e `irsdk_TelemCommand_Start=1` (wParam `0x0001000A`), no máximo a cada 30 s. Não altera `app.ini`, não toma foco e não injeta teclas. O status na UI mostra apenas estado (conectado/gravando/aguardando), sem dados pessoais.

## Desenvolvimento e validação

Correção de 14/10/2026: referências são verificadas também a partir dos cabeçalhos dos IBTs recentes já processados, no máximo uma vez por hora (40 arquivos, cinco combinações por passada). Arquivos novos ou alterados invalidam o cache de busca; sem mudança, a repetição é diária. Arquivos de referência offline aceitam SubSessionID zero em um modo separado, sem permitir corridas próprias offline. A identificação do carro é restrita a DriverInfo, nunca ResultsPositions. Referências manuais permanecem protegidas no servidor.

Recuperação explícita, com a bandeja fechada: `--scan-references --out resumo.txt` enfileira referências para até 12 combinações recentes; `--requeue-telemetry arquivo.ibt` reenfileira voltas desse arquivo sem apagar checkpoints. Reabra a bandeja para enviar, respeitando a mesma cota. O servidor usa recibos v2 e repara apenas registros nativos de identidade correspondente. A retenção usa o calendário oficial quando falta season no payload; ausência de metadados não autoriza exclusão.

```powershell
dotnet build agent/RacingAgent.csproj
dotnet run --project agent/RacingAgent.csproj -- --self-test "$env:TEMP\racing-agent-checks.txt"
dotnet run --project agent/RacingAgent.csproj -- --self-test "$env:TEMP\racing-agent-checks.txt" --ibt "C:\caminho\privado.ibt"
dotnet publish agent/RacingAgent.csproj -c Release -r win-x64 --self-contained true -o "$env:LOCALAPPDATA\RacingAnalyticsAgent\releases\win-x64"
```

`--scan-ibt [pasta]` (padrão `Documentos\iRacing\telemetry`) lê os `.ibt` locais somente para contar quantos teriam resultado extraível e os motivos de recusa; nada é enfileirado nem enviado. O self-test também cobre SessionInfo/IBT sintéticos, memória compartilhada sintética (broadcast stub) e dedupe por subsessão.

O self-test usa dados sintéticos para DPAPI, canonicalização, fila/restart, checkpoint e respostas HTTP 200/401/422/429/500; `--ibt` opcional verifica arquivo privado por streaming sem salvar seus payloads. `--result caminho.json` opcional valida o envelope real e sua fila em diretório temporário removido ao final. O relatório contém somente checks e contagem de voltas. Build exige SDK .NET 9; publicação self-contained não exige runtime instalado no PC de destino.

Teste de servidor local é explícito: `--dev-url http://localhost:PORT/api/agent/ingest`; qualquer host não loopback é rejeitado. Sem a flag, o URL de produção é fixo. Desenvolvimento usa estado/fila separado em `%LOCALAPPDATA%\RacingAnalyticsAgent.Dev`. Testes não enviam dados privados a serviços externos.
