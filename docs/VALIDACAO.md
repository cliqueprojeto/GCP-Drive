# Validação inicial — 1 de novembro de 2026

Executado no Windows x64. Nenhuma conta de produção foi conectada ou alterada. Nenhum instalador ou extensão de sistema foi instalado.

## Executado

- `tsc --noEmit`: passou.
- `node scripts/build.mjs`: passou; renderer e main/preload compilados.
- Onze testes Node: caminhos, separação do cache, parsing de listagens, observações desconhecidas, nomes/identidades compartilhados, idiomas, índice SQLite, invalidação de descendentes e contrato de autostart. Passaram.
- `node scripts/smoke.mjs`: passou com Electron real em perfil temporário. Abriu tela inicial, verificou detecção de rclone, abriu conexão gráfica sem autenticar, percorreu preferências e três idiomas, salvou preferências. `require` indisponível no renderer, sem erros de página observados.
- rclone 1.75.2 Windows x64: arquivo oficial conferido contra SHA256SUMS. SHA-256 do ZIP: `8a9db2bad1dc79a65b3348fd857069598e2aab7cf4d118b77b1df23055aff818`.
- Teste isolado da criação de config rclone criptografada com `config encryption set --password-command`; o helper recebe a senha no ambiente e não a grava no repositório.
- `node scripts/engine-smoke.mjs`: rclone real com fixtures locais e configuração criptografada. Criação de aliases, raiz `combine` com Meu Drive/Drives compartilhados e leitura de nome com acento passaram. Não usa APIs cloud, OAuth ou montagem.
- Empacotamento Windows `electron-builder --win --dir --publish never`: passou após correção do contrato do hook `beforePack`. Gerou app unpacked local com rclone e recursos; sem assinatura e sem instalar no sistema.
- [GitHub Actions — commit 5d6d6be](https://github.com/cliqueprojeto/GCP-Drive/actions/runs/41276156011): instalação das dependências, tipos, onze testes e build passaram em Windows, Ubuntu e macOS. São verificações de código; não são homologação de montagem, login ou integração gráfica nesses sistemas.

Capturas e perfis de teste são locais e ignorados. Testes com fixture local não demonstram funcionamento real de Google, Microsoft ou Dropbox.

## Correções da versão 0.2.0-beta.1

O usuário testou a 0.1.0 no Windows e relatou autorização Google concluída no navegador, perguntas em inglês, ausência de unidade no Explorer, impossibilidade de cancelar/sair durante login e falta de desconexão. Essas são observações do usuário, não reprodução completa realizada pelo agente.

Achados de origem: o término do login não solicitava montagem; o Windows recebia uma pasta de montagem em vez de uma letra; não havia WinFsp nos caminhos/registro examinados; a fila global não permitia cancelamento; a saída interpretava `vfs/stats.inUse` como arquivos abertos, embora o VFS inicialize essa referência com 1. As perguntas e a página de retorno usavam textos do motor sem uma fronteira de apresentação traduzida.

Executado após as correções:

- Tipos e 21 testes de fonte passaram no Windows, incluindo encerramento de comandos pertencentes ao app, cancelamento antes/depois de iniciar, limite de saída, prazo, resultados mistos, reabertura após fechamento, estados desconhecidos e pausas até finalizar a operação.
- `scripts/auth-smoke.mjs`: Electron e rclone reais com perfil isolado. A pergunta `config_shared_client_id` apareceu traduzida; cancelar, repetir a conexão e sair enquanto uma conexão aguarda confirmação passaram. Nenhum OAuth de conta real foi concluído nesse teste.
- `scripts/disconnect-smoke.mjs`: Electron, cofre e rclone reais com um alias de pastas locais. Navegação, confirmação de desconexão, remoção da configuração, persistência e preservação do arquivo original passaram. Esse teste não usa Dropbox real.
- `scripts/sync-smoke.mjs`: bisync real com pastas locais. Prévia sem cópia, cópia nos dois sentidos, edição e preservação das duas versões concorrentes passaram. Não comprova comportamento de provedores cloud.
- Consulta nativa de letras ocupadas no Windows identificou C:, I:, J:, L: e M:; WinFsp não foi encontrado. A seleção de letra respeita unidades ocupadas e preferência salva; montagem física ainda depende do driver.
- WinFsp 2.1.25156 baixado do release oficial, SHA-256 `073a70e00f77423e34bed98b86e600def93393ba5822204fac57a29324db9f7a`, assinatura Authenticode `Valid`, fornecedor `NAVIMATICS LLC`. Nenhum driver foi instalado pelo agente. A aplicação solicita aprovação no instalador nativo.

Uma tentativa de diagnóstico externo das contas foi interrompida pela vinculação do cofre ao perfil seguro. Nenhuma listagem cloud foi obtida nessa tentativa; não houve alteração de arquivos remotos. Não contornar a proteção nem apresentar esse diagnóstico como verificação real das contas.

## Revisão das permissões — 0.2.0-beta.2

A montagem agora solicita arquivos `0600` e diretórios `0700`, sem `--allow-other`. Isso evita adotar os padrões de acesso geral do WinFsp descritos na [documentação de montagem](https://rclone.org/commands/rclone_mount/#windows-filesystem-permissions). A construção dos argumentos foi verificada; a ACL efetiva e os programas externos ainda exigem homologação depois da instalação do driver. Os pacotes beta.1 foram gerados para verificar o processo de empacotamento; preferir beta.2 para testes com dados.

## Não executado

Login OAuth dos três provedores, token refresh, montagem WinFsp/FUSE, edição e salvar como por aplicativos externos, compartilhados reais, recuperação de upload, coexistência multicliente, encerramento com gravações, animação com transferências reais, Linux, macOS, indexadores nativos, menus de contexto e instaladores. A presença de configuração/código para esses itens não constitui aprovação para produção.
