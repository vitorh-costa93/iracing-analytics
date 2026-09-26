# Auditoria: versão anterior × versão atual (redesign Night Grid)

Versão anterior = commit `94c4d8d` (use `git show 94c4d8d:<caminho>` para ler). Versão atual = `main`.
Contexto: o piloto disse que ~90% das análises da versão anterior estavam corretas e deveriam ter sido
MANTIDAS, só com a UI nova. Refazer rotas/cálculos perde qualidade. Esta auditoria diz, item a item, o que
foi mantido, o que mudou de verdade e o que se perdeu.

## O que auditar (em cada área)
1. Inventário do que a versão anterior mostrava e calculava (métricas, colunas, gráficos, filtros, textos
   gerados, regras de negócio, limites/caches, rotas/API e libs usadas).
2. Para cada item: onde está agora e se a LÓGICA é a mesma. Compare o código, não só a tela:
   fórmulas, filtros (ex.: session_type = 3), limiares, agrupamentos, ordenação, mínimos de amostra,
   janelas de tempo, fontes de dados (tabelas/colunas/views), caches e versões de cache, paginação.
3. Separe MUDANÇA DE LÓGICA de MUDANÇA DE TEXTO/VISUAL. Reescrever a redação é esperado (o piloto pediu
   linguagem de conversa); alterar número, critério ou dado não é.
4. Aponte o que foi PERDIDO (existia e sumiu), o que foi REESCRITO sem necessidade (deveria ter reaproveitado
   a rota/lib original) e o que é NOVO (pedido no mockup).
5. Regras que valem sempre (CLAUDE.md): iRating/corridas só com session_type = 3; um rating change casa
   com uma corrida só; GT3/GTP/LMP2 são classes, não séries; syncs incrementais; sem segredo no cliente;
   guard-rails de custo do plano gratuito.
6. NÃO edite código. Só leia (git show/diff, grep, Read) e escreva o relatório.

## Formato do relatório (arquivo .md nesta pasta, em português)
- Uma tabela: `Item | Antes (arquivo:linha) | Agora (arquivo:linha) | Situação | Impacto | Recomendação`
  com Situação ∈ {IGUAL, SÓ TEXTO/VISUAL, LÓGICA MUDOU, PERDIDO, NOVO}.
- Depois da tabela: seção "PERGUNTAS AO PILOTO" com cada dúvida em 1–2 linhas, com as opções e a sua
  recomendação. Só pergunte quando a decisão de negócio não estiver clara; se estiver clara no código ou
  no CLAUDE.md, decida e explique.
- Seção "RESTAURAR": lista objetiva do que deveria voltar a ser como era (com o commit/arquivo de origem).
- Seja rigoroso e específico: cite arquivo:linha e valores. Se não tiver certeza, escreva "não verificado".
- Resumo final devolvido por mensagem: no máximo 25 linhas (contagens por situação, os 5 achados mais
  graves e as perguntas).
