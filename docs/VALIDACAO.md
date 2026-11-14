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

## Desempenho da unidade — 0.3.0-beta.3 (3 de novembro de 2026)

Executado no Windows x64 do usuário, com o Node 25.6.1 do sistema em vez do 24.22.1 fixado. Detalhes e números em [DESEMPENHO.md](DESEMPENHO.md).

- Medição somente leitura de `G:` (0.3.0-beta.2 instalada, Google real): `Meu Drive` levou 8,3 s na primeira abertura e 9 ms na segunda; `Compartilhados comigo` (1171 itens) levou 13,5 s.
- Rótulo do Explorador: `_LabelFromReg` em `MountPoints2\##server#<volume>` mudou o nome exibido de `GCP-Drive · CliqueProjetos (\server) (G:)` para `GCP-Drive · CliqueProjetos (G:)`. A consulta foi feita pelo namespace do Shell. `DriveIcons\<letra>\DefaultLabel` não teve efeito em unidade de rede e foi removido.
- `rclone lsjson` sobre `G:\Meu Drive` e `G:\Compartilhados comigo` em cache levou cerca de 0,45–0,7 s, com os mesmos nomes, tamanhos e datas.
- `tsc --noEmit` e 31 testes de fonte passaram, incluindo os parâmetros por provedor/sistema e a detecção de atividade do motor.
- `scripts/mount-smoke.mjs` (WinFsp real, origem local): 5 de 5 execuções passaram depois da espera por volume visível. Antes dessa correção, 1 de 3 execuções falhou com `ENOENT`. O ensaio agora inclui a listagem do painel pelo volume (200 itens). Comparação com a beta.2 em DESEMPENHO.md.
- `npm run build`, `scripts/smoke.mjs`, `scripts/engine-smoke.mjs` e `scripts/disconnect-smoke.mjs` passaram.

Não executado: a nova versão montando contas reais, a remontagem após ejetar/desconectar no Explorador, Dolphin ou Finder, a remoção do atalho de navegação em uma instalação existente, a animação da bandeja com transferências reais, Linux e macOS.

## Indicadores de estado — 0.3.0-beta.4 (3 de novembro de 2026)

- `tsc --noEmit` e 33 testes de fonte passaram. Os testes cobrem o cálculo de estado, a leitura incremental, o caso "ausente só vale como nuvem depois de leitura completa", os nomes codificados no Windows e o manifesto da extensão Linux.
- A leitura somente leitura do cache real da conta Google em `G:` levou 85 ms: 49 metadados, 47 locais e 1 parcial. Um lock do Office com `"Rs": null` revelou um formato não previsto; ele passou a ser tratado como "somente na nuvem" e ganhou teste.
- `npm run build`, `scripts/smoke.mjs`, `scripts/disconnect-smoke.mjs` e `scripts/mount-smoke.mjs` passaram. A sintaxe da extensão Python foi verificada com `ast.parse`.

Não executado: Nautilus e Nemo reais (sem Linux gráfico nesta máquina), temas sem os emblemas usados, os estados no painel com a conta real e macOS.

## Streaming e estabilidade — 0.3.0-beta.5 (7 de novembro de 2026)

- BigLinux (base Manjaro, KDE, kernel 6.18.55), Node 24.22.1, npm 11.16.0 e rclone 1.75.2. Sete montagens Google já ativas foram consultadas somente para leitura, em duas passadas por raiz, Meu Drive e Compartilhados comigo. As 42 listagens retornaram em 3–47 ms. O KDE KIO retornou a listagem de uma pasta compartilhada em 247 ms e 112 ms. Essas medidas incluem cache já existente e não reproduzem abertura a frio, miniaturas nem a interface do Dolphin.
- `GCP_MOUNT_SMOKE_KIO=1 node scripts/mount-smoke.mjs` passou com FUSE real, configuração e cache descartáveis e origem local. Listagem de 200 entradas em 4,11/2,20 ms (primeira/repetida) e leitura de 4 MiB em 24,93/17,23 ms. Passaram leitura, gravação, cópia via KDE KIO, conferência dos bytes na origem, atualização de diretório pelo RC e desmontagem.
- `npm run test:engine` e `npm run test:sync` passaram com rclone real e arquivos locais. `npm run test:desktop` passou em perfil isolado no KDE.
- `npm run test:disconnect` passou em perfil isolado no KDE, com rclone e alias local. Listagem, renomeação, favorito e desconexão preservaram o arquivo de origem. O ensaio também exercitou o ícone genérico em caso de falha do ícone nativo.
- Sonda RC em montagem FUSE isolada observou uma leitura de 1 MiB em andamento e a conclusão em RFC 3339 com deslocamento `-03:00`. Uma cópia local isolada via RC também confirmou o formato. O parser de Atividade agora aceita esse formato.
- `npm run typecheck`, `npm test` (36 testes) e `npm run build` passaram com a cadeia de ferramentas fixada.

## Seleção de pastas locais

- No BigLinux, `npm run typecheck`, `npm test` (36 testes) e `npm run build` passaram. `npm run test:sync` verificou com rclone e pastas locais a prévia sem cópia, a sincronização nos dois sentidos, a edição e a preservação de versões concorrentes.
- O pacote local Arch/Manjaro x86_64 da beta.6 foi gerado com makepkg. A validação do arquivo desktop, do modo do sandbox, do executável rclone, dos metadados do pacote e do SHA-256 passou.

- Na beta.7, a verificação de tipos, os 36 testes e a compilação passaram. O pacote Arch/Manjaro passou na conferência dos metadados, das permissões do sandbox e do rclone, do arquivo desktop e do SHA-256.

## Motor nativo FUSE — 0.5.0 (13 de novembro de 2026)

Executado no BigLinux (base Manjaro, KDE, kernel 6.18.55), Go 1.27.4. Código em [native/](../native/README.md).

Medido na 0.4.3 instalada, com contas Google reais e somente leitura: um arquivo de 4,4 MB levou 9,0 s na primeira leitura e 5,0 s na segunda; os primeiros 4 KiB de seis arquivos levaram 14,9 s em sequência; oito pastas ainda não visitadas levaram 2,3 s em sequência e 0,35 s em paralelo; pastas já visitadas responderam em 4–54 ms. O histórico do serviço registrava 26 leituras canceladas em três contas.

Executado na 0.5.0:

- `go vet ./...` sem avisos. `go test -race -count=2 ./...` passou. O teste monta uma unidade FUSE real contra um Google Drive simulado em memória e cobre: listagem da raiz e de `Meu Drive`, atalho `.desktop` de documento Google, leitura de um arquivo de 5 blocos em no máximo 4 requisições, releitura após remontagem sem nenhuma requisição, criação e envio de arquivo, salvar por temporário + renomear como revisão do mesmo item, edição no lugar, arquivo de trava mantido local, criação de pasta, mover, excluir para a lixeira e remoção de pasta vazia.
- As sete páginas da interface foram renderizadas com dados de exemplo em janela fora da tela, sem exceções, e conferidas por captura.
- `package.sh` gerou `.pkg.tar.zst`, `.deb` e `.rpm`. Conferidos: lista de arquivos, dono `root`, permissões dos executáveis, dependências declaradas e SHA-256.

Não executado: o motor 0.5.0 contra contas Google reais (leitura, gravação, mapa completo, limites de banda, conflito de versões), instalação dos pacotes, atualização a partir da 0.4.3, Dolphin/Nautilus/Nemo com a unidade nova, bandeja, login OAuth, Debian/Ubuntu e Fedora. O Drive simulado não reproduz latência, cota nem erros do Google. Não há versão para Windows ou macOS deste motor.
