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

A opção **Tentar exportação sem foco (experimental)** é desativada por padrão. Após coletar telemetria de Race, pode inspecionar a janela existente do iRacing UI pelo Windows UI Automation no máximo uma vez a cada dez minutos, somente com simulador fechado e usuário inativo por 60 segundos. Requer que o usuário já tenha aberto o resultado desejado. Invoca somente um controle de exportação JSON com rótulo semântico inequívoco; nenhum controle não identificado é acionado. Na UI instalada observada não existe controle JSON identificável, portanto indica indisponibilidade e mantém o fluxo manual. Não abre menu anônimo, não seleciona corrida por suposição, não habilita porta de depuração nem altera o lançamento do iRacing. Uma solicitação de exportação só é confirmada quando o JSON aparece e é coletado em Downloads.

Somente JSON com `type: "event_result"` e `data` é coletado. O servidor valida a exportação e a associação com o piloto autenticado. As séries são identificadas pelo resultado; o agente não deduz série pela classe/carro.

No IBT são incluídas todas as voltas com início próximo de 0%, fim próximo de 100% e mudança observada para a volta seguinte na mesma sessão. A primeira volta parcial e a última sem cruzamento observado são omitidas. Voltas com boxes/incidentes são enviadas com `clean=false`; incidentes ausentes são `null` e nunca contam como volta limpa. O tempo decorre da passagem observada, com precisão limitada à frequência original do simulador. A origem UTC usa o timestamp de início de gravação do cabeçalho menos o primeiro `SessionTime`; season ausente no YAML é omitida. GPS vem exclusivamente de `Lat`/`Lon`, sem geometria sintética. Dados de sessões sem identificação de piloto, carro ou sessão são recusados.

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

## Desenvolvimento e validação

```powershell
dotnet build agent/RacingAgent.csproj
dotnet run --project agent/RacingAgent.csproj -- --self-test "$env:TEMP\racing-agent-checks.txt"
dotnet run --project agent/RacingAgent.csproj -- --self-test "$env:TEMP\racing-agent-checks.txt" --ibt "C:\caminho\privado.ibt"
dotnet publish agent/RacingAgent.csproj -c Release -r win-x64 --self-contained true -o "$env:LOCALAPPDATA\RacingAnalyticsAgent\releases\win-x64"
```

O self-test usa dados sintéticos para DPAPI, canonicalização, fila/restart, checkpoint e respostas HTTP 200/401/422/429/500; `--ibt` opcional verifica arquivo privado por streaming sem salvar seus payloads. `--result caminho.json` opcional valida o envelope real e sua fila em diretório temporário removido ao final. O relatório contém somente checks e contagem de voltas. Build exige SDK .NET 9; publicação self-contained não exige runtime instalado no PC de destino.

Teste de servidor local é explícito: `--dev-url http://localhost:PORT/api/agent/ingest`; qualquer host não loopback é rejeitado. Sem a flag, o URL de produção é fixo. Desenvolvimento usa estado/fila separado em `%LOCALAPPDATA%\RacingAnalyticsAgent.Dev`. Testes não enviam dados privados a serviços externos.
