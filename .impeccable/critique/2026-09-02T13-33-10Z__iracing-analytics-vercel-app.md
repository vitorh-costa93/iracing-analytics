---
target: iRacing Analytics app — Overview, Analysis (3 tabs), Laboratory
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-09-02T13-33-10Z
slug: iracing-analytics-vercel-app
---
Method: dual-agent (A: design-review · B: detector+browser-evidence) + separate technical audit agent

## Design Health Score

| # | Heurística | Nota | Ponto-chave |
|---|---|---|---|
| 1 | Visibilidade do status do sistema | 3 | Mensagens de loading específicas e em etapas, mas "Nenhuma referência ativa" aparece por alguns segundos como falso negativo antes da referência real resolver. |
| 2 | Correspondência com o mundo real | 3 | Nomes reais de curva e voz de engenheiro; quebrado por slugs crus no Laboratory (`superformulasf23 honda`) e inglês vazando dentro de frases em PT ("desta week"). |
| 3 | Controle e liberdade do usuário | 2 | Sem próximo/anterior entre popups (6 a 20 por aba); sem "reset de zoom" no mapa; três abas de Analysis sem URL própria (não dá pra linkar/recarregar uma aba específica). |
| 4 | Consistência e padrões | **1** | O contrato de cor por categoria (azul=Formula/âmbar=Sports) está quebrado sistematicamente — ver P0 abaixo. |
| 5 | Prevenção de erros | 3 | Filtro de P2P/Overtake, mínimo de 2 corridas antes de "melhor/pior contexto", BoP por temporada. Ponto fraco: "Substituir referência" sobrescreve na hora, sem confirmação/undo. |
| 6 | Reconhecimento em vez de memorização | 2 | O gráfico de telemetria não tem eixo/escala em nenhum dos 10 canais; rótulos de curva colidem em pistas com muitas curvas (Silverstone vira uma mancha ilegível). |
| 7 | Flexibilidade e eficiência | 2 | Scrubbing por teclado é um ganho real; contra isso, a tabela de corridas da temporada tem 11 páginas sem busca/filtro/ordenação, e nada é clicável entre seções (pista ruim no ranking não linka pra telemetria dela). |
| 8 | Design estético e minimalista | 2 | Densidade é correta (não é o problema); composição é o problema — grid de 6 cards vira 5 colunas estreitas + 1 órfã, mapa "sticky" cobre 440px acima do gráfico, ~60px de padding vazio no box do Insight do Engenheiro. |
| 9 | Recuperação de erros | 3 | "Tentar novamente" nos dois principais error states, mensagens específicas na língua do piloto. Ponto fraco: sucesso e falha ao trocar referência usam o mesmo estilo visual. |
| 10 | Ajuda e documentação | 3 | Baixo risco por ser usuário único (conforme combinado); nota: a explicação mais importante do app (bookmarklets em "Favoritos") fica escondida atrás de um item de nav que some primeiro no mobile. |
| **Total** | | **24/40** | **Aceitável** (60%) |

## Veredito de especificidade de design

**Não é um dashboard genérico.** A marca skewed inspirada no logo do iRacing, Big Shoulders + JetBrains Mono, bandeiras de país nos rankings de pista, nomes reais de curva (La Source, Eau Rouge, Jacky Ickx Curve), o `FocusedGaugeChart` reconstruindo fielmente o HUD do próprio iRacing (aro do volante, três raios, tick vermelho às 12h, chevrons de marcha) e a voz de "engenheiro falando com o piloto" ("Solte o freio e já comece a acelerar assim que o carro apontar pra saída, sem esperar ele estabilizar de vez") — nada disso vem de template. Onde a autoria falha é na **disciplina de sistema**: uma superfície de conteúdo muito bem trabalhada sentada sobre um sistema de cor sobrecarregado além do ponto de fazer sentido, e uma camada de composição (grids, larguras de coluna, proporção de painel) que claramente nunca recebeu a mesma atenção que o conteúdo.

**Scan determinístico (detector Impeccable):** 1 achado (`side-tab`, `app/globals.css:640`) — **falso positivo confirmado**: a borda esquerda de `.sector-detail` é a escala de consistência great/good/warn/bad (verde/azul/âmbar/vermelho) documentada no DESIGN.md, não um acento decorativo. Recomendo ignorar esse achado.

