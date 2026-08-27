# Arquitetura de dados — Racing Analytics

Inventário conferido no banco Supabase vinculado em 27/08/2026, após completar a migração de resultados/iRating para o iRStats (backfill completo: 1.330+ corridas, carreira inteira). Para uma amostra atual de qualquer relação, use a CLI (sem expor secrets):

```powershell
npx supabase db query --linked "select * from public.NOME_DA_TABELA limit 1"
```

## Fontes e fluxo

```text
Garage61 ──────────────────────────────────────────────────┐
  sessões, voltas, setores, telemetria, setups              │
  (extensão Chrome / rotas server-side, cron horário)       │
                                                              ▼
iRStats (irstats.com) ──────────────────────────────> Supabase ──> Next.js (Vercel)
  resultados, Δ iRating exato, wins                          │      Overview / Telemetry / Setup / Debrief
  (bookmarklet no navegador — servidor é bloqueado            │
   pelo Cloudflare, ver seção "Atualizar dados" abaixo)      │
                                                              │
Supabase Storage ────────────────────────────────────────────┘
  CSV de referência e arquivos de setup (apenas metadados/caminho nas tabelas)
```

**Divisão de responsabilidade (decisão de 27/08/2026):**

- **Garage61** é a fonte exclusiva de **telemetria, voltas, setores e setups**. Não alimenta mais iRating, resultados oficiais ou os KPIs de season — essas tabelas continuam sendo sincronizadas (`driving_sessions`, `laps`, `lap_sectors`, `setup_files`) porque o Meu Debrief e o Setup Lab ainda precisam localizar qual sessão/volta analisar, mas os números que o piloto vê no Overview não vêm mais delas.
- **iRStats** é a fonte única de **resultados de corrida, Δ iRating exato e vitórias**. Cobre a carreira inteira (desde a primeira season), ao contrário do `rating_history` do Garage61 que só tem ~10 meses de histórico. `rating_history` e `race_rating_matches` (matching heurístico) ficam como tabelas legadas, não lidas nem escritas pelo caminho recorrente — mantidas apenas para não quebrar nada que ainda referencie o schema antigo.
- **Snapshot oficial do iRacing** (`official_series_results`) é dispensável: era um snapshot manual de 11 linhas para cobrir a lacuna que o iRStats resolve de forma automática e completa hoje. A tabela não é lida por nenhuma rota ativa.

| Fonte | Dados que alimenta | Regra de atualização |
|---|---|---|
| Garage61 | `drivers`, catálogos (`cars`, `tracks`, `car_groups`, `car_group_members`, `car_rating_categories`), `sessions`, `driving_sessions`, `laps`, `lap_sectors`, `setup_files`, `ratings` (snapshot atual — âncora exata para reconstruir o iRating do iRStats), telemetria | Cron horário (`/api/cron/hourly-sync`): catálogo + `ratings` + `driving_sessions` incremental. Setups via extensão Chrome, deduplicados pelo evento Garage61. |
| iRStats | `race_results` (resultados, Δ iRating exato por corrida, wins) | Bookmarklet no navegador (`public/irstats-import.js`) — ver "Por que não é 100% automático" abaixo. Idempotente por `irstats_race_id`. |
| Supabase Storage | CSV da referência e arquivos de setup | Apenas metadados e caminho ficam nas tabelas. |
| ~~Snapshot oficial~~ | ~~`official_series_results`~~ | **Descontinuado.** Tabela preservada, não lida por nenhuma rota. |

No frontend, `/` consome as views de temporada, resultados e ratings (todas `race_results`-sourced); `/telemetry` consome a semana ativa (agora determinada pela corrida mais recente em `race_results`, não mais por `driving_sessions`) e as sessões/voltas Garage61 para a telemetria em si; o Meu Debrief consome `driving_sessions` (para achar a corrida com ≥5 voltas completadas de cada categoria) e `race_debriefs` como cache.

## Por que não é 100% automático (botão "Atualizar dados")

