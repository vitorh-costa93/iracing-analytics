# MyRaceCraft — análise e oportunidades para Racing Analytics

Data: 08/10/2026. Fonte principal: navegação na conta autenticada em https://myracecraft.com/ e na sessão https://myracecraft.com/#/sessao/ferrari296gt3_twinring_fullrc_2026-10-07_18-27-05.

## Conclusão

O MyRaceCraft reúne coleta local, análise da sessão, comparação de voltas, leitura de pneus/chassi, setup e planejamento de endurance. Seu principal mérito é transformar canais em perguntas práticas: onde perdi, o que aconteceu, quanto variou e qual teste fazer. Racing Analytics já tem parte relevante da análise de pilotagem; a oportunidade é integrar melhor a sessão inteira e acrescentar os canais que o fluxo atual não preserva.

Recomendação: primeiro consolidar sessão, voltas elegíveis, setores e ocorrências; depois acrescentar combustível/pneus; só então automatizar coleta e considerar IA e live timing. Preservar Garage61 e suas garantias de sync.

## Escopo e força da evidência

- Visitados todos os módulos principais: Plano, Agente, Engenheiro, Estratégia, Equipe, Setups, Pit Wall, Debrief e Comunidade; tutorial e instruções de gravação.
- Inspecionadas as cinco abas da sessão Ferrari 296 GT3/Motegi: Resumo, Pneus, Setup, Telemetria e Engenheiro. Também inspecionados Pneus e Telemetria da Ferrari 499P/Red Bull Ring em pista mista.
- Observado = conteúdo/renderização na conta. Declarado = explicação comercial ou ajuda do próprio app. Proposto = solução para nosso projeto. O backend, o código do agente, as fórmulas internas, os serviços de IA e o transporte real não foram auditados.
- Limites: conta gratuita; comparação de setups bloqueada; equipe sem integrantes; Debrief sem eventos; Pit Wall sem sessão ativa; nenhuma análise/chat pagos executados. Esses fluxos não foram validados de ponta a ponta.
- A comparação com Racing Analytics usa seções pertinentes de PROJECT_CONTEXT.md, não uma auditoria atual de código ou produção. Confirmar implementação real ao começar cada item.
- Efeito incidental: abrir Novo plano criou automaticamente um rascunho salvo chamado Plano sem nome. Não houve preenchimento, convite, upload, compra ou início de corrida. O rascunho foi preservado porque a recuperação após excluir não é informada.

## Como coleta dados

### Telemetria pós-sessão

O app aceita seleção múltipla e arraste de arquivos .ibt nativos. A ajuda declara parsing no navegador, preparação da análise e armazenamento do .ibt compactado na conta. Arquivos sem volta cronometrada não geram card nem são enviados, segundo a ajuda. Na lista, porém, arquivos sem volta podem aparecer agregados a uma sessão: a corrida de Red Bull Ring mostrava três arquivos adicionais e seu tempo. Isso sugere uso de metadados para continuidade, mas não prova como são associados internamente.

Cada registro tem carro, layout, data, tipo de sessão, identificador da sessão, voltas, melhor volta, média limpa e tempo em pista. Race, Practice e Lone Qualify aparecem separados mesmo dentro de um mesmo evento. Há releitura do arquivo pelo agente e informação de versão da análise.

### Agente Windows

A tela informou agente 0.13.0 ligado, Windows 10/11, instalador de aproximadamente 19 MB e assinatura Certum (declaração não verificada). O agente liga a gravação e detecta o fim da saída; os cards surgem automaticamente. O endereço local anunciado é 127.0.0.1:8177. A conta mostrava vínculo de segundo plano ativo para que sessões apareçam em outros computadores mesmo sem o site aberto.

Há uma contradição documental: a tela Agente diz que o .ibt não passa pela internet e vai do disco ao navegador; a ajuda diz que o arquivo compactado fica na conta e o plano Básico anuncia .ibt guardado na conta. Não concluir que toda a arquitetura é local, nem que o original sempre é enviado. É plausível haver caminhos distintos por plano e modo de execução, mas isso não foi confirmado.

A ajuda apresenta Alt+L e os campos irsdkAutoLogDisk/irsdkEnableDisk do app.ini. Nenhuma configuração local foi alterada durante a análise.

### Resultado oficial e dados ao vivo

