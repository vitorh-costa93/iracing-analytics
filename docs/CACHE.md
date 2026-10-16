# Cache compartilhado (servidor/CDN)

Implementação: `lib/cache.ts`. Camadas: (1) CDN da Vercel via `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` + header `Vercel-Cache-Tag`; (2) Data Cache do Next (`cachedQuery` = `unstable_cache`); (3) Map em memória por instância (mantido onde havia lógica delicada). Respostas com status != 200 saem `no-store`. Nada com cookie/auth por usuário ou conteúdo privado de setup vai para o CDN.

## Respostas persistentes e primeiro acesso (16/10/2026)

`lib/durable-cache.ts` envolve overview, report, active-week, plan, car-comparison, race-debrief, race-field, reference e os GETs privados inventory/library. A cópia de resultado em `analytics_response_cache` sobrevive a deploy/evicção da CDN. HIT lê apenas o JSON pronto; STALE entrega a última resposta válida e agenda recálculo com lease de 300s. Erros não substituem dados válidos. Mudanças de contrato exigem nova `version`. Não envolve chat, POSTs ou endpoints protegidos do agente.

- Teto de 512 variantes, 1,5 MiB por JSON e 64 MiB somados; retenção de derivados de 14 dias. Sem nova escrita em Storage ou alteração das cotas de telemetria.
- Até 128 atualizações por expiração/dia e reserva de 64/dia para dados invalidados por escrita; lease impede recálculos concorrentes entre instâncias. Dados invalidados toleram até 15 minutos de atualização; orçamento indisponível após esse prazo retorna indisponibilidade, nunca dado antigo indefinidamente. Horizonte máximo de derivados: sete dias.
- Invalidação por tag é registrada independentemente de a variante já existir. Cálculo iniciado antes da gravação não pode persistir/publicar resultado antigo como novo. RPCs são SECURITY INVOKER, search_path vazio e exclusivas de service_role; tabelas com RLS e sem acesso anon/authenticated.
- Semana/calendário: `cacheValidUntil` deriva do início oficial das seasons; active-week usa seu week.end. A cópia persistente/CDN não atravessa essa fronteira.
- Depois de escritas, preparação em background de até oito variantes, duas simultâneas e uma execução por cinco minutos, usando o orçamento global. Listas atuais, primeira comparação, semana ativa e corrida atual têm prioridade; as demais rodam por antiguidade. A função protegida `/api/analytics/prepare` tem vida própria de 300s (ingest tem só 30s), deadline de 220s e cada fetch até 50s. Sem cron adicional. Destino fixo PRD; segredo apenas em header. Arquivos privados de setup e conversa nunca vão ao CDN; inventory/library respondem private,no-cache.
- Preparação explícita de publicação: `node scripts/warm-analytics.mjs`; percorre opções reais dos seletores (sem gerar combinações inventadas), no máximo 256 URLs por padrão/512 com --limit, 32 MiB recebidos e 20 minutos, concorrência dois. Manifest somente de URLs/tempos em .vercel (ignorado). `--verify` mede novamente as URLs; falha se houver erro, pendência ou resposta acima de 3s. `--refresh` exige segredo e respeita leases/orçamento.
- `.github/workflows/prepare-analytics.yml` executa preparação e medição em cada deployment Production concluído; origem fixa, sem secrets, pacotes extras ou cron. Job limitado a 12 minutos, sem execuções concorrentes. Resultados persistidos anteriores continuam disponíveis durante publicação/preparação.

A meta de 3s precisa ser medida no navegador e nas variantes preparadas. Uma variante realmente inédita sem resultado persistido ainda exige seu primeiro cálculo; não interpretar CDN HIT como prova de cold start nem prometer latência absoluta da rede. Preparação depois de publicação e invalidação contínua são parte do fluxo.

## Tags

| Tag | Cobre | Rotas GET |
|---|---|---|
| `results` | race_results, overview, report, debrief, inventory | dashboard/overview (s-maxage <=300, limitado à fronteira semanal, sem SWR), dashboard/report (300 + swr 3600), telemetry/race-debrief (300 + swr 3600), setup/inventory e setup/library (só Data Cache) |
| `laps` | active-week, plan, car-comparison, baselines, race-field | telemetry/active-week (120), telemetry/plan (120 + swr 300), telemetry/car-comparison (300 + swr 3600), telemetry/race-field (300/600 + swr 3600; vazio 60), telemetry/local-coach/baselines (só Data Cache 120s; protegida por `x-import-key`, nunca CDN público) |
| `telemetry-ref` | referências de telemetria | telemetry/reference GET (3600 + swr 86400; vazio/indisponível 60 + swr 300; erro no-store) |
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

## Leituras de volta/referência e cliente

- `GET /api/garage61/laps/{id}/telemetry`: dado imutável por id. 200 com payload: `public, s-maxage=31536000, max-age=31536000, immutable` + `Vercel-Cache-Tag: laps`. Erros e CSV vazio: `no-store`. Storage primeiro, Garage61 como fallback (inalterado).
- `GET /api/telemetry/reference`: `cachedJson` tag `telemetry-ref`; referência real 3600 + swr 86400; sem referência/indisponível 60 + swr 300; erro `no-store`. O POST invalida `telemetry-ref` + `laps` via `withInvalidate`.
- `setup/inventory` e `setup/library`: só `private, max-age=300` (nunca `public`); POST ao mesmo URL invalida a cópia do navegador. `setup/engineer/chat` GET continua sem header de cache (thread muda a cada POST).
- Clientes: leituras (CarCompareView, ActiveWeekTelemetry, SetupLabView chat) não usam mais `cache: "no-store"`; `no-store` só em POST/DELETE, `?refresh=1` do overview e retry do debrief. CarCompareView não rebusca a lista quando `season` muda de `auto` para o id resolvido.
