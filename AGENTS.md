# AGENTS.md — Racing Analytics

Estas instruções valem para todo o repositório (fonte das regras). Consulte as seções pertinentes de `PROJECT_CONTEXT.md` quando a tarefa exigir contexto profundo; use `docs/CODEX_CONTEXTO.md` como índice antes de carregar o documento inteiro.

## Princípios de trabalho

- Preserve o sync existente com o Garage61. Antes de alterar rotas, cursores, upserts, constraints ou identidade de registros, entenda o fluxo atual e valide que execuções repetidas continuam idempotentes.
- Trabalhe com diffs pequenos, focados e versionáveis. Não misture refactors amplos com correções funcionais.
- Não assuma nomes, tipos ou relações do banco. Inspecione migrations, schema e queries existentes antes de mudar SQL, views, tabelas, índices, constraints ou políticas RLS.
- Ao mudar uma view consumida pela aplicação, valide o contrato retornado e os consumidores no Next.js. Em PostgreSQL, considere `DROP VIEW` + recriação quando `CREATE OR REPLACE VIEW` não puder alterar a estrutura de colunas com segurança.
- Não faça backfill completo no sync normal. O caminho recorrente deve ser incremental, com sobreposição pequena e upsert idempotente. Backfills históricos devem ser explícitos, paginados, observáveis e executados separadamente.
- Não descarte nem reimporte dados existentes sem autorização. Prefira migrations aditivas e operações recuperáveis.
- Preserve a stack e os limites do projeto: Next.js/TypeScript no Vercel, Supabase/PostgreSQL/Storage e Garage61 como fonte de sessões, voltas e telemetria. A futura iRacing `/data` API será a fonte oficial de resultados.

## Regras de negócio obrigatórias

- Em qualquer métrica ou atividade de corrida ligada a evolução de iRating, considere apenas `session_type = 3` (Race). Practice e Qualifying não podem aparecer em contagens, carros, pistas ou tooltips que expliquem variação de iRating.
- Não atribua uma alteração de iRating a mais de uma corrida. Preserve matching um-para-um, por categoria de licença/rating, usando proximidade temporal e deixando casos ambíguos sem associação.
- `GT3`, `GTP` e `LMP2` são classes, não séries. Um carro/classe não determina a série; IMSA e séries próprias precisam de identificação independente.
- O Dallara P217 é `sports_car` e classe `LMP2`, mesmo quando o Garage61 não o inclui em um grupo adequado.
- Vitórias multiclass, quando vierem da iRacing Data API, devem usar posição na classe (`class_finish_position = 1`), não necessariamente P1 geral.
- Weeks são calculadas a partir do início oficial da season, em blocos de sete dias. Não derive week apenas de mês ou calendário civil.

## Segurança e integrações

- Nunca exponha secrets, PATs, client secrets, tokens, refresh tokens, cookies ou credenciais em código, logs, respostas de API, commits ou documentação.
- Acesse Garage61 e iRacing somente no servidor. Tokens de OAuth devem permanecer server-side; use variáveis de ambiente do Vercel e armazenamento seguro apropriado.
- Não reutilize credenciais OAuth pertencentes a clientes oficiais ou terceiros.
- Trate payloads externos como não confiáveis: valide campos, paginação, rate limits, links temporários, CSVs enviados e combinações carro+pista antes de persistir.

## Validação antes de commit

1. Revise `git diff` e confirme que o escopo é o solicitado.
2. Para código, rode os testes disponíveis (`npm test`, ou o comando definido em `package.json`); agentes intermediários podem rodar testes focados, com a suíte final sob responsabilidade da integração.
3. Para código, rode `npm run build` na integração final e corrija erros; não repita builds já aprovados para o mesmo estado relevante.
4. Para mudanças de dados, valide a query/view no schema real e compare amostras antes/depois, incluindo reexecução do sync para testar idempotência.
5. Não faça commit/push com testes ou build falhando sem documentar e obter autorização explícita.

## Documentação viva

- Atualize `PROJECT_CONTEXT.md` no mesmo diff sempre que houver decisão arquitetural, mudança de schema/view, nova integração, alteração de regra de negócio, mudança relevante de UI ou reordenação do roadmap.
- Registre claramente o que está implementado, o que foi apenas proposto, limitações conhecidas e evidência usada para decisões externas.
- Se o código ou schema real divergir deste documento, confirme a realidade no repositório/banco, corrija a implementação com cuidado e atualize a documentação.

## Mapa e limites
- UI em `app/` e `components/`; dados/telemetria em `lib/` e `app/api/`; banco em `supabase/migrations/`.
- Preserve plano free e guardas de cache, tamanho, Storage, backfill e frequência de cron. Consulte `CLAUDE.md` nas seções correspondentes para contratos detalhados.
- Histórico em `docs/HISTORY.md` é consulta, não leitura obrigatória por tarefa.

## Execução econômica
- Leia `docs/CODEX_CONTINUIDADE.md` somente ao retomar trabalho; atualize-o ao fechar uma etapa, sem copiar histórico ou segredos.
- Busque arquivos e seções relevantes antes de carregar documentos inteiros. Seções históricas são contexto sob demanda.
- Tarefas pequenas são diretas; delegue apenas trabalho independente extenso ou revisão de risco, com escopo e critério de aceite.
- Um responsável integra e valida o estado final. Subagentes fazem testes focados e devolvem evidência; não repetem toda a suíte/build por hábito.
- Alterações somente em instruções/documentação exigem revisão de diff e links, sem build de aplicação. Para código, cumpra as verificações abaixo; repita se o estado relevante mudar.
- Consulte `docs/CODEX_CONTEXTO.md` quando existir para localizar seções de contexto.
