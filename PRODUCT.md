# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Um único usuário: o próprio piloto (Vitor), analisando seus dados pessoais de iRacing (Formula Car, Sports Car, GTP/LMP2). Power user — não é um produto multi-tenant nem voltado a público externo.

## Product Purpose

Painel pessoal de analytics de iRacing: cruza resultados oficiais de iRating/Safety Rating com telemetria detalhada do Garage61 para gerar debriefs de corrida, comparação de setups e recomendações técnicas de pilotagem/setup.

## Positioning

Combina dados oficiais de rating (iRacing) com telemetria lap-a-lap (Garage61) que nenhum dos dois serviços expõe sozinho — gera debriefs curva-a-curva, consistência por setor e engenharia de setup a partir dessa junção.

## Operating Context

- Três categorias de rating: Formula Car, Sports Car, GTP/LMP2.
- Sincronização automática horária de `driving_sessions`; sincronização pesada (por evento) de laps/sectors sob demanda.
- Setup Lab: upload/comparação de setups comerciais (.sto), chat "Engenheiro" com recomendações por carro.
- Telemetria: melhor volta vs. referência, debrief de corrida, consistência por setor.

## Capabilities and Constraints

- Dados vêm de duas fontes: iRacing (resultados oficiais, rating) e Garage61 (telemetria, setups). Garage61 não exporta canal de overtake/push-to-pass — qualquer detecção de ultrapassagem é estatística (outlier), não direta.
- Stack: Next.js 15 (App Router) + React 19 + Supabase (Postgres) + CSS puro (sem framework de UI).
- Tema atual: dark, monoespaçado para dados, `--blue` (Formula) / `--amber` (Sports) como cores de categoria.

## Brand Commitments

- "iRacing" é marca registrada de terceiro (iRacing.com Motorsport Simulations). A redesign deve se inspirar na linguagem visual do site oficial/members site (paleta, tipografia condensada de racing, tratamento de dados/tabelas) sem reproduzir o logotipo, wordmark ou qualquer asset proprietário do iRacing.
- Tipografia atual do app é bem avaliada pelo usuário — mudar só se houver alternativa comprovadamente melhor para o contexto (dados tabulares, mono, racing).

## Evidence on Hand

- App já em produção com dados reais de 92+ corridas, 2.490+ voltas, múltiplas temporadas.
- Nenhum screenshot do iRacing.com foi fornecido nesta sessão — a referência visual vem do conhecimento geral do estilo do site/members site do iRacing (preto/vermelho/branco, tipografia condensada, tabelas densas de resultado).

## Product Principles

1. Dados reais em primeiro lugar — nunca inventar números, sempre citar a fonte (iRacing vs. Garage61) quando a origem importa.
2. Densidade de informação de painel de corrida: tabelas e números compactos, não cards decorativos vazios.
3. Power-user first: atalhos de teclado, sem necessidade de acessibilidade para terceiros (usuário único confirmado).
4. Redesign preserva toda a função e estrutura de dados existente — só a camada visual muda.

## Accessibility & Inclusion

Sem requisito de acessibilidade para terceiros — usuário único e conhecido (ver Users). Manter apenas o piso técnico básico (foco visível, contraste de leitura).