irstats.com está atrás de um challenge JavaScript da Cloudflare que bloqueia **qualquer requisição de servidor** — confirmado empiricamente: o mesmo deploy Vercel, o sandbox de agente e `curl` puro recebem HTTP 403 com página "Just a moment...", independente de User-Agent ou headers. Só um navegador real, com sessão já validada pela Cloudflare, passa.

Isso significa que **sincronização 100% automática do iRStats não é viável** com a arquitetura atual (Vercel serverless). Avaliação honesta das alternativas:

| Opção | Viabilidade | Custo/complexidade |
|---|---|---|
| Bookmarklet no navegador (atual) | ✅ Funciona bem | Baixo — um clique/comando, mas exige ação humana |
| Headless browser (Playwright) num cron | ⚠️ Provavelmente funciona, mas arriscado | Alto — Vercel serverless não suporta bem Chromium; exigiria um serviço externo (Browserless, Browserbase) ou uma VM própria, com custo recorrente |
| GitHub Actions com browser real, agendado | ⚠️ Não testado | Médio — GitHub Actions roda em IPs de datacenter também sujeitos a bloqueio Cloudflare; precisaria validar antes de investir |
| Proxy residencial | ⚠️ Tecnicamente viável | Alto — custo recorrente, mais uma dependência externa, e ainda pode ser detectado por fingerprinting além do IP |

**Recomendação:** manter o bookmarklet como está. Ele já é rápido (um comando, ~3-5 min para o incremental do dia a dia já que só busca corridas novas) e resiliente (retry automático em bloqueio temporário, retoma de onde parou). O ganho de automatizar 100% não compensa o custo/risco de qualquer alternativa viável hoje. Se o Cloudflare da irstats.com mudar de comportamento no futuro, a rota `/api/sync/irstats` já existe e pode voltar a ser chamada pelo cron sem mudança de schema.

## Tabelas base

| Tabela | Fonte | Papel | Amostra real |
|---|---|---|---|
| `race_results` | **iRStats** | Resultado de corrida completo: posição, Δ iRating exato, SOF, pontos, melhor volta. Única fonte de verdade para resultados e iRating. | `{car_name: "Ferrari 499P", track_name: "Road Atlanta", category: "sports_car", finish_position: 5, grid_position: 10, irating_delta: 42, laps: 30, points: 140, sof: 4287, season_week: 11, series_name: "IMSA iRacing Series - Fixed", raced_at: "2026-08-26T21:45:00Z", irstats_race_id: 88256963}` |
| `driving_sessions` | Garage61 | Sessão normalizada — hoje usada só para localizar telemetria/setup (Meu Debrief, Setup Lab), não mais para season/week/KPIs. | `{car_id: 180, track_id: 40, session_type: 3, started_at: "2026-08-26T21:59:04Z", ended_at: "2026-08-26T22:38:08Z", lap_count: 33, season_id: "34", garage61_event_id: "01M100VSD504VRNT3466MF0TWK"}` |
| `laps` | Garage61 | Unidade de telemetria por volta, com flags de validade e o payload bruto do Garage61 em `garage61_payload`. | `{lap_number: 16, lap_time: 7.097, clean: false, incomplete: true, can_view_telemetry: true, car_id: 175, track_id: 380, driver_rating: 3618}` (volta incompleta, abandono em pista) |
| `lap_sectors` | Garage61 | Tempos de setor por volta, usados pelo Meu Debrief/Consistência por Setor. | `{lap_id: "01K83C56BSGK7WRFMEY73BQE08", sector_number: 1, sector_time: 11.185, incomplete: false}` |
| `setup_files` | Garage61 | Arquivo de setup e parâmetros decodificados; `garage61_event_id` evita revisitar setups já persistidos. | `{car_id: 159, track_id: 77, setup_kind: "commercial", source: "garage61", filename: "26S3\\TS 26S3 SF23 W10 Monza DRY Race B"}` |
| `cars` / `tracks` | Garage61 | Catálogo normalizado de carros e pistas — `race_results.car_id`/`track_id` são resolvidos contra este catálogo por nome (best-effort; ficam `null` sem match, nunca inventados). | `{id: 153, name: "Acura ARX-06 GTP", variant: null}` |
| `drivers` | Garage61 | Piloto monitorado (single-user). | `id uuid`, `platform_driver_id text`, `name text` |
| `ratings` | Garage61 | **Snapshot atual** de iRating/SR — é a âncora exata usada por `v_race_results_irating` para reconstruir o histórico completo a partir dos deltas do iRStats. Continua sendo sincronizado mesmo com iRating vindo do iRStats. | `id uuid`, `category text`, `rating_type text`, `rating integer`, `recorded_at timestamptz` |
| `rating_history` | Garage61 (**legado**) | Série temporal de iRating/SR — só cobre ~10 meses. Não lida por nenhuma view/rota ativa desde a migração de 27/08. Mantida, não removida. | — |
| `race_rating_matches` | Garage61 (**legado**) | Matching heurístico corrida↔mudança de rating — substituído pelo delta exato do iRStats. Não lido por nenhuma rota ativa. | — |
| `official_series_results` | Snapshot manual (**descontinuado**) | 11 linhas de um snapshot manual pré-iRStats. Não lida por nenhuma rota ativa. | — |
| `car_group_members` / `car_groups` | Garage61 | Classe/grupo do carro (GT3, GTP, LMP2 etc.), usado por `v_historical_performance` para o Performance por Contexto. | — |
| `car_rating_categories` | Garage61 | Mapeia carro → Formula/Sports Car (histórico; hoje `race_results.category` já vem pronto do iRStats). | — |
| `daily_statistics` | Garage61 | Agregado diário de atividade. | — |
| `sessions` | Garage61 | Sessão crua com condições ambientais (clima, temperatura de pista). | — |
| `setup_files` (Storage) / `telemetry_references` | Supabase Storage | CSV/IBT de referência por carro+pista; canais e amostras. | — |
| `race_debriefs` | Derivado (Garage61 + cálculo interno) | Cache do Meu Debrief; `payload.session_id` casa com `driving_sessions.id`, auto-invalida quando a corrida-candidata muda. | — |
| `sync_runs` | Interno | Observabilidade de todos os syncs (Garage61 e iRStats). | — |