Debrief declara ler no navegador o CSV eventresult exportado do iRacing e guardar o evento na conta. Não foi observada integração OAuth/Data API para esse fluxo.

Pit Wall exige agente e carro em pista; declara classificação final em corridas anteriores a partir do agente 0.9.2. A leitura do SDK local é uma hipótese coerente com a experiência, mas o mecanismo não foi confirmado pela UI. Não atribuir ao .ibt sozinho a capacidade de acompanhar todos os adversários ao vivo.

## Inventário funcional

| Área | O que foi observado ou declarado | Uso possível no Racing Analytics |
|---|---|---|
| Catálogo de sessões | Agrupamento carro/layout, filtros por data/tipo, lista/cartões, contagens, tempo em pista, releitura | Histórico de trabalho de pista além da semana ativa |
| Resumo | Melhor volta, média limpa, consistência em segundos, consumo, máxima, condição de pista | Porta de entrada de um debrief da sessão |
| Perdas | Média contra melhor/ideal, ranking de curvas, abertura da telemetria | Plano de treino com três prioridades e evidência |
| Chassi | Altura mínima por roda, contato do assoalho, rotação, impactos de amortecedor, off-track, incidentes, pedais e G | Diagnóstico contextual com disponibilidade por canal |
| Ocorrências | Mapa e tabela por volta/curva/fase, duração, velocidade, intensidade e custo do trecho | Ligar eventos ao lugar e à volta que os originou |
| Curvas | Direção, ângulo, velocidade, marcha, melhor/típico, perda, diferença de linha e freada | Consistência por curva com referência própria |
| Pneus | Fria/quente, superfície e carcaça separadas, temperaturas O/M/I, borracha, projeções e aquecimento | Stint e leitura de pneus quando houver medição válida |
| Degradação | Tendência de tempo corrigida pelo combustível, intervalo de 95%, exclusão de aquecimento/erro, coeficiente editável | Medir queda de ritmo com hipóteses explícitas |
| Setup | Campos reais por pneus/aero/chassi/amortecedores/freios/power, atual/ideal, explicação; distingue controle, resultado e leitura | Melhorar apresentação dos parâmetros já capturados |
| Telemetria | Seleção de qualquer volta, referência própria/ideal/outra sessão; mapa colorido; traces sincronizados; setores; replay | Exploração de sessão inteira e comparação consigo mesmo |
| Híbrido | Ferrari 499P mostrou torque MGU-K e bateria no cursor | Canais específicos por carro, sem campos vazios genéricos |
| Engenheiro | Análise paga em três níveis e chat; achados e setup gerados juntos; marcações no mapa anunciadas | Explicação sobre achados estruturados e plano A/B |
| Estratégia | Duração, carro/pista, horários local/servidor, tanque/consumo/reserva, pit/vazão/pneus, até cinco pilotos | Planejador determinístico de endurance |
| Clima | Upload da imagem de previsão, leitura anunciada por IA, limiares de risco/molhado e ritmo na chuva | Cenários de estratégia; OCR opcional com revisão |
| Equipe | Convites por conta, ritmo por contexto e escala de pilotos | Somente após autenticação e permissões multiusuário |
| Setups | Cofre .sto, equipe, comparação, histórico e glossário | Histórico de ajustes e associação setup–saída |
| Comunidade | Melhores voltas, agrupamentos, equipe/seguindo, condições similares e permissões por tipo de dado | Comparabilidade privada primeiro; compartilhamento opt-in |
| Pit Wall | Transmissão da equipe e histórico anunciado; sem corrida disponível | Frente futura dependente de coletor ao vivo |
| Debrief | Importação de resultado CSV e analista anunciado; evento indisponível | Entrada manual transitória para resultado oficial |

## Exemplos concretos e cuidados com interpretação

Na Ferrari 296/Motegi, o app informou melhor 1:50.303, média limpa 1:50.557 e consistência 0.211 s. A volta ideal por setores era 1:50.018. O resumo destacou Curva 6 (+0.14 s), 2 (+0.09 s) e 3 (+0.09 s), avisando que melhores passagens de curvas diferentes não compõem necessariamente uma volta realizável. Esse aviso merece ser preservado.

O off-track da volta 1 e o incidente 1x apareceram no mesmo trecho, ambos com +0.954 s. São duas observações de um evento potencialmente comum: somar os custos duplicaria a perda. Impactos de roda em outras curvas foram marcados sem perda; isso é melhor que tratar todo uso de zebra como erro.

