# Arquitetura de dados — Racing Analytics

Inventário conferido no banco Supabase vinculado em 27/08/2026. Este documento descreve o contrato real do banco; para uma amostra atual de qualquer relação, use a CLI (sem expor secrets):

```powershell
npx supabase db query --linked "select * from public.NOME_DA_TABELA limit 1"
```

## Fontes e fluxo

```text
Garage61 ──> extensão Chrome / rotas server-side ──> Supabase ──> Next.js (Vercel)
  sessões, voltas, telemetria, setups                   │             Overview / Telemetry / Debrief
                                                        │
iRStats ───> extensão Chrome incremental ──────────────┤
  resultados e Δ iRating                                │
                                                        │
snapshot oficial iRacing ───────────────────────────────┘
  standings/wins auditáveis
```

| Fonte | Dados que alimenta | Regra de atualização |
|---|---|---|
| Garage61 | `drivers`, catálogos, `sessions`, `driving_sessions`, `laps`, `lap_sectors`, `rating_history`, `setup_files`, telemetria | Sync incremental e idempotente. Setups são deduplicados pelo evento Garage61 depois da migração de 27/08. |
| iRStats | `race_results` | Extensão no Chrome, incremental a partir das páginas recentes; a carteira `road` entra em contexto, mas não nos KPIs Formula/Sports. |
| Supabase Storage | CSV da referência e arquivos de setup | Apenas metadados e caminho ficam nas tabelas. |
| Snapshot oficial | `official_series_results` | Evidência auditável de largadas/vitórias; ainda não é refresh OAuth automático. |

No frontend, `/` consome as views de temporada, resultados e ratings; `/telemetry` consome a semana oficial mais recente, sessões/voltas Garage61 e `telemetry_references`; o Meu Debrief consome `race_debriefs`, recomposto a partir de uma corrida Garage61 quando a versão de análise muda. O botão **Atualizar dados** chama a ponte da extensão: Garage61 atualiza setups/telemetria e iRStats atualiza resultados; as abas são fechadas pela extensão ao fim de cada origem.

## Tabelas base