## Views de consumo

| View | Fonte | Uso |
|---|---|---|
| `v_race_results_irating` | `race_results` + `ratings` (âncora) | Reconstrói `irating_after`/`irating_before` exatos por corrida, encadeando `irating_delta` a partir do snapshot atual — nunca usa o iRating arredondado que o iRStats exibe. |
| `v_season_summary` | `race_results` | Resumo por season (corridas, voltas) no Overview. |
| `v_season_category_summary` | `race_results` (exclui `category = 'road'`) | Resumo por season/carteira (Formula/Sports) — `road` fica de fora dos KPIs, só entra em `v_historical_performance`. |
| `v_season_weekly_irating` | `race_results` + `v_race_results_irating` | Gráfico semanal de iRating; `season_week` do iRStats quando disponível, senão calculado por data. |
| `v_historical_performance` | `race_results` + `car_group_members` | Performance por Contexto (Track/GT3/IMSA); inclui `road` para contexto, sem afetar os KPIs de carteira. |
| `v_season_calendar` | Hardcoded (datas de início de season) | Calendário compartilhado por todas as views acima — adicionar uma linha a cada nova season. |
| `v_race_irating_candidates` | `driving_sessions` + `race_rating_matches` (**legado**) | Não lida por nenhuma rota ativa desde 27/08. |

## Consultas de auditoria rápidas

```powershell
# Contagem e fonte dos resultados por carteira
npx supabase db query --linked "select category, count(*) from public.race_results group by 1 order by 1"

# Confirmar que road entra em contexto mas não nos KPIs de carteira
npx supabase db query --linked "select rating_category, car, track, races, avg_delta_irating from public.v_historical_performance where rating_category = 'road' order by races desc limit 10"

# Último sync (Garage61 catálogo + driving_sessions)
npx supabase db query --linked "select sync_type,status,records_found,records_inserted,records_updated,finished_at from public.sync_runs order by started_at desc limit 10"

# Corridas iRStats importadas hoje (via bookmarklet)
npx supabase db query --linked "select count(*) from public.race_results where imported_at::date = now()::date"
```