A UI define sobresterço como rotação maior que 2.5 vezes a exigida por pelo menos 0.1 s, contato do assoalho por altura inferior a 3 mm, off-track por pelo menos 0.15 s e impacto pela velocidade do amortecedor maior que duas vezes o normal da curva. São regras declaradas, sem validação física independente. Thresholds devem considerar carro, velocidade, superfície, canais e confiança; não importar números como verdade universal.

O resumo mostrava 0.53% de sobresterço, mas nenhum evento detectado. Isso pode ser proporção de amostras versus episódios sustentados; o app não esclareceu suficientemente a relação. Nossos rótulos precisam separar tempo acima do limiar, episódios e severidade.

Nos pneus, o app diferenciou medição contínua de superfície/pressão de carcaça/desgaste no box e explicou a necessidade de gravação posterior. Essa proveniência é valiosa. No Setup, valores de última leitura ainda estavam em 35 °C e 100% de borracha: não usar valores iniciais como diagnóstico pós-stint.

Na Ferrari 296, a tendência corrigida informou +0.056 s por volta e faixa de 95% +0.030 a +0.082 com coeficiente 0.03 s/kg. Isso depende do coeficiente, seleção de voltas e condições, e não demonstra que o pneu causou toda a tendência. Na Ferrari 499P mista faltava amostra suficiente: o app pediu mais voltas após aquecimento, embora o cabeçalho mostrasse consumo e o gráfico dissesse sem consumo medido nesta saída. Contextos de agregação precisam ser explícitos.

Outra inconsistência na Ferrari 499P: V11 tinha tempo total 1:29.472, mas S3 79.954 s junto com S1 20.684 e S2 39.485, incompatíveis com o total. Além disso, os setores da volta ideal somavam 88.995 s, mas os ganhos exibidos contra V9 não fechavam integralmente o gap total. Tratar como anomalia observada, sem afirmar causa interna. Exigir integridade temporal antes de usar setores para coaching.

## Comparação com a base documentada do projeto

PROJECT_CONTEXT.md descreve parsing local de .ibt para extrair uma volta de referência, gráficos sincronizados, GPS, comparação por curva/sequência, consistência entre voltas, microcorreções e Setup Lab com parâmetros do Garage61. Portanto, mapa, curva a curva e comparação de parâmetros são evolução de base existente, não módulos totalmente novos.

O salto é preservar uma sessão/saída com várias voltas e canais especializados em vez de reduzir todo .ibt à melhor volta. O projeto também registra limites de Storage e download e ausência de telemetria em algumas corridas: cobertura e proveniência devem ser tratadas antes de ampliar a UI.

Practice e Qualifying são úteis para preparação. Nunca entram em contagens, explicações ou matching de evolução de iRating: manter session_type = 3 e associação um-para-um por categoria. Classe não determina série; layouts e versões precisam de identidade própria.

## Prioridades propostas

| Ordem | Entrega | Dependência/critério de aceite |
|---|---|---|
| 1 | Sessão com todas as voltas e volta ideal | Separar evento/sessão/saída/stint; validar soma de setores, voltas completas e elegibilidade; identificar origem dos melhores setores |
| 2 | Ocorrências no mapa e linha do tempo | Preservar flags e canais disponíveis; agrupar eventos coincidentes; custo descritivo sem dupla contagem; fallback sem GPS |
| 3 | Comparação própria e condições | Volta escolhida × melhor, ideal e outra saída; combustível/clima/setup visíveis; aviso de incompatibilidade |
| 4 | Combustível e pneus | Preservar canais por roda e medições no box; ausência diferente de zero; unidade e momento da medição explícitos |
| 5 | Degradação por stint | Amostra mínima, aquecimento, condições estáveis, sensibilidade a s/kg, intervalo e diagnóstico de ajuste; chamar tendência corrigida quando causalidade não é identificável |
| 6 | Setup associado à saída | Capturar snapshot válido, diferenciar controle/resultado/leitura, comparação A/B com evidência; não regravar .sto sem encoder validado |
| 7 | Importação de resultado CSV | Validar schema/identidade/posição de classe, deduplicar, manter fonte oficial e origem manual; caminho transitório à Data API |
| 8 | Coletor Windows opcional | Reutilizar Garage61; detectar arquivos fechados, processamento idempotente, consentimento, autenticação local, atualização e limites de disco |
| 9 | Estratégia determinística | Medições reais de consumo/ritmo e cenários; arredondamento de voltas, reserva, duração mínima e custo do pit validados |
| 10 | IA, equipe e Pit Wall | IA sobre evidência calculada e cache; equipe com isolamento; live timing exige fonte ao vivo e contrato específico |

