# irstats.com como fonte de resultados oficiais e iRating

Data: 2026-08-24

## Contexto e objetivo

O painel hoje depende de duas fontes frágeis para resultados/iRating:

- `driving_sessions` (sync incremental do Garage61), usada para season/week, KPIs e gráficos.
- Um matching temporal probabilístico entre corridas e mudanças de `rating_history` (documentado em `PROJECT_CONTEXT.md`), com ~83–92% de acerto e casos ambíguos descartados.
- `official_series_results`, um snapshot manual de wins validado à mão no Results Archive/Series Standings.

O site público `irstats.com/driver/958741` expõe, por corrida oficial, o resultado completo do piloto: posição de largada/chegada, iRating pós-corrida e o delta exato daquela corrida, fastest lap, incidentes, pontos, categoria e semana da season — cobrindo o histórico completo (1.327 corridas confirmadas). Isso elimina a necessidade do matching heurístico e do snapshot manual.

**Objetivo**: tornar `irstats.com` a fonte de verdade para season/week, iRating, resultados oficiais e wins. Garage61 permanece como fonte exclusiva de telemetria (voltas) e setups.

## Investigação da fonte

- `GET https://irstats.com/driver/958741/races?page=N` — lista paginada (50/página, 27 páginas), HTML estático server-rendered. Sem chamadas XHR/fetch client-side (confirmado via inspeção de rede): todo o conteúdo já vem no HTML da resposta.
- `GET https://irstats.com/race/{id}` — detalhe de uma corrida, com a tabela completa de resultado (todos os pilotos), incluindo a linha do piloto com license, SR, iRating pós-corrida, delta (`+73` etc.), carro, grid, `+/-`, laps, laps led, fastest lap, incidentes, pontos. Cabeçalho da página traz SOF, categoria (`Formula Car`/`Sports Car`), week e data/hora UTC.
- Rate limiting agressivo: requisições consecutivas rápidas retornam HTTP 429. Um `fetch` simples (sem JS/headless) funciona; é necessário espaçar requisições e fazer retry com backoff.
- Login via iRacing OAuth existe no site (revela nomes ocultos de terceiros) — não é necessário: os dados do próprio piloto (autenticado como dono do perfil por padrão no link do driver) já vêm completos sem login.

## Arquitetura

### Módulo de acesso e parsing

`lib/irstats.ts`: cliente HTTP (`fetch` nativo) + parsing HTML com `cheerio` (nova dependência). Duas funções principais:

- `fetchRaceListPage(driverId, page)` → lista de `{ irstatsRaceId, raceUrl }` na ordem em que aparecem (mais recente primeiro).
- `fetchRaceDetail(raceId, driverName)` → um `RaceResult` parseado (todos os campos da tabela abaixo) para a linha do piloto identificado pelo nome do perfil.

Erros de parsing (estrutura HTML inesperada, coluna ausente) lançam exceção explícita — nunca inferir/gerar valor. Requisições incluem um delay configurável entre chamadas e retry com backoff exponencial (poucas tentativas) em resposta 429.

### Endpoint de sync

`app/api/sync/irstats/route.ts`, protegido pelo mesmo segredo (`CRON_SECRET`) do sync do Garage61.

- **Modo incremental** (padrão): lê a página 1 da lista; para cada corrida cujo `irstats_race_id` ainda não existe em `race_results`, busca o detalhe e insere; para assim que encontrar o primeiro ID já conhecido (a lista é ordenada por mais recente primeiro), assumindo que não há corridas fora de ordem.
- **Modo backfill** (`?mode=backfill`, disparado manualmente uma vez): percorre as 27 páginas da lista, agregando todos os `irstats_race_id` ainda ausentes, e importa o detalhe de cada um, com delay maior entre chamadas. Idempotente — pode ser interrompido e retomado.

Cada execução registra progresso/erro em `sync_runs` (tabela já existente para observabilidade).

### Agendamento

Supabase Cron adiciona uma chamada ao endpoint de sync incremental do irstats no mesmo job horário (minuto 7) que já existe para o Garage61, ou como um segundo job próximo — a decidir na implementação pela forma mais simples de configurar no `supabase/config.toml`/migration de cron.

### Papel do Garage61 após a mudança

O sync do Garage61 deixa de popular `driving_sessions` para fins de season/week/KPIs. Passa a servir só:

- `ActiveWeekTelemetry`: localizar/pré-carregar a volta (telemetria) do par carro+pista da semana ativa — a semana ativa passa a ser determinada pela corrida mais recente em `race_results`.
- `SetupLab`/Engenheiro: setups por carro+pista da season atual, como hoje.
- Manter o snapshot atual de `ratings` (iRating/SR exatos, já sincronizado hoje) atualizado — vira a âncora exata usada para reconstruir a série histórica de iRating a partir dos deltas de `race_results` (ver seção "Correção: iRating exato via encadeamento de deltas"). A sincronização completa de `rating_history` deixa de ser necessária para esse fim.

`driving_sessions` deixa de ser escrita pelo sync recorrente; não é removida nesta mudança (pode ficar como tabela legada/não utilizada, sem migration de remoção — fora de escopo).

## Modelo de dados

### Nova tabela `race_results`

