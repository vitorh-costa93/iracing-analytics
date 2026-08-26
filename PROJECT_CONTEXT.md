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

Em 19/08/2026, o repositório foi inicializado para desenvolvimento versionado com Supabase CLI `2.115.0`, fixada como dependência de desenvolvimento, e passou a conter `supabase/config.toml`. A integração Supabase ↔ GitHub já foi habilitada externamente. O checkout local foi vinculado com segurança ao projeto remoto `iracing-analytics` (`lwmochpoeltioebqhwwv`, PostgreSQL 17.6) e o schema `public` existente foi exportado, sem dados ou secrets, para a migration baseline `20260819000000_remote_schema.sql`. Esse baseline foi registrado como já aplicado no histórico remoto; `supabase db push --dry-run` confirmou que não há migrations pendentes. Nenhuma alteração de schema ou dados foi aplicada durante essa preparação.

O sync do Garage61 foi desenvolvido para ser incremental e idempotente. Houve uma sincronização validada de car groups com 19 grupos, 72 associações e nenhum carro ausente. Backfills completos existem como operação excepcional; não devem rodar no caminho normal.

Em 19/08/2026 foi identificado que o botão de atualização sincronizava catálogo, estatísticas e ratings, mas não alimentava `driving_sessions`, tabela consumida pelas views do dashboard. O fluxo recorrente passou a incluir um sync incremental de sessões: ele usa a sessão mais recente como cursor, relê uma sobreposição de sete dias (limitada aos últimos 14 dias), consulta apenas pares carro+pista com atividade nesse período e consolida as voltas por identidade de evento/sessão/carro/pista antes do upsert. A janela de sete dias evita que atividade nova de uma categoria faça o cursor saltar sobre uma corrida ainda ausente de outra categoria, caso observado com McLaren GT3 em Indianapolis. O Supabase Cron agenda esse fluxo a cada hora, no minuto 7, chamando um endpoint server-side protegido por um segredo compartilhado armazenado no Supabase Vault e em `CRON_SECRET` na Vercel. Backfills continuam separados desse caminho.

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

Auditoria executada em 19/08/2026 pela query versionada `supabase/queries/audit_irating_matching.sql`:

- Formula Car: 166 corridas, 138 matches aceitos (83,1%), 7 sem candidato e 21 rejeitadas por conflito; 129 matches aceitos ocorreram em até 60 minutos.
- Sports Car: 197 corridas, 181 matches aceitos (91,9%), 6 sem candidato e 10 rejeitadas por conflito; 167 matches aceitos ocorreram em até 60 minutos.
- A disputa é material: 54 mudanças de Formula e 68 de Sports tinham mais de uma corrida candidata. A regra atual preservou o vínculo um-para-um ao deixar 31 corridas sem match por conflito.
- Foi encontrado um match aceito de Sports a 323,8 minutos da corrida. Ele deve ser tratado como baixa confiança em uma evolução do modelo; não aumentar cobertura forçando casos distantes ou ambíguos.

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

Em 20/08/2026 o Overview foi reduzido aos quatro KPIs principais: iRating e vitórias para Formula e Sports Car. O iRating compara o valor atual com o encerramento da mesma week da season anterior. Abaixo, um seletor único de categoria controla o gráfico de área e um scatter de corridas da season atual (duração da sessão × delta associado), sempre com `session_type = 3`. A tabela final lista todas as corridas; série, grid e chegada permanecem explicitamente ausentes quando o Garage61 não fornece esses campos, sem inferência. O primeiro ranking por pista é fixo em Formula; GT3 e IMSA preservam seus próprios recortes Sports Car.

O comparador de setup permite selecionar livremente quaisquer dois setups do mesmo carro+pista. As explicações passaram a descrever direção e compromisso de mudanças conhecidas, como brake bias e asas, para alimentar o raciocínio da subaba Engenheiro. A telemetria identifica curvas pela sequência de zonas de frenagem detectadas; quando não há zona próxima, mantém o rótulo de trecho em vez de inventar um nome oficial.

### KPIs

O conjunto discutido inclui, por Formula Car e Sports Car:

- delta de iRating da season atual;
- comparação com a season anterior e diferença Season over Season;
- corridas/atividade;
- wins, inicialmente indisponíveis até a integração oficial.

Com iRacing `/data`, podem entrar best/average finish, average start, posições ganhas, Top 5, pódios, wins, average SOF e split. Em multiclass, win significa P1 na classe.

### Gráfico semanal de iRating

O gráfico mostra iRating absoluto/evolução por week e categoria, com contexto da atividade no tooltip. A grade de 12 weeks preserva semanas sem mudança e permite comparação entre seasons.

Em 19/08/2026, a migration `20260819010000_fix_weekly_activity_race_only.sql` corrigiu a view semanal para que `races`, `cars` e `tracks` sejam derivados exclusivamente de `session_type = 3`. A validação antes/depois no endpoint de produção confirmou a remoção de atividade de Practice, incluindo uma semana que antes mostrava carros e pista apesar de `races = 0`, sem alterar as contagens de corrida.

Como evolução futura, a atividade exibida pode ser ainda mais restrita às corridas efetivamente associadas ao movimento de rating; até essa associação ser confiável, nunca incluir Practice/Qualifying.

## Telemetria da semana ativa

O dashboard olha a season; a telemetria olha o trabalho da semana vigente.

### Fluxo definido

- Uma seção `ACTIVE WEEK TELEMETRY` lista automaticamente combinações distintas de **carro + pista** encontradas na atividade da semana.
- O seletor troca todo o contexto. Em uma semana com apenas Super Formula em Monza, ele funciona quase como label; em semanas com duas categorias, alterna telemetria, melhor volta, referência e análise.
- **Sua telemetria:** pré-carregada automaticamente do Garage61 para o par selecionado e a semana vigente.
- **Referência:** upload manual do arquivo de telemetria fornecido pelo Data Pack. Não é necessário integrar o Data Pack ao Garage61.
- O upload deve detectar/validar carro e pista quando possível. Na ausência de metadados suficientes, usar o par selecionado e pedir confirmação.
- Primeira versão: uma referência ativa por carro+pista, persistida para reutilização futura. CSV original no Supabase Storage; metadados e, se útil, formato normalizado no banco.

Em 19/08/2026 foi implementada a primeira fatia funcional da telemetria própria. O dashboard identifica os pares carro+pista presentes em `driving_sessions` dentro dos limites da week vigente, consulta as voltas desse par no Garage61 e seleciona a melhor volta limpa com telemetria disponível. O seletor usa o rótulo concatenado `Carro — Pista`; com um único par ele fica desabilitado e atua como identificação do contexto. Ao trocar o par, o CSV é pré-carregado pela rota server-side existente e os canais reconhecidos de velocidade, acelerador e freio são desenhados por distância. O token do Garage61 permanece somente no servidor. Esta implementação não persiste nem reimporta voltas e não altera o sync incremental.

O upload e a persistência de referência de Data Pack, normalização comparativa, delta e coaching continuam como roadmap; não fazem parte desta primeira fatia.

Em seguida foi implementado o upload de uma referência CSV ativa por driver+carro+pista. O arquivo original é validado server-side, limitado a 10 MB, salvo em bucket privado `telemetry-references` e descrito em `telemetry_references`; somente a service role acessa tabela e objeto. Um novo upload substitui de forma idempotente a referência do mesmo contexto. A UI recupera essa referência automaticamente ao trocar o seletor.

A comparação inicial interpola as duas voltas em uma grade comum de distância, sobrepõe velocidade e usa a integral inversa da velocidade, calibrada pelo tempo real da volta própria, para estimar tempo/gap da referência e perdas por décimos da pista. Os insights destacam até três segmentos e cruzam diferença de velocidade, freio e acelerador. Esses ganhos são estimativas: combustível, setup, clima e aderência precisam ser considerados antes de transformar o achado em recomendação de pilotagem. Identificação por curva e coaching contextual mais profundo continuam no roadmap.