**Evidência de navegador:** sem erros de console e sem requisições falhas em nenhuma das 5 telas visitadas; contraste de texto estrutural (headers, botões, nav) todos acima de 6:1 — bom; foco de teclado visível (outline azul de 2px) confirmado. **Achado real e verificado:** overflow horizontal de página na Overview em 375px (scrollWidth 430 vs clientWidth 375) — causado por `.header-actions` com `flex-wrap: nowrap` que não cabe no header mobile, empurrando o botão "🔖 Garage61 ↗" pra fora da viewport. A barra de abas (`.app-tabs`) também rola horizontalmente sem nenhuma pista visual (fade/seta) de que há mais abas fora da tela — e é assim que "Favoritos" e parte de "Laboratory" ficam invisíveis no mobile.

## Impressão geral

O app tem a parte mais difícil de acertar (dados corretos, copy específica, um widget que reconstrói o HUD do próprio iRacing) muito bem resolvida, e a parte "fácil" (grid, cor, hierarquia visual) com falhas sistemáticas e concretas. A maior oportunidade não é "redesenhar" nada — é aplicar ao layout e à cor o mesmo nível de cuidado que já existe na copy e nos dados.

## Pontos fortes

1. **O bloco "Insight do Engenheiro" em Comparar Carros** — declara uma conclusão ("não vale trocar de carro"), atribui a curvas nomeadas com números, e aponta pra próxima tela que testaria a hipótese. Um parágrafo substituindo cinco gráficos.
2. **O `FocusedGaugeChart`** — reconstrução fiel do HUD do iRacing (aro, raios, tick vermelho, chevrons de marcha, barras de pedal); o piloto lê isso com memória muscular já formada no sim, custo de aprendizado zero.
3. **Disciplina de nota metodológica** — quase toda seção carrega uma legenda que declara sua própria regra de amostragem e limite ("amostra mínima de duas corridas", "BoP muda entre temporadas — só a mais recente entra por padrão"). É isso que torna o app confiável o bastante pra agir em cima dele.

## Problemas prioritários

**[P0] Contrato de cor por categoria quebrado em todo o app, incluindo autocontradição na própria Overview**
- **Por que importa:** É a única convenção que o DESIGN.md nomeia explicitamente, e a que o piloto realmente internalizaria (olhar rápido → "esse é meu número de GT3"). Uma vez que azul também significa velocidade, volta de referência, "bom", um McLaren e um ponto de debrief, o "olhar rápido" para de funcionar.
- **Onde:** `app/globals.css` (várias linhas — `.trace-speed`/`.telemetry-legend .speed` L184/191/205, `.corner-marker-*` L202/203, `.debrief-dot` L534, `.car-compare-row-fill` L558, `.corner-chip.good/.warn` L618/619, `.sector-map-segment.*` L634); `components/SeasonChart.tsx` (`.season-line.current` fixo em `--blue` mesmo com Sports Car selecionado — verificado ao vivo, stroke computado `rgb(79,209,232)` embaixo de um KPI card âmbar); `components/ActiveWeekTelemetry.tsx` L996-1012 (própria volta = vermelho, colidindo com vermelho=perda); `components/CarComparison.tsx`.
- **Fix:** criar `--accent`/`--accent-warm` para usos genéricos, deixar `--blue`/`--amber` exclusivos de conteúdo de categoria; tornar `.season-line.current` condicional à categoria selecionada; unificar own/referência numa única convenção (a que já existe no gráfico principal: sólido/tracejado).
- **Comando sugerido:** `/impeccable colorize` ou `/impeccable harden` (é mais correção de contrato do que "adicionar cor")

**[P0] O mapa "sticky" da Track Position não é sticky — a interação principal do app não funciona como a própria legenda promete**
- **Por que importa:** É a interação mais valiosa da aba "Melhor volta vs referência" (passar o mouse no gráfico → localizar no mapa), e hoje ela não fica visível simultaneamente com o gráfico.
- **Onde:** `app/globals.css` L308-313 (`.telemetry-map-sticky` está `position: static`); legenda em `components/ActiveWeekTelemetry.tsx` L910.
- **Fix:** mover o mapa pra coluna direita com `position: sticky; top: 16px`, reduzir a altura, e empilhar o painel de hover no mesmo bloco sticky.
- **Comando sugerido:** `/impeccable layout`

