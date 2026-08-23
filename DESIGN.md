# Design

<!-- impeccable:design-schema 1 -->

## World

Re-identidade visual (não greenfield) inspirada no site oficial / members site do iRacing: fundo grafite/preto neutro, vermelho de assinatura como cor de marca (chrome), branco quente para texto. Direção pinada pelo usuário — sem torneio de conceitos.

## Palette

- `--bg` `#0a0a0c` — fundo, preto neutro (sem matiz azul).
- `--surface` / `--surface-muted` / `--surface-raised` — grafites neutros (`#141416` / `#19191b` / `#1e1f22`).
- `--brand` `#e2231a` (dark `#b81812`, pale `#241210`) — cor de marca/chrome: botão primário, tabs ativas, kickers de seção, foco, links, faixas de destaque. Usada apenas em elementos de chrome/estrutura, nunca para recodificar dados.
- `--blue` `#4fd1e8` — preservado como cor semântica da categoria **Formula Car** (KPI cards, resultados oficiais, canal "speed" da telemetria).
- `--amber` `#ffb020` — preservado como cor semântica da categoria **Sports Car**.
- `--green` / `--red` (`#35d488` / `#ff5c5c`) — preservados como semântica universal de ganho/perda em toda a UI (deltas de iRating, setores, comparação de setup). Distinto do `--brand` por saturação/tom para não colidir com feedback negativo.

## Typography

Mantida a stack existente (o usuário já aprova): **Big Shoulders** (display, condensado/atlético — já lê como painel de corrida), **Inter** (corpo), **JetBrains Mono** (dados tabulares). Nenhuma troca foi feita; nenhuma alternativa testada superou essa combinação para o contexto (dados densos + headers de categoria).

## Component language

- Botões primários, abas ativas, kickers, bordas de destaque em cards de contexto (telemetry-panel, setup-drop, race-debrief-summary etc.) usam `--brand`.
- Cores de categoria (`--blue` Formula / `--amber` Sports) continuam reservadas exclusivamente para conteúdo que representa aquela categoria — nunca para chrome genérico.
- Escala de consistência (great/good/warn/bad → verde/azul/âmbar/vermelho) preservada sem alteração — é uma convenção interna já aprendida pelo usuário, não faz parte da identidade de marca.

## Constraints

"iRacing" é marca registrada de terceiro. Nenhum logotipo, wordmark ou asset proprietário do iRacing foi reproduzido — a inspiração é de paleta e tratamento tipográfico/tabular, não cópia de ativos.