O upload também aceita arquivos binários `.ibt` nativos do iRacing. Como esses arquivos podem superar 100 MB e conter uma sessão inteira, a aplicação os decodifica localmente no navegador, valida o cabeçalho/canais, elimina voltas incompletas ou com passagem pelos boxes e extrai a volta completa mais rápida. Somente um CSV normalizado e reduzido dessa volta é enviado ao servidor; o IBT original não sai do computador e não fica armazenado. A seleção automática por enquanto não usa incident flags, combustível ou condição de pista para decidir a volta de referência, limitações que devem ser consideradas na análise.

A análise detalhada passou a viver em `/telemetry`, mantendo o overview como porta de entrada. Os gráficos sincronizados cobrem velocidade, throttle, brake, steering, RPM e marcha, com tooltip das duas voltas em qualquer posição; a normalização preserva ainda clutch, aceleração lateral/longitudinal, yaw/yaw rate, latitude/longitude e estados ABS/DRS quando presentes nas duas fontes. O relatório divide a pista em segmentos de 5%, estima ganho e distância em metros quando GPS permite, compara pontos de frenagem, retomada, volante, marcha, RPM e aceleração lateral e lista métricas que sustentam cada hipótese. Não transformar correlação isolada em instrução categórica de pilotagem.

O overview foi refinado para menor peso tipográfico e densidade visual mais próxima da UI do simulador. Rankings passaram a exibir Top 5 gains e Top 5 drops, com ícones de contexto e bandeiras conhecidas por pista. O logo oficial do iRacing não foi incorporado: a página de suporte da empresa exige permissão/licença escrita para uso; preservar marca própria até existir autorização.

Após revisão visual, gains e drops voltaram a compartilhar um único ranking horizontal divergente: zero no centro, perdas à esquerda e ganhos à direita, mantendo cinco extremos de cada lado. A iconografia usa componentes SVG da biblioteca aberta Lucide e bandeiras raster pequenas do FlagCDN para países reconhecidos; quando o país não é mapeado, usa um ícone de localização.

Os insights de telemetria aparecem antes dos traços. Latitude/longitude da volta própria geram um mapa local do traçado sem depender de um endpoint externo do Garage61. Cada insight é selecionável e destaca seu segmento de 5% no mapa e sobre todos os gráficos; se o CSV não tiver GPS, o destaque nos gráficos continua sendo o fallback obrigatório.

O workspace detalhado posiciona o mapa GPS ao lado da pilha de inputs e sincroniza a posição também durante hover, aproximando o modelo mental do Garage61 sem copiar sua interface. Os insights usam frases diretas de perda estimada, causa observada e teste recomendado. Rankings permitem quebra de linha e separam amostra da barra; a inferência de país inclui circuitos norte-americanos e latino-americanos comuns. Logos de fabricantes reconhecidos vêm do CDN versionado/aberto Simple Icons, com fallback Lucide.

A fonte do produto passou a ser Manrope auto-hospedada via Fontsource. O gráfico semanal foi compactado e ganhou preenchimento de área. KPIs foram centralizados, receberam acento por categoria e ícones distintos para Formula, Sports e wins, mantendo a identidade própria.

Em 19/08/2026, a regra da Super Formula SF23 passou a preferir explicitamente a melhor volta limpa de `Qualifying` (`session_type = 2`) na semana ativa, com fallback para a melhor volta limpa geral somente quando não houver volta classificatória. A inspeção de um IBT real confirmou os canais `PushToPass`, `P2P_Status` e `P2P_Count`; o conversor browser-side agora os preserva e o tooltip os exibe quando presentes. O CSV exportado pelo Garage61 observado não continha esses canais, portanto não se deve inferir P2P em voltas próprias vindas apenas desse CSV.

O histórico real contém `safety_rating` para Formula Car e Sports Car. O overview passou a substituir wins indisponíveis por Safety Rating, usando `rating_display` para o card (por exemplo, licença + valor) e o valor decimal do display para a série semanal. A página mostra iRating e Safety Rating lado a lado; mudanças de classe/licença devem ser interpretadas junto do prefixo do card, pois a curva representa o componente decimal do SR.

