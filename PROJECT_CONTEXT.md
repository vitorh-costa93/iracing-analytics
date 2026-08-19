# Racing Analytics — contexto do projeto

Documento vivo para continuidade técnica. Ele consolida as decisões tomadas até 19 de agosto de 2026. Antes de implementar, confirme nomes e tipos no schema e no código atuais: parte do histórico foi construída de forma iterativa no Supabase e algumas estruturas podem ter evoluído.

## Objetivo

Racing Analytics é um dashboard pessoal, single-user e não comercial para analisar a performance de Vitor no iRacing. O produto combina visão Season × Season, evolução de iRating, atividade por carro/pista/categoria e, futuramente, resultados oficiais e coaching por telemetria.

O dashboard deve responder perguntas como:

- Como Formula Car e Sports Car evoluem entre seasons e semanas?
- Em quais séries, classes, carros e pistas o desempenho é melhor?
- Quanto iRating foi ganho ou perdido e quais corridas explicam a variação?
- Na IMSA, o desempenho é melhor de GT3, GTP ou LMP2? Dentro de GTP, com qual carro?
- Onde uma volta perde tempo para uma referência de Data Pack e qual mudança de técnica é mais útil?

## Arquitetura e responsabilidades

```text
Garage61                    iRacing /data API (futura)
sessões, voltas,            resultados oficiais, série,
setores e telemetria        grid, finish, classe, SOF, split
          \                 /
           Supabase/PostgreSQL
           histórico consolidado,
           matching e views analíticas
                    |
             Next.js/TypeScript
             Vercel + UI web
```

- **Garage61:** fonte atual para catálogo, sessões, voltas, setores, carros, pistas, histórico de rating e telemetria disponível.
- **Supabase:** banco histórico, camada de classificação, matching e views; Supabase Storage é o destino proposto para CSVs de referência.
- **Next.js/Vercel:** aplicação e rotas server-side de integração/sync. Secrets ficam em variáveis de ambiente.
- **iRacing `/data` API:** fonte futura e oficial de resultados competitivos. Não deve ser substituída por inferências frágeis do Garage61.

## Setup atual conhecido do repositório

O projeto é uma aplicação Next.js/TypeScript publicada em `https://iracing-analytics.vercel.app`, integrada ao Supabase e ao Garage61. O histórico registra rotas para catálogo, contas/perfil, rating history, laps, car groups, dashboard e sincronização, incluindo variantes de batch/backfill e rotas temporárias de debug.

Antes de mexer, inventarie `app/`, `components/`, `lib/`, migrations/SQL e scripts declarados em `package.json`. Rotas de debug devem ser tratadas como auxiliares, não como contratos públicos permanentes. Não presuma que toda rota discutida no histórico ainda exista.

O sync do Garage61 foi desenvolvido para ser incremental e idempotente. Houve uma sincronização validada de car groups com 19 grupos, 72 associações e nenhum carro ausente. Backfills completos existem como operação excepcional; não devem rodar no caminho normal.

## Banco: estruturas principais conhecidas

Tabelas identificadas no histórico:

- `drivers`: identidade/perfil do piloto.
- `cars` e `tracks`: catálogo normalizado do Garage61/iRacing.
- `sessions` e/ou `driving_sessions`: sessões dirigidas; `driving_sessions` é a base usada pelas views analíticas mais recentes e contém, entre outros, IDs externos, timestamps, season, carro, pista e `session_type`.
- `laps` e `lap_sectors`: voltas e setores.
- `ratings` e `rating_history`: estado e histórico de ratings; análises usam `rating_type = 'irating'` e categorias como `formula_car` e `sports_car`.
- `daily_statistics`: estatísticas agregadas por data.
- `sync_runs`: observabilidade/controle das sincronizações.
- `car_groups` e `car_group_members`: grupos/classes vindos do Garage61.
- `car_rating_categories`: classificação analítica do carro por categoria de licença/rating, com origem derivada ou manual.

Views identificadas:

- `v_season_summary`: resumo por season.
- `v_season_category_summary`: resumo de season por categoria de rating.
- `v_season_weekly_irating`: grade semanal por season/categoria, iRating e atividade para o gráfico.
- `v_historical_performance`: performance histórica agregada por dimensões como carro/pista/categoria.
- `v_race_irating_candidates`: candidatos para associação entre corridas e mudanças de iRating.

Esses nomes refletem o estado discutido. Sempre conferir definição e consumidores reais antes de alterar. Views pesadas já causaram timeout no Supabase/PostgREST; a solução adotada foi ler/agregar as bases uma vez e só então cruzar uma grade pequena de seasons × 12 semanas × 2 categorias.

## Seasons e weeks

O modelo atual considera 12 semanas regulares por season. A week é calculada por:

```text
floor((timestamp - season_start) / 7 dias) + 1
```

e deve ficar entre 1 e 12. O histórico da view semanal registrou:

| ID | Season | Início UTC |
|---|---|---|
| 31 | 2025 Season 4 | 2025-09-16 00:00 |
| 32 | 2026 Season 1 | 2025-12-16 00:00 |
| 33 | 2026 Season 2 | 2026-03-17 00:00 |
| 34 | 2026 Season 3 | 2026-06-16 00:00 |

Essas datas estavam codificadas na view discutida. Ao adicionar seasons, preferir uma dimensão/tabela de calendário validada contra a fonte oficial em vez de espalhar datas hardcoded.

## Matching de delta de iRating

Garage61 fornece a atividade detalhada e um histórico de rating, mas não um vínculo confiável e direto entre cada resultado oficial e sua mudança de iRating. A camada atual faz associação temporal.

Regras:

1. Trabalhar apenas com Race (`session_type = 3`).
2. Separar por categoria (`formula_car` ou `sports_car`).
3. Calcular a mudança entre registros consecutivos de `rating_history` da mesma categoria.
4. Formar candidatos por proximidade temporal entre a corrida e o registro de rating.
5. Manter associação um-para-um: uma mudança não pode ser reutilizada em várias corridas.
6. Não forçar casos ambíguos; preservar confiança/diagnóstico.

Esse matching é uma aproximação. A iRacing Data API poderá fornecer `old_irating`, `new_irating` ou contexto oficial equivalente por subsession; quando validado, isso deve substituir ou ao menos auditar a associação probabilística.

## Categoria, série, classe e carro

O modelo conceitual correto é:

```text
Categoria de rating → Série → Classe → Carro → Pista
```

- Formula Car e Sports Car são categorias de licença/rating.
- IMSA, GT Sprint e séries próprias de protótipos são séries.
- GT3, GTP e LMP2 são classes; não identificam sozinhas a série.
- O mesmo GT3 pode correr na IMSA e em uma série exclusiva de GT3; o mesmo vale para GTP e LMP2.
- `car_groups` é útil para classe, mas não deve criar/inferir série.

Classificações confirmadas incluem GT3 e GTP via grupos do Garage61 e Super Formula como Formula Car. Exceções manuais registradas no histórico:

- Dallara P217 → `sports_car`, classe LMP2.
- Mercedes-AMG W13 E Performance → `formula_car`.
- Super Formula Lights → `formula_car`.

Após essas exceções, a meta/validação discutida era classificar todas as 363 corridas então existentes. A identificação real de série permaneceu dependente de melhor metadado de evento ou da iRacing Data API; não inferir série pelo carro.

## Dashboard e direção visual

A direção aprovada é uma interface **iRacing light**: clara, esportiva e técnica, com hierarquia forte, bastante espaço, superfícies brancas/cinza-claro, texto escuro e azul/vermelho usados com parcimônia. Evitar aparência genérica de admin dashboard e excesso de cards/gradientes.

O Overview é centrado em comparação Season × Season e mantém a análise profunda fora da página principal. A navegação analítica futura deve permitir descer por Categoria → Série → Classe → Carro → Pista, sempre mostrando tamanho da amostra para evitar conclusões enganosas.

### KPIs

O conjunto discutido inclui, por Formula Car e Sports Car:

- delta de iRating da season atual;
- comparação com a season anterior e diferença Season over Season;
- corridas/atividade;
- wins, inicialmente indisponíveis até a integração oficial.

Com iRacing `/data`, podem entrar best/average finish, average start, posições ganhas, Top 5, pódios, wins, average SOF e split. Em multiclass, win significa P1 na classe.

### Gráfico semanal de iRating

O gráfico mostra iRating absoluto/evolução por week e categoria, com contexto da atividade no tooltip. A grade de 12 weeks preserva semanas sem mudança e permite comparação entre seasons.

Bug conhecido: `races` estava filtrado por `session_type = 3`, mas arrays de `cars` e `tracks` agregavam todas as sessões. Isso fazia Practice aparecer no tooltip/pontos associados à evolução de iRating.

Regra correta: para esse gráfico, `races`, `cars` e `tracks` devem considerar somente `session_type = 3`. Idealmente, a atividade exibida deve ser ainda mais restrita às corridas efetivamente associadas ao movimento de rating; até essa associação ser confiável, nunca incluir Practice/Qualifying.

## Telemetria da semana ativa

O dashboard olha a season; a telemetria olha o trabalho da semana vigente.

### Fluxo definido

- Uma seção `ACTIVE WEEK TELEMETRY` lista automaticamente combinações distintas de **carro + pista** encontradas na atividade da semana.
- O seletor troca todo o contexto. Em uma semana com apenas Super Formula em Monza, ele funciona quase como label; em semanas com duas categorias, alterna telemetria, melhor volta, referência e análise.
- **Sua telemetria:** pré-carregada automaticamente do Garage61 para o par selecionado e a semana vigente.
- **Referência:** upload manual do arquivo de telemetria fornecido pelo Data Pack. Não é necessário integrar o Data Pack ao Garage61.
- O upload deve detectar/validar carro e pista quando possível. Na ausência de metadados suficientes, usar o par selecionado e pedir confirmação.
- Primeira versão: uma referência ativa por carro+pista, persistida para reutilização futura. CSV original no Supabase Storage; metadados e, se útil, formato normalizado no banco.