**[P1] "Maiores oportunidades" enterra o próprio ranking que existe pra comunicar**
- Cards ordenados por posição na pista, não por ganho; o valor do ganho é a cor menos legível do card (`--brand` em `--surface`, ~2.35:1); a maior oportunidade aparece como frase no meio do texto do sexto card, órfão numa linha sozinho.
- **Onde:** `app/globals.css` L273-279; `components/ActiveWeekTelemetry.tsx` L487, L892-896.
- **Comando sugerido:** `/impeccable layout`

**[P1] O gráfico de ranking de carros em Comparar Carros mostra o déficit, não o mérito**
- Sob o título "MELHOR VOLTA", a barra mais longa é do carro mais lento (Ford Mustang, +3.179s) e o carro mais rápido (McLaren, referência) tem barra quase zero — lido de relance, parece o oposto da verdade.
- **Onde:** `components/CarComparison.tsx`; `app/globals.css` L558.
- **Comando sugerido:** `/impeccable clarify` ou `/impeccable layout`

**[P1] Rótulos de curva colidem no gráfico principal; nenhum canal tem eixo/escala**
- Em Silverstone os nomes de curva sobrepõem numa mancha ilegível; nenhum dos 10 canais mostra min/max ou unidade sem hover.
- **Onde:** `components/ActiveWeekTelemetry.tsx` L292-305, L943-949.
- **Comando sugerido:** `/impeccable layout`

**[P2] Workspace desperdiça ~30% da largura numa coluna vazia; grids fixas de 3 colunas deixam card órfão**
- `.telemetry-workspace` computa 897px de gráfico + 380px de painel de hover vazio até você passar o mouse; `.week-context-grid`/`.performance-grid`/`.corner-deep-grid` são `repeat(3, ...)` fixo e deixam buraco quando o número de itens não é múltiplo de 3.
- **Onde:** `app/globals.css` L133, L308-313, L453, L691.
- **Comando sugerido:** `/impeccable layout`

**[P2] "Consistência por canal" é ilegível (mais longo parece melhor, mas é pior) e o Laboratory mostra slugs crus como título**
- Barra normalizada ao pior canal DESSA corrida (sem valor numérico, sem comparação entre corridas), toda na mesma cor azul "positiva"; cards de setup mostram `acuraarx06gtp`, `cadillacvseriesrgtp` em vez do nome real do carro.
- **Onde:** `components/RaceDebrief.tsx` L265-276; `app/globals.css` L537-541; cards do Laboratory (`/setup`).
- **Comando sugerido:** `/impeccable clarify`

**[P3] Narrativa de curva templated ao ponto de repetir texto quase idêntico, com um bug visível de regex**
- ~15 curvas com o mesmo parágrafo (só nome e dois decimais mudam); todos os chips leem "muito consistente"; a regex que remove o prefixo (`^.*?\(~\d+% da volta\):\s*`) não bate decimais, então curvas em posição inteira perdem o prefixo e curvas em posição decimal (ex: "Abbey" ~7.8%) mantêm — "The Loop" renderiza começando em minúscula no meio da frase.
- **Onde:** `components/RaceDebrief.tsx` L301, L315-320.
- **Comando sugerido:** `/impeccable clarify`

## Red flags por persona

**Alex (Power User, decidindo o que treinar hoje à noite):**
- Chega em `/telemetry`, lê "Nenhuma referência ativa" e sai procurando um arquivo pra subir — o painel troca pra referência real segundos depois (falso alarme).
- Quer saber qual curva custa mais tempo; tem que ler seis parágrafos em ordem de pista, não de ganho, pra achar que "Club (0.130s)" é a resposta — na última linha, do último card, sozinho numa linha vazia.
- Abre o popup de uma curva, termina, quer a próxima — não existe "próxima". Esc, rolar, achar o card certo, clicar. Seis vezes numa aba, vinte em Comparar Carros.
- Passa o mouse nos inputs esperando o mapa reagir (a legenda promete isso) — o mapa está 440px acima, fora da tela. Nunca vê a funcionalidade funcionar.
- Em Comparar Carros, lê "McLaren é 0.016s mais rápido" na curva Les Combes, mas as duas colunas de tempo mostram `+0.025s` e `+0.041s` — nenhuma é a base. Passa a desconfiar dos vinte cards.