A navegação principal agora expõe Overview, Telemetria e Setup. `/setup` introduz as subáreas Gerador de setup e Engenheiro, populadas pelo carro+pista da season. O Gerador aceita um `.sto` fixed e um comercial do mesmo contexto, decodifica seus parâmetros reais e apresenta a comparação campo a campo com uma explicação técnica do efeito provável. A regravação de `.sto` e recomendações por IA continuam bloqueadas até existir um encoder validado e um provedor de IA exclusivamente server-side. Nunca inventar parâmetros nem gerar binário incompatível; setups comerciais devem permanecer privados e dentro da licença de uso do comprador.

Os `.sto` possuem uma seção criptografada que não pode ser interpretada diretamente pela aplicação. O SetupDelta foi retirado e não participa mais do fluxo. O Garage61, porém, mantém os parâmetros já decodificados dos setups efetivamente usados nas sessões que o usuário pode visualizar. Esses parâmetros são importados para `setup_files.decoded_params` e o payload de origem fica no bucket privado; nenhum arquivo comercial é publicado ou enviado a outro decodificador.

Em 20/08/2026 foi concluído o primeiro backfill autenticado da 2026 Season 3. As 89 corridas armazenadas em `driving_sessions` foram cruzadas por `garage61_event_id` com o evento correspondente no Garage61. Foram observados 260 usos de setup e consolidados 67 setups lógicos por carro+pista+nome: 28 fixed e 39 comerciais, cobrindo Super Formula SF23, Ferrari 499P, Acura ARX-06 e os GT3 McLaren 720S EVO, Ferrari 296 e Ford Mustang. O importador persiste os parâmetros normalizados, tipo, evento/run de origem e cópia JSON privada. Reexecuções são idempotentes pela chave existente `driver_id,season_id,car_id,track_id,filename`.

Em 20/08/2026, a biblioteca local do PC foi inventariada: existem 2.941 `.sto` no total, dos quais 282 pertencem à pasta `26S3`. O importador versionado adiciona somente esses arquivos e o `-Current-` dos sete carros envolvidos, totalizando 289 objetos no bucket privado `private-setups`, além de um manifesto sem conteúdo decodificado. A UI do Setup Lab mostra o catálogo agrupado por carro, fornecedor e pista inferida. Setups comerciais nunca devem ser publicados. Os setups padrão internos do iRacing não existem como arquivos soltos na instalação; ficam empacotados no simulador, mas os parâmetros fixed usados aparecem no histórico autenticado do Garage61.

O endpoint server-side anteriormente usado no SetupDelta passou a responder HTTP 410 e foi removido do comparador. A comparação fixed × open/comercial agora funciona somente com parâmetros já capturados pelo Garage61; uploads `.sto` sem parâmetros associados permanecem armazenados, mas a UI informa que é necessário usar o setup em uma sessão registrada antes de compará-lo.

O Setup Lab inventaria todos os pares carro+pista com corridas (`session_type = 3`) na season atual, não apenas a semana ativa. Os seletores separam fixed de open/comercial e usam diretamente os registros que possuem `decoded_params`, sem consentimento para serviço externo. Uploads manuais continuam limitados a 5 MB, armazenados no bucket privado `private-setups` e catalogados em `setup_files`; somente rotas server-side com service role acessam objetos e metadados.

A subaba Engenheiro usa o mesmo cofre: anexar um `.sto` executa o upload, seleciona o arquivo como setup ativo e libera a geração de um plano preliminar baseado no feedback de entrada/meio/saída. As recomendações são regras conservadoras de teste A/B, explicam efeito e telemetria a validar e nunca afirmam ter regravado o binário. A edição automática do `.sto` e a análise autônoma sem feedback continuam dependentes de um parser validado para o formato e de integração server-side com telemetria/referência; não esconder essa limitação atrás de um botão inerte.

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

## Resultados oficiais e wins

Simon, do Garage61, confirmou que resultados dos eventos não são armazenados. Os dados de Live Timing são temporários e não podem ser recuperados; persistir todo esse volume teria custo alto. A recomendação dele foi usar a iRacing `/data` API.