Modos considerados para a telemetria própria: melhor volta limpa como padrão, média das cinco melhores e race pace. Não comparar voltas incompatíveis sem expor diferenças relevantes de combustível/setup/condição.

### Proposta de análise detalhada

Normalizar as voltas por distância de pista e calcular:

- tempo total e delta acumulado;
- setores/minissetores e maiores perdas;
- velocidade, brake, throttle, steering, gear e RPM;
- pontos de frenagem e retomada, entry/minimum/exit speed e full throttle;
- linha/posição lateral quando os canais disponíveis permitirem;
- visão por curva e ranking das maiores oportunidades.

A saída deve gerar coaching contextual, não instruções simplistas. Exemplo: frear antes pode ser correto se permitir maior velocidade mínima e retomada mais cedo; não recomendar apenas “frear X metros mais tarde” sem analisar o conjunto.

A página detalhada proposta mostra seleção carro+pista, estado do sync Garage61, referência ativa/substituição, melhor volta, gap, gráfico de delta, maiores oportunidades e análise por curva. Isso é roadmap, não deve ser descrito como já implementado sem confirmação no código.

## Limitação de wins e resposta do Garage61

Simon, do Garage61, confirmou que resultados dos eventos não são armazenados. Os dados de Live Timing são temporários e não podem ser recuperados; persistir todo esse volume teria custo alto. A recomendação dele foi usar a iRacing `/data` API.

Decisão: não tentar reconstruir wins históricos pelo endpoint interno de Live Timing. Garage61 continua sendo a fonte de telemetria/voltas; resultados, posição e wins virão da fonte oficial. Até lá, cards de wins devem ficar indisponíveis/aguardando integração, sem valores inferidos.

## iRacing Data API e OAuth

Roadmap previsto:

1. Registrar o Racing Analytics como cliente OAuth confidencial, pessoal, single-user e read-only.
2. Implementar Authorization Code Flow com callback server-side; nunca armazenar senha do iRacing.
3. Guardar access/refresh tokens de forma segura e renová-los server-side.
4. Testar identidade do membro e depois `results/search_series` para uma única season/categoria, filtrando `cust_id`, oficial e Race.
5. Buscar o resultado completo por `subsession_id` com `results/get`.
6. Criar/validar `race_results` com season/série/week, classe/carro/pista, SOF/split, grid/finish, incidentes, voltas e delta de iRating.
7. Validar S3 antes de expandir; fazer backfill histórico em janelas limitadas (o planejamento considerou blocos de até 90 dias), com deduplicação e checkpoint incremental.
8. Enriquecer KPIs e análises por série/classe/carro; depois ligar resultado oficial à telemetria Garage61 da mesma corrida.

Endpoints complementares considerados: event log, lap chart, lap data e season results. Só implementá-los quando uma necessidade de produto justificar.

### Estado do registro OAuth em 19/08/2026

A criação pública de novos OAuth Client IDs estava temporariamente pausada segundo a documentação consultada na conversa. Foi redigido um pedido ao suporte para uma aplicação:

- nome: Racing Analytics;
- tipo: web app pessoal/não comercial, single-user e read-only;
- produção: `https://iracing-analytics.vercel.app`;
- redirect proposto: `https://iracing-analytics.vercel.app/api/iracing/callback`;
- fluxo: Authorization Code;
- finalidade: analisar os próprios resultados oficiais.

O estado conhecido é **aguardando disponibilidade/exceção/resposta de registro**; não há Client ID/Secret confirmado no contexto. Revalidar a documentação oficial e a resposta do suporte antes de implementar. Não reutilizar credenciais de outro aplicativo.

## Próximos passos priorizados

1. Abrir o repositório real, conferir branch/status, `package.json`, schema/migrations, rotas e contrato atual das views; alinhar este documento ao código se houver divergência.
2. Corrigir e validar o gráfico semanal/tooltip para Race-only (`session_type = 3`) em corridas, carros e pistas; testar semanas com Practice e Race.
3. Rodar testes e `npm run build`, revisar diff pequeno e versionar a correção.
4. Auditar o matching corrida ↔ delta de iRating, cobertura, conflitos e confiança; não forçar associações ambíguas.
5. Manter wins como pendente e acompanhar o registro OAuth do iRacing.
6. Quando houver credenciais, implementar OAuth isoladamente e provar o fluxo com uma season pequena antes de criar backfill.
7. Modelar `race_results` somente após observar payloads reais; então adicionar wins e métricas oficiais à UI.
8. Construir a primeira versão de Active Week Telemetry: seletor carro+pista, telemetria Garage61, upload/validação/persistência de uma referência.
9. Implementar normalização por distância e MVP de comparação (delta, speed, brake, throttle e maiores perdas), evoluindo depois para coaching por curva.
10. A cada decisão ou mudança de schema/arquitetura, atualizar este arquivo no mesmo diff.
