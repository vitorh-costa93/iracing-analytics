# Redesign UI (opção B, "Night Grid") — plano de execução

Referência visual aprovada: `docs/redesign-mockup/*.dc.html` (uma tela por arquivo, 1440 px de largura; `Mobile` é 390 px).
Objetivo: fidelidade 100% ao mockup, análises novas, tudo funcionando. Substitui a UI atual.

## Decisões fixas
- Publicar em produção **só no fim**, depois de todas as etapas validadas. Etapas intermediárias: branch `redesign-ui-b` + commit por etapa.
- Paleta: fundo `#080B14`, cabeçalho `#0E1322`, cartão `#111830`, cartão 2 `#171F3B`, borda `#222C50`, linha `#1B2444`, texto `#E8EEFF`, apagado `#9DAAD0` / `#8593BE`, vermelho da marca `#FF2D3C` (só interface), ganho `#3DD68C`, perda `#FF6B6B`, referência `#2DE2E6` (na telemetria: roxo `#B48CFF` no popup).
- Categorias: Sports Car `#4DA3FF`, Formula `#FFB020`, Road `#B48CFF`.
- Tipografia: Chakra Petch (títulos, números) + IBM Plex Sans (texto), números tabulares.
- Navegação no topo: Visão Geral, Telemetry Lab, Debriefs, Setup Lab. Sem tela de "Fontes" (a frescura dos dados fica no cabeçalho).
- Textos gerados: linguagem de conversa de engenheiro de pista, sem "p.p.", "Δ" solto ou jargão; sem "--".
- Regras do CLAUDE.md continuam valendo (session_type = 3, guard-rails do plano gratuito, sync incremental, sem segredos no cliente).

## Etapas
1. Base visual: tokens, fontes, cabeçalho, cartão padrão, seletores/segmentados.
2. Visão Geral (`B.dc.html`): 6 KPIs por categoria com minigráficos, dispersão duração × Δ iRating, contextos da semana, Performance por contexto (Δ iRating + gap para o vencedor), últimas corridas.
3. Telemetry Lab semana ativa (`Telemetry.dc.html`, `TelemetryPopup.dc.html`): contextos clicáveis, Δ tempo + inputs com hover ligado ao mapa, curva a curva com sequências, popup no estilo iRacing, textos humanizados.
4. Race Debrief (`Debrief.dc.html`) e Comparação de carros (`Compare.dc.html`), incluindo microcorreções por volta e curva a curva contra o carro escolhido.
5. Debriefs de Season e Week (`DebriefSeason.dc.html`, `DebriefWeek.dc.html`): leitura rápida, ritmo × resultado, quando as perdas acontecem, corridas de maior impacto, contextos, evidência.
6. Setup Lab (`Setup.dc.html`): seletores, chat persistente por pista/carro/season com `/setup`, painel A/B explicado, comparador de dois setups.
7. Mobile (`Mobile.dc.html`).

## Critério de pronto de cada etapa
`npm test`, `npx tsc --noEmit`, `npm run build` verdes; tela aberta no navegador e comparada com o mockup; dados validados no Supabase quando houver mudança de schema ou consulta; commit na branch.

## Estado
- [x] Mockup aprovado e exportado para `docs/redesign-mockup/`.
- [x] Etapa 1 (25/09/2026: tokens `--ng-`, fontes, cabeçalho global, `components/ui/`, `/debriefs` placeholder) · [ ] 2 · [ ] 3 · [ ] 4 · [x] 5 (26/09/2026: página /debriefs com season e week, modal removido) · [ ] 6 · [ ] 7 · [ ] Publicação em produção