Primeira entrega recomendada: um debrief de sessão com seleção de volta, ideal auditável, três oportunidades de repetição e ocorrências sincronizadas. Evita iniciar de uma vez agente, cobrança, comunidade e live timing.

## Arquitetura recomendada para dados adicionais

1. Manter Garage61 como fonte existente e adicionar importação local explícita de IBT como fonte complementar.
2. Estender o parser para metadados, várias voltas e canais presentes; processamento pesado em worker, limite de memória e cancelamento. Não enviar IBT bruto por padrão.
3. Produzir resumo versionado e séries reduzidas; upload privado seletivo apenas do necessário. Preservar unidades, frequência, validade e origem por canal.
4. Associar fontes pelo identificador oficial quando disponível, carro/layout, tipo e tempo; casos ambíguos ficam sem ligação automática. Deduplicação por identidade/hash e reprocessamento por versão; não alterar o sync incremental para fazer backfill completo.
5. Modelar o instante da medição de pneus e o vínculo entre gravações da mesma saída/jogo. Número da volta sozinho não identifica stint nem idade do pneu.
6. Calcular métricas determinísticas e testes de integridade antes da narrativa. Custo do trecho é associação contra baseline compatível, não prova causal do incidente.
7. Respeitar os tetos atuais de Storage/download e cache por volta. Listagens usam resumos, não downloads de séries. Raw e setups comerciais permanecem privados.
8. Para futuro agente: acesso local autenticado e origem permitida, vínculo revogável, sem segredos em URLs/logs, sem serviço localhost acessível indiscriminadamente. Projeto separado de coleta, com escopo mínimo.

## UX e qualidade a aproveitar

O Histórico de setups foi observado funcionando na conta gratuita: Ferrari 296 mostrou Practice, Qualify com mesmo setup e Race com uma mudança. A tela informa excluir temperaturas e pressões quentes do diff, uma boa separação entre ajuste e resultado medido. A comparação dedicada entre setups permaneceu bloqueada.

- Cada achado leva à curva e ao canal que o sustenta; a evidência acompanha a recomendação.
- Mostrar valor, unidade, referência, confiança e motivo de indisponibilidade no próprio contexto.
- Glossário de setup distingue o que o piloto muda do que o garage calcula.
- Separar o cálculo gratuito/determinístico da interpretação opcional por IA; manter utilidade mesmo sem IA.
- Catálogo agrupa carro/layout e saídas, reduzindo esforço de busca.
- Melhorar densidade com revelação progressiva: a tabela extensa de chassi/setup é útil para consulta, mas não deve competir com três ações prioritárias.
- Documentação de privacidade, créditos e disponibilidade deve corresponder ao comportamento real. A tela de comparação dizia Pro, enquanto o plano Básico anunciava Setup Compare; o plano também mostrava texto sobre crédito sem assinatura e prazo de expiração. Evitar contratos ambíguos.

## Verificações obrigatórias na implementação futura

IBTs reais de treino, qualify e race; seco/misto/molhado; pit/tow/reentrada; fim incompleto; troca de pneu e combustível; arquivos sem volta; categorias com canais diferentes; repetição da importação; metadados conflitantes; ausência de GPS. Validar soma dos setores versus lap time, gaps totais, unidade de combustível e sincronização por distância. Reexecutar sync sem duplicar registros. Testes e build na integração final; mudanças de schema somente após inspeção do schema real.

## Limites e próximo passo

Este relatório é estudo e proposta, sem implementação, publicação ou alteração de roadmap aprovado. Nenhuma funcionalidade foi acrescentada ao app de produção. Não foi possível ver resultados de IA, corrida ao vivo, comparação Pro ou debrief importado; não afirmar qualidade desses resultados.

Próximo passo: confirmar no código os contratos de telemetry-trace, race-debrief e self-consistency; escolher a primeira fatia (sessão completa + ideal auditável) e medir os canais de um IBT real antes de estimar esforço. Não copiar interface, textos proprietários ou limiares sem fundamentação.
