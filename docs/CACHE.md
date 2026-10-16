# Cache compartilhado (servidor/CDN)

Implementação: `lib/cache.ts`. Camadas: (1) CDN da Vercel via `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` + header `Vercel-Cache-Tag`; (2) Data Cache do Next (`cachedQuery` = `unstable_cache`); (3) Map em memória por instância (mantido onde havia lógica delicada). Respostas com status != 200 saem `no-store`. Nada com cookie/auth por usuário ou conteúdo privado de setup vai para o CDN.

## Tags

| Tag | Cobre | Rotas GET |
|---|---|---|
| `results` | race_results, overview, report, debrief, inventory | dashboard/overview (s-maxage <=300, limitado à fronteira semanal, sem SWR), dashboard/report (300 + swr 3600), telemetry/race-debrief (300 + swr 3600), setup/inventory e setup/library (só Data Cache) |
| `laps` | active-week, plan, car-comparison, baselines, race-field | telemetry/active-week (120), telemetry/plan (120 + swr 300), telemetry/car-comparison (300 + swr 3600), telemetry/race-field (300/600 + swr 3600; vazio 60), telemetry/local-coach/baselines (só Data Cache 120s; protegida por `x-import-key`, nunca CDN público) |
| `telemetry-ref` | referências de telemetria | telemetry/reference continua `no-store` (nenhuma rota GET pública cacheada) |
| `sync-status` | frescor das fontes | sync/status (30 + swr 60) |

Rotas `setup/*` guardam apenas no Data Cache e respondem `private`. `?refresh=1` do overview ignora o cache e invalida a tag `results`.

## Invalidação (rotas de escrita, após resposta 2xx; `withInvalidate`)

- `results` + `laps` + `sync-status`: sync/all, sync/catalog, sync/car-groups, sync/irstats, sync/irstats/ingest, setup/garage61-import
- `results` + `sync-status`: sync/profile, sync/rating-history
- `laps` + `sync-status`: sync/incremental, sync/laps, sync/laps-all, sync/laps-batch, sync/garage61-laps, sync/telemetry, sync/telemetry-backfill
- `results` + `laps` + `telemetry-ref` + `sync-status`: agent/ingest POST, cron/hourly-sync
- `results` + `laps`: season-calendar/import, setup/inventory POST
- `telemetry-ref` + `laps`: telemetry/reference POST

Invalidação = `revalidateTag` + `invalidateByTag` (`@vercel/functions`); falhas são só logadas e nunca quebram a rota de escrita. Guard-rails de cota (TTL, Maps, limites) permanecem.