Decisão: não tentar reconstruir wins históricos pelo endpoint interno de Live Timing. Garage61 continua sendo a fonte de telemetria/voltas; resultados, posição e wins vêm de evidência oficial do iRacing.

Em 20/08/2026 foi criada a tabela `official_series_results`, que preserva snapshots auditáveis por piloto, season, categoria de rating e série. O overview passou a mostrar wins de Formula e SportsCar para a season atual e anterior, além do detalhamento de largadas e vitórias por série. A primeira carga foi validada diretamente em Series Standings e Results Archive para 2026 S3/S2. O total confirmado é 36 vitórias de Formula (20 em S3 e 16 em S2, incluindo uma vitória de Super Formula Lights Fixed na semana 11) e 3 de SportsCar (2 em S3 e 1 em S2).

Esse snapshot remove a necessidade de consultar o site em cada abertura do painel, mas não deve ser descrito como sincronização automática completa. O refresh recorrente continuará pendente até existir OAuth oficial do iRacing; nessa etapa, a rota de sync deverá atualizar a mesma tabela incrementalmente e armazenar resultados individuais/deduplicados. Não automatizar scraping de sessão autenticada do navegador no Vercel nem armazenar cookies/senhas. Para correções pontuais antes do OAuth, atualizar apenas com evidência do Results Archive/Series Standings e registrar `captured_at`/`source`.

Em 25/08/2026 o botão manual `Atualizar dados` passou a não chamar mais o iRStats pelo servidor, pois esse caminho é bloqueado por Cloudflare fora de um navegador real. O botão abre Garage61 e iRStats em abas separadas, sincroniza Garage61/Supabase via rotas server-side (`sync/all`, `sync/incremental`, `sync/rating-history`) e deixa o iRStats para o importador browser-side. O script público `public/irstats-import.js` mantém `window.__iisState` para acompanhamento e, por padrão pós-backfill completo, faz sync incremental: consulta os IDs já presentes em `race_results`, percorre as páginas mais recentes e para ao encontrar uma página sem corridas novas. Para auditoria de lacunas históricas, `localStorage.iis_full_scan = "true"` reativa a varredura completa limitada.

Com o histórico completo de `race_results`, os rankings de performance por pista/carro passaram a destacar a média de Δ iRating por corrida como métrica principal. O Δ total permanece como KPI secundário e a lógica visual de Top 5 ganhos / Top 5 perdas segue separando extremos positivos e negativos.

Também em 25/08/2026, a abertura do iRStats pelo botão foi ajustada para usar o `href` nativo do controle, reduzindo bloqueio de popup. A telemetria detalhada foi reorganizada para privilegiar legibilidade: mapa principal do traçado em linha própria e maior, hover map ampliado, gráfico de ritmo ocupando a largura disponível, análise por curva em linhas com mapa maior e consistência por setor desenhada no traçado da pista por cor. O diff de setup passou a identificar explicitamente Setup A e Setup B e reduziu a densidade visual do texto explicativo.

Em 26/08/2026, o fluxo manual de importação passou a abrir uma única aba nomeada para cada fonte. Os bookmarklets de Garage61 e iRStats notificam a janela do Analytics ao concluir, exibem contagens incrementais (inclusive “sem novidades”) e fecham somente a aba que foi aberta pelo painel. O browser não permite que o Analytics execute JavaScript dentro de `garage61.net` ou `irstats.com`; portanto a execução do bookmarklet/futuro userscript continua sendo necessariamente dentro de cada origem. Não alegar automação de um clique até existir uma extensão/userscript instalado que faça essa ponte.

Na mesma mudança, `race_results.category` passou a aceitar `road`. A carteira ROAD não entra nos KPIs, nas séries temporais ou no matching de iRating de Formula/Sports; seus deltas iRStats entram apenas em `v_historical_performance`, permitindo que histórico de GT3, IMSA e SF23 de outra carteira complemente os recortes de contexto. Rankings agora exigem no mínimo duas corridas. Os mapas de telemetria usam projeção local com correção de longitude por latitude e escala única, para não deformar o traçado GPS; os setores mostram IDEAL, MELHOR VOLTA e um delta que soma exatamente ao gap mostrado no cabeçalho.

