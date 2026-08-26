# iRacing Analytics Sync Bridge

Esta extensão local faz a ponte que uma página web não pode fazer: ao clicar em **Atualizar dados**, ela abre Garage61 e iRStats, executa os importadores dentro de cada domínio e fecha as abas ao terminar.

## Instalação local

1. Abra `chrome://extensions` no Google Chrome.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta `chrome-extension`.
4. No primeiro sync, informe as chaves que os importadores pedirem. Elas ficam somente no `localStorage` dos respectivos sites, nunca na extensão ou no repositório.

Sem a extensão, o painel ainda abre a página do iRStats por navegação nativa, mas o navegador não permite que ele execute JavaScript dentro desse outro domínio.