| Coluna | Tipo | Origem/observação |
|---|---|---|
| `id` | uuid, PK | gerado |
| `irstats_race_id` | bigint, unique not null | ID da corrida no irstats (`/race/{id}`) |
| `driver_id` | uuid, FK `drivers` | |
| `raced_at` | timestamptz not null | data/hora UTC da corrida |
| `series_name` | text | |
| `track_name` | text | |
| `car_name` | text | |
| `car_id` | int null, FK `cars` | resolvido por match de nome contra o catálogo já sincronizado do Garage61; `null` quando não há correspondência exata (nunca inventado) — necessário para os rankings GT3/IMSA que hoje dependem de `car_group_members` |
| `track_id` | int null, FK `tracks` | mesmo critério de match por nome |
| `category` | text not null | `formula_car` / `sports_car`, direto do irstats |
| `season_week` | int null | "Week N" quando presente na página |
| `license_class` | text | ex. `A` |
| `safety_rating` | numeric | ex. `3.31` |
| `irating_delta` | int not null | variação exata daquela corrida (ex. `+73`) |
| `irating_display` | text | valor abreviado exibido pelo irstats pós-corrida (ex. `5.2k`) — só para exibição/depuração, nunca usado em cálculo |
| `grid_position` | int | |
| `finish_position` | int not null | |
| `position_change` | int | coluna `+/-` |
| `laps` | int | |
| `laps_led` | int | |
| `fastest_lap_time` | interval/text | formato `1:27.305` preservado como texto ou convertido para intervalo |
| `incidents` | int | |
| `points` | int | |
| `sof` | int | strength of field da corrida (do cabeçalho da página de detalhe) |
| `imported_at` | timestamptz not null default now() | controle de sync |

Índices: `unique(irstats_race_id)`, `(driver_id, raced_at)`, `(driver_id, category)`.

### Correção: iRating exato via encadeamento de deltas

Inspeção do HTML confirmou que o irstats só expõe o iRating pós-corrida **arredondado** (ex. `5.2k`, sem `title`/`data-*` com o valor preciso); apenas o delta da corrida (`+73`) é exato. Não é possível gravar um `irating_after` exato diretamente de cada corrida.

Solução adotada: `race_results` guarda apenas `irating_delta` (exato). O iRating exato em qualquer ponto do tempo é reconstruído por encadeamento a partir de uma **âncora exata** — o snapshot atual de `ratings` (tabela já populada pelo Garage61, valor exato e atual) — subtraindo os deltas das corridas mais recentes até a mais antiga, em ordem cronológica inversa, por categoria. O Garage61 sync passa a rodar também para manter esse snapshot de `ratings` atualizado (além de telemetria/setups), mesmo sem mais sincronizar `driving_sessions`/`rating_history` completos.

### Views afetadas

`v_season_summary`, `v_season_category_summary`, `v_season_weekly_irating`, `v_historical_performance` são reescritas para ler de `race_results` (mapeando `raced_at` → season/week via o calendário de seasons já existente, documentado em `PROJECT_CONTEXT.md`) em vez de `driving_sessions` + `rating_history` + `v_race_irating_candidates`.

### Estruturas depreciadas

- `v_race_irating_candidates` e a lógica de matching probabilístico: removidas (substituídas por `irating_delta` exato por corrida).
- `official_series_results`: deixa de ser necessária; wins/detalhamento por série passam a vir de `race_results` (`finish_position = 1`, considerando multiclass quando aplicável). Não removida fisicamente nesta mudança — apenas deixa de ser escrita/lida pela UI.

## Migração do frontend

- `app/api/dashboard/overview/route.ts`: reescrito para consultar `race_results`/views novas.
- `app/page.tsx`, `components/KpiCard.tsx`, `components/PerformanceRanking.tsx`, `components/RaceTable.tsx`, `components/SeasonChart.tsx`: ajustados aos novos formatos de dado vindos da API (nomes de campo, presença de `fastest_lap_time` e `points` que antes não existiam).
- `ActiveWeekTelemetry`/`SetupLab`: passam a obter "semana ativa" (carro+pista vigente) a partir da corrida mais recente em `race_results`, mantendo a consulta ao Garage61 apenas para telemetria/setups desse contexto.

## Tratamento de erros e riscos

- **429 do irstats**: backoff exponencial com poucas tentativas; se esgotar, a execução do cron aborta sem alterar dados existentes — o painel continua servindo o último estado sincronizado.
- **Mudança de estrutura HTML**: parser falha explicitamente (exceção + log em `sync_runs`) em vez de gravar dado incorreto ou inventado.
- **Idempotência**: `irstats_race_id` único evita duplicação em reimportações/backfill retomado.
- **Dependência de terceiro sem contrato/API oficial**: o layout do irstats pode mudar sem aviso e quebrar o parser; risco aceito para uso pessoal, sem SLA.
- **Dados de terceiros no HTML**: nomes de outros pilotos aparecem parcialmente ocultos; não são usados — só a linha do próprio piloto é extraída.

## Fora de escopo

- Telemetria detalhada (voltas, canais) e setups: permanecem 100% Garage61, sem mudança.
- Login/OAuth com irstats: não implementado nesta mudança.
- Remoção física de `driving_sessions`, `official_series_results`, `v_race_irating_candidates` e das rotas/tabelas de matching: ficam como legado não utilizado, não removidas nesta mudança.