Em 26/08/2026 o launcher foi ajustado novamente: iRStats abre pela navegação nativa do link (mais confiável que uma segunda janela programática) e Garage61 permanece como a única popup. O mapa geral de Track Position foi removido do workspace; o painel ao lado dos inputs desenha somente a janela sob o hover, incluindo os dois traços. O mesmo recorte local é usado em cada card de curva. A detecção de curvas do debrief passou a preferir curvatura do GPS, com fallback à aceleração lateral; isso evita numerar como Curva 1 a primeira zona de frenagem detectada depois de curvas suaves. O cache é versionado para recomputar debriefs anteriores. O bookmarklet iRStats faz uma auditoria completa única após a atualização de parser ROAD e só então volta ao modo incremental.

Na verificação posterior do banco em 26/08/2026 havia 1.138 `race_results` (550 Formula, 588 Sports e 0 Road). Portanto o schema e a view já aceitam Road, mas a auditoria browser-side ainda precisa de uma execução completa para trazer as corridas históricas que o parser anterior rejeitava. Não apresentar os rankings atuais como se já contivessem essa carteira até que a contagem Road seja maior que zero. A programação conhecida da 2026 S3 W11 foi registrada explicitamente para os cards semanais: Algarve/Super Formula 23, Road Atlanta/IMSA e Red Bull Ring/GT3; não inferir calendário de corridas a partir da atividade já realizada.

Em 27/08/2026, após a execução validada da ponte do Chrome, `race_results` passou a conter 553 Formula, 590 Sports e 186 Road. A carteira Road agora participa dos rankings de contexto e os KPIs de iRating priorizam a última linha exata de `v_race_results_irating`, evitando esperar a próxima coleta do histórico do Garage61. A seleção de telemetria da semana parte das sessões Garage61 de Race/Qualifying/Practice: usa a melhor volta de Race quando ela existe, ou a melhor Practice quando ainda não há corrida; Super Formula exclui voltas de Race sinalizadas com P2P. A migration `20260827000000_track_garage61_setup_events.sql` registra o evento de origem no setup importado para que, após a primeira execução de transição, o importador browser-side pule eventos já processados.

Em 26/08/2026 foi adicionada a extensão local Chrome `chrome-extension/`, necessária porque uma página no domínio do Analytics não pode executar o importador dentro de `irstats.com` ou `garage61.net`. Depois de carregada uma vez em `chrome://extensions`, ela recebe o clique de Atualizar dados, abre ambas as abas com o marcador de sync, injeta os importadores já versionados no app e fecha cada aba quando a origem confirma a conclusão. As chaves continuam solicitadas e guardadas somente no `localStorage` de cada origem. Enquanto `race_results` tiver zero linhas `road`, o importador força uma auditoria histórica completa, independentemente de um marcador local antigo.

Na revisão seguinte, o carregamento remoto por tag `<script>` foi substituído por execução dos importadores empacotados na própria extensão, via `chrome.scripting.executeScript` no mundo principal da aba. Isso evita bloqueio por Content Security Policy de iRStats/Garage61. Após atualizar a extensão local, é preciso usar o botão Recarregar em `chrome://extensions` antes de disparar um novo sync.

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
2. Manter os snapshots de wins auditáveis e acompanhar o registro OAuth do iRacing para automatizar o refresh.
3. Quando houver credenciais, implementar OAuth isoladamente e provar o fluxo com uma season pequena antes de criar backfill.
4. Modelar `race_results` somente após observar payloads reais; então adicionar wins e métricas oficiais à UI.
5. Construir a primeira versão de Active Week Telemetry: seletor carro+pista, telemetria Garage61, upload/validação/persistência de uma referência.
6. Implementar normalização por distância e MVP de comparação (delta, speed, brake, throttle e maiores perdas), evoluindo depois para coaching por curva.
7. A cada decisão ou mudança de schema/arquitetura, atualizar este arquivo no mesmo diff.
