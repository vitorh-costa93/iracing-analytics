# Prova de coleta pelo aplicativo iRacing

08/10/2026. Teste de viabilidade, sem implementação ou ingestão no banco.

## Resultado comprovado
- Aplicativo Windows iRacingUI.exe já aberto e autenticado.
- Caminho: Racing → Results & Stats → Results Archive → Results da corrida → menu de download → CSV/JSON.
- Lista mostrou últimos 30 dias, 62 resultados paginados de 10 em 10, incluindo Practice e Race. Filtrar corridas explicitamente.
- Corrida testada: GT3 Challenge Fixed, Motegi, subsessão 89199619, 07/10/2026.
- CSV baixado e lido; cópia preservada em Downloads como eventresult-89199619-teste.csv. JSON salvo como eventresult-89199619.json, 399453 bytes. Arquivos privados locais; não versionar payloads com participantes.
- JSON tem envelope type=event_result e data, identificadores oficiais, série/season/pista, clima, splits e session_results. Nesta amostra: 20 participantes em cada resultado de Practice, Qualify e Race.
- Dados do piloto conferidos com UI: 11 voltas, 1 incidente, iRating 3370 → 3421 (+51), P5.
- finish_position e finish_position_in_class são 4 para P5 nesta amostra: indexação zero; confirmar contrato antes de normalizar.
- simsession_type usa 3=Practice, 4=Qualify e 6=Race nesta exportação. NÃO confundir com session_type interno do projeto, onde Race=3. Adaptador obrigatório.
- CSV contém IDs de carro/classe/piloto, classificação, tempos, incidentes e ratings. JSON preserva finish_position_in_class e identificação da subsessão; preferível como entrada do futuro adaptador.

## Limites do teste
- Controle visual exigiu ativar a janela e navegar; não foi demonstrada operação minimizada, oculta ou durante jogo.
- Árvore de acessibilidade do app expôs apenas contêineres, sem os controles de resultados; neste teste a interação foi por coordenadas de screenshots.
- JSON abriu diálogo de Salvar; CSV deixou conteúdo em arquivo temporário e notificou Successful Download. O agente precisa esperar conclusão e validar identidade/conteúdo, sem presumir nome final ou usar qualquer .tmp da pasta.
- Nenhum cookie, token, credencial ou API interna foi extraído. Nenhuma chamada não documentada foi feita.
- Nenhum resultado foi enviado ao Supabase, nenhum código de produto mudou, nenhum build/publicação foi necessário.

## Decisão proposta

## Ingestão real autorizada — 08/10/2026
- JSON oficial de Motegi importado por SQL no projeto Supabase iracing-analytics, tabela race_results, sem consulta ao iRStats.
- A subsessão 89199619 já existia; identidade da linha preservada por conflito na chave existente irstats_race_id (nesta corrida igual ao subsession_id oficial). Não generalizar equivalência sem validar outras amostras.
- Resultado, piloto, data, carro/layout, P5, 11 voltas, 1x, pontos 146, SoF 3092, SR A 2.44 e delta +51 conferidos antes da escrita. IDs oficiais de carro/pista não são os IDs do catálogo Garage61: mapeamento local confirmado 155/136.
- Único dado funcional acrescentado: race_fastest_lap_time passou de null para 1:49.396. Melhor pessoal 1:50.303; melhor da classe e do vencedor mantidas em 1:49.396. imported_at atualizado; apresentação arredondada do iRating preservada.
- Reapresentação do mesmo resultado não inseriu duplicata; contagem e view consumidora verificadas. Não foi reexecutado sync Garage61, pois não foi alterado.
- Esta é ingestão pontual administrativa. Nenhum endpoint/agente recorrente foi implementado, nenhuma fonte de proveniência foi acrescentada ao schema e o sync antigo ainda pode reescrever a linha. Eliminar a dependência do iRStats requer adaptador validado, preservação da fonte oficial e proteção contra sobrescrita.
- Não inserir novo anchor de rating só por esta corrida: histórico/view precisam de decisão própria para não distorcer a reconstrução.
Exportação de resultado oficial pela sessão autenticada do aplicativo é viável. Automação inteiramente em segundo plano continua pendente. A arquitetura pode separar coletor IBT automático de adaptador de resultado JSON, usando subsession_id para deduplicação e identidade, sem matching só por horário.

Próxima prova: automatizar exportação de um resultado com a UI fora do primeiro plano, sem tomar foco/teclado, por mecanismo suportado. Se isso não funcionar, oferecer coleta pós-jogo em momento ocioso ou observação de exportações feitas pelo usuário; não prometer background com base no teste visual.
