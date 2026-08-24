# Design

<!-- impeccable:design-schema 1 -->

## World

Re-identidade visual (não greenfield) inspirada no logotipo/site oficial do iRacing: azul-marinho como cor de marca dominante, vermelho como flash secundário (igual à proporção do logo real — piloto/silhueta em azul, bandeira quadriculada em vermelho), fundo grafite/preto neutro, branco quente para texto. Direção pinada pelo usuário, com correção pós-implementação a partir do logo oficial (a primeira versão usava vermelho como cor dominante; corrigido para azul dominante + vermelho de acento).

## Palette

- `--bg` `#0a0a0c` — fundo, preto neutro (sem matiz azul/ciano do tema antigo).
- `--surface` / `--surface-muted` / `--surface-raised` — grafites neutros (`#141416` / `#19191b` / `#1e1f22`).
- `--brand` `#1c4f9c` (dark `#133a75`, pale `#101a2c`) — azul de marca DOMINANTE: botão primário, kickers de seção, foco, links, faixas de destaque, fundo de toggles ativos. Usada apenas em chrome/estrutura, nunca para recodificar dados.
- `--brand-red` `#e2231a` (dark `#b81812`) — vermelho de marca SECUNDÁRIO (flash, não dominante): sublinhado de aba ativa, acento do brand-mark no header. Papel deliberadamente menor que o azul, espelhando a proporção do logo oficial.
- `--blue` `#4fd1e8` — preservado como cor semântica da categoria **Formula Car** (KPI cards, resultados oficiais, canal "speed" da telemetria). Tom ciano claro, distinto do `--brand` (azul-marinho escuro) para não se confundir com a cor de marca.
- `--amber` `#ffb020` — preservado como cor semântica da categoria **Sports Car**.
- `--green` / `--red` (`#35d488` / `#ff5c5c`) — preservados como semântica universal de ganho/perda em toda a UI (deltas de iRating, setores, comparação de setup). Tom de `--red` distinto de `--brand-red` para não colidir com feedback negativo.

## Typography

Mantida a stack existente (o usuário já aprova): **Big Shoulders** (display, condensado/atlético — já lê como painel de corrida), **Inter** (corpo), **JetBrains Mono** (dados tabulares). Nenhuma troca foi feita; nenhuma alternativa testada superou essa combinação para o contexto (dados densos + headers de categoria).

## Component language

- Botões primários, kickers, bordas de destaque em cards de contexto (telemetry-panel, setup-drop, race-debrief-summary etc.) usam `--brand` (azul).
- O sublinhado de aba ativa (`.app-tabs`, `.setup-subtabs`) usa `--brand-red`, com o texto passando para `--text` (não `--brand`) no estado ativo — o vermelho fica como o único toque, não some no meio de texto azul.
- Cores de categoria (`--blue` Formula / `--amber` Sports) continuam reservadas exclusivamente para conteúdo que representa aquela categoria — nunca para chrome genérico.
- Escala de consistência (great/good/warn/bad → verde/azul/âmbar/vermelho) preservada sem alteração — é uma convenção interna já aprendida pelo usuário, não faz parte da identidade de marca.

## Constraints

"iRacing" é marca registrada de terceiro. Nenhum logotipo, wordmark ou asset proprietário do iRacing foi reproduzido — a inspiração é de paleta e tratamento tipográfico/tabular, não cópia de ativos.