**Morgan (pós-corrida, no celular, 375×812):**
- A linha de ações do header vaza horizontalmente — "Garage61 ↗" fica cortado.
- A navegação principal também vaza — **"Favoritos" fica totalmente fora da tela.** É justamente o item que explica o bookmarklet sem o qual nenhum resultado novo chega ao app.
- Dentro de Analysis, uma **terceira** barra rolável aparece empilhada nas primeiras — três "barrinhas de progresso" no topo da tela, quando na verdade são três navegações diferentes.

## Observações menores

1. "Favoritos" ocupa um slot de nav principal sendo, na prática, uma config de uma vez só — funcionaria melhor como ícone no header, perto dos links de iRStats/Garage61 que ele documenta.
2. O kicker do modal Favoritos grita em maiúsculas negativas ("NÃO SÃO BOTÕES DAQUI") destoando do tom calmo do resto do app.
3. `.reference-message` renderiza sucesso e falha com o mesmo estilo — falta uma variante `.error`.
4. "Relatório de inputs" é texto solto sem estrutura; como grid de 4 células (você | ref | Δ) ocuparia um quarto do espaço.
5. Os cards de curva em Comparar Carros são `<button>` sem nenhuma affordance visual de que abrem popup.
6. O popup de Comparar Carros descarta a narrativa (`insight-popup-detail`) que existe no popup equivalente de Melhor Volta vs Referência.

## Auditoria técnica (código)

| # | Dimensão | Nota | Achado-chave |
|---|---|---|---|
| 1 | Acessibilidade | 3/4 | Foco visível, botões reais, aria-labels — bom mesmo sendo de baixo risco (usuário único). |
| 2 | Performance | 3/4 | `useMemo` correto nos cálculos caros; mas `sync/laps-batch/route.ts` roda um loop N+1 sequencial (até ~500-750 round-trips por página de sync), e `dashboard/overview/route.ts` tem `.select()` sem `.range()` em tabelas que crescem (`ratings`, `rating_history`) — mesma classe de bug já corrigida duas vezes em outras rotas. |
| 3 | Responsividade | 4/4 | Breakpoints deliberados e documentados; sem overflow de página verificado em `/` e `/telemetry` a 375px. |
| 4 | Theming | 3/4 | Sistema de tokens bem organizado, mas ~6 cores hex repetidas sem token (`#08080a` ×5, `#0e131a` ×3, `#a97ee0` ×3 etc.) — uma troca de paleta esqueceria essas. |
| 5 | Integridade de implementação | 3/4 | Comentários excepcionalmente bons e precisos (nenhuma contradição encontrada); mas `formatLapTime` e o trio `mean`/`stddev`/`median` são copiados idênticos em 3-5 arquivos de rota, quando já existe `lib/` pra isso. |
| **Total** | | **16/20** | **Bom** |

**P1 — N+1 em `app/api/sync/laps-batch/route.ts:278-410`:** loop sequencial de SELECT/INSERT em `sessions` por lap, até 250 laps/página. Sugestão: buscar sessões existentes com um `.in()` só, depois inserir só as faltantes.

**P2 — `.select()` sem paginação em `app/api/dashboard/overview/route.ts:305-329`** (`ratings`, `rating_history`, `v_season_weekly_irating`) — mesmo bug de truncar em 1000 linhas já corrigido em `car-comparison`; ainda não aplicado aqui.

**P2 — Duplicação de `formatLapTime`/`mean`/`stddev`/`median`** em `sectors`, `car-comparison`, `debrief`, `active-week` — candidatos a `lib/stats.ts` e `lib/format.ts`.

**P2 — ~6 hex cores sem token** em `app/globals.css` (`#08080a`, `#0e131a`, `#a97ee0`, `#e0973b`, `#c99a4a`, `#4fc3d6`).

**P3 — touch targets ~36px** nas abas (`.app-tabs a`), abaixo do padrão de 44px — baixa prioridade dado o contexto de usuário único.

**Pontos positivos:** dependências enxutas, nenhum código morto/TODO encontrado, o próprio bug de paginação já foi corrigido corretamente duas vezes (só falta replicar em overview), e o workaround do sanitizador de `javascript:` do React 19 nos bookmarklets é uma solução elegante pra um bug real e obscuro.