| Tabela | Colunas (tipo) | Papel e amostra útil |
|---|---|---|
| `car_group_members` | `car_group_id bigint`, `car_id bigint` | Associação N:N de carro/grupo. Amostra: um par de IDs. |
| `car_groups` | `id bigint`, `name text`, `platform text`, `created_at timestamptz` | Grupos do Garage61. Amostra: nome/plataforma. |
| `car_rating_categories` | `car_id bigint`, `rating_category text`, `source text`, `created_at timestamptz` | Mapeia carro a Formula/Sports/GTP para análises. Amostra: carro e categoria. |
| `cars` | `id integer`, `platform text`, `platform_id text`, `name text`, `variant text`, `created_at timestamptz` | Catálogo de carros. Amostra: ID, nome e variante. |
| `tracks` | `id integer`, `platform text`, `platform_id text`, `name text`, `variant text`, `created_at timestamptz` | Catálogo de pistas/traçados. Amostra: ID, nome e variante. |
| `drivers` | `id uuid`, `platform text`, `platform_driver_id text`, `name text`, `created_at timestamptz`, `updated_at timestamptz` | Piloto monitorado. Amostra: identidade de plataforma e timestamps. |
| `daily_statistics` | `id uuid`, `driver_id uuid`, `statistic_date date`, `car_id integer`, `track_id integer`, `session_type integer`, `events integer`, `time_on_track double precision`, `laps_driven integer`, `clean_laps_driven integer` | Agregado diário Garage61. Amostra: um dia/carro/pista. |
| `sessions` | `id uuid`, `garage61_event_id text`, `garage61_session_id text`, `driver_id uuid`, `car_id integer`, `track_id integer`, `season_id text`, `season_name text`, `event_type integer`, `session_type integer`, `run integer`, `started_at timestamptz`, `air_pressure double precision`, `wind_velocity double precision`, `wind_direction double precision`, `relative_humidity double precision`, `fog_level double precision`, `track_temp double precision`, `track_usage integer`, `track_wetness double precision`, `created_at timestamptz` | Sessão crua, incluindo condições ambientais. Amostra: evento, tipo e clima. |
| `driving_sessions` | `id bigint`, `driver_id uuid`, `garage61_event_id text`, `garage61_session_id text`, `car_id bigint`, `track_id bigint`, `season_id text`, `season_name text`, `session_type integer`, `event_type integer`, `started_at timestamptz`, `ended_at timestamptz`, `lap_count integer`, `created_at timestamptz` | Sessão normalizada usada para semana ativa e Debrief. Amostra: corrida com início/fim/voltas. |
| `laps` | `id text`, `session_id uuid`, `driver_id uuid`, `car_id integer`, `track_id integer`, `lap_number integer`, `lap_time double precision`, `clean boolean`, `joker boolean`, `discontinuity boolean`, `missing boolean`, `incomplete boolean`, `off_track boolean`, `pit_lane boolean`, `pit_in boolean`, `pit_out boolean`, `driver_rating integer`, `fuel_level double precision`, `fuel_used double precision`, `fuel_added double precision`, `weight_penalty double precision`, `power_adjust double precision`, `tire_compound integer`, `can_view_telemetry boolean`, `can_view_setup boolean`, `telemetry_path text`, `garage61_payload jsonb`, `created_at timestamptz`, `synced_at timestamptz` | Unidade de telemetria. Amostra: uma volta limpa com flags, pneus, combustível e permissões. |
| `lap_sectors` | `id uuid`, `lap_id text`, `sector_number integer`, `sector_time double precision`, `incomplete boolean` | Tempos de setor por volta. Amostra: setores da mesma `lap_id`. |
| `rating_history` | `id bigint`, `driver_id uuid`, `category text`, `rating_type text`, `recorded_at timestamptz`, `rating integer`, `rating_display text`, `created_at timestamptz` | Série temporal Garage61 de iRating/SR. Amostra: rating antes/depois de uma corrida. |
| `ratings` | `id uuid`, `driver_id uuid`, `category text`, `rating_type text`, `rating integer`, `rating_display text`, `recorded_at timestamptz` | Snapshot atual de rating. Amostra: um rating por carteira/tipo. |
| `race_results` | `id uuid`, `irstats_race_id bigint`, `driver_id uuid`, `raced_at timestamptz`, `series_name text`, `track_name text`, `car_name text`, `car_id integer`, `track_id integer`, `category text`, `season_week integer`, `license_class text`, `safety_rating numeric`, `irating_display text`, `irating_delta integer`, `grid_position integer`, `finish_position integer`, `position_change integer`, `laps integer`, `laps_led integer`, `fastest_lap_time text`, `incidents integer`, `points integer`, `sof integer`, `imported_at timestamptz`, `race_fastest_lap_time text` | Resultado iRStats, única fonte de Δ iRating por corrida. Amostra: série, pista, grid/final e Δ. |
| `race_rating_matches` | `session_id bigint`, `driver_id uuid`, `rating_category text`, `rating_at timestamptz`, `previous_rating integer`, `new_rating integer`, `delta_irating integer`, `gap_hours numeric`, `computed_at timestamptz`, `previous_safety_rating integer`, `new_safety_rating integer`, `delta_safety_rating integer` | Matching 1:1 de mudança Garage61 a corrida; casos ambíguos ficam sem match. Amostra: sessão, rating antes/depois e distância temporal. |
| `official_series_results` | `id bigint`, `driver_id uuid`, `season_id integer`, `season_name text`, `rating_category text`, `series_name text`, `starts integer`, `wins integer`, `source text`, `captured_at timestamptz`, `updated_at timestamptz` | Snapshot oficial auditável de starts/wins. Amostra: série, season e vitórias. |
| `setup_files` | `id uuid`, `driver_id uuid`, `season_id text`, `car_id bigint`, `track_id bigint`, `source text`, `setup_kind text`, `filename text`, `storage_path text`, `garage61_lap_id text`, `file_size bigint`, `created_at timestamptz`, `updated_at timestamptz`, `decoded_car_name text`, `decoded_params jsonb`, `decoded_at timestamptz`, `decoder text`, `external_decode_consent_at timestamptz`, `garage61_event_id text` | Arquivo de setup e parâmetros decodificados. Amostra: evento Garage61, caminho Storage e `decoded_params`. |
| `telemetry_references` | `id uuid`, `driver_id uuid`, `car_id integer`, `track_id integer`, `storage_path text`, `original_filename text`, `file_size integer`, `channels text[]`, `sample_count integer`, `uploaded_at timestamptz` | Referência CSV/IBT por carro+pista. Amostra: canais e número de amostras. |
| `race_debriefs` | `id bigint`, `driver_id uuid`, `rating_category text`, `session_id bigint`, `payload jsonb`, `computed_at timestamptz` | Cache do Meu Debrief; `payload` contém setores, curvas, mapa e dispersão. Amostra: versão de detecção e sessão. |
| `sync_runs` | `id uuid`, `sync_type text`, `status text`, `started_at timestamptz`, `finished_at timestamptz`, `records_found integer`, `records_inserted integer`, `records_updated integer`, `error_message text` | Observabilidade de sync. Amostra: última execução e contadores incrementalmente inseridos/atualizados. |

## Views de consumo

| View | Colunas | Uso |
|---|---|---|
| `v_historical_performance` | `rating_category`, `car_class`, `car`, `track`, `races`, `delta_irating`, `avg_delta_irating` | Performance por Contexto; exige no mínimo duas corridas no frontend. |
| `v_race_irating_candidates` | `session_id`, `driver_id`, `garage61_event_id`, `rating_category`, `car_class`, `car`, `track`, `started_at`, `ended_at`, `rating_at`, `previous_rating`, `new_rating`, `delta_irating`, `minutes_after_race`, `candidate_for_race`, `race_for_rating` | Auditoria do matching de iRating. |
| `v_race_results_irating` | Todas as colunas de `race_results`, mais `irating_after bigint`, `irating_before bigint` | KPIs e série temporal de iRating com valores reconstruídos. |
| `v_season_calendar` | `season_id`, `season_name`, `season_start` | Semana oficial: início + blocos de 7 dias. |
| `v_season_category_summary` | `season_id`, `season_name`, `rating_category`, `corridas`, `delta_irating`, `delta_medio`, `mediana`, `corridas_positivas`, `corridas_negativas`, `pct_positivas`, `maior_ganho`, `maior_perda` | Resumo por season/carteira. |
| `v_season_summary` | `season_id`, `season_name`, `started_at`, `last_activity_at`, `sessions`, `practice_sessions`, `qualifying_sessions`, `race_sessions`, `total_laps`, `practice_laps`, `qualifying_laps`, `race_laps`, `races_with_irating`, `delta_irating`, `positive_races`, `negative_races`, `avg_delta_irating`, `positive_pct` | Resumo da season no overview. |
| `v_season_weekly_irating` | `season_id`, `season_name`, `rating_category`, `week_number`, `week_start`, `week_end`, `irating_before_week`, `irating_first`, `irating_end_of_week`, `weekly_delta`, `irating_min`, `irating_max`, `rating_changes`, `first_rating_at`, `last_rating_at`, `races`, `cars text[]`, `tracks text[]` | Gráficos semanais de iRating. |

## Consultas de auditoria rápidas

```powershell
# Contagem e fonte dos resultados por carteira
npx supabase db query --linked "select category, count(*) from public.race_results group by 1 order by 1"

# Verificar que Road participa do contexto
npx supabase db query --linked "select rating_category, car, track, races, avg_delta_irating from public.v_historical_performance where rating_category in ('formula_car','sports_car') order by races desc limit 20"

# Último sync e se foi incremental
npx supabase db query --linked "select sync_type,status,records_found,records_inserted,records_updated,finished_at from public.sync_runs order by started_at desc limit 10"
```
