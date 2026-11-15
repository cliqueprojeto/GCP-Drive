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

Ensaio somente leitura com as cinco contas Google reais, autorizado pelo usuário, em pasta de montagem, dados e cache separados do cliente instalado (`GCP_DRIVE_READONLY=1`). Linha medida em 29,6 Mbit/s (10 MB de um CDN).

| Cenário | 0.4.3 instalada | 0.5.0 |
|---|---:|---:|
| Mapa completo das 5 contas (289.824 itens) | não tem | 367 s, uma vez |
| Pasta nunca visitada, com o mapa pronto | ~290 ms | ~5 ms |
| Árvore de `Meu Drive` (20.377 entradas, só nomes) | não medido | 0,98 s |
| Primeiros 4 KiB de 6 arquivos nunca abertos, em sequência | 14,9 s | 4,9 s |
| Idem, 6 arquivos em paralelo | não medido | 2,8 s |
| Os mesmos 12 arquivos, de novo | não medido | 21 ms |
| Arquivo de 4,4 MB, segunda leitura | 5,0 s | 4 ms |
| Arquivo de 34 MiB, primeira leitura | não medido | 14,7 s (19 Mbit/s) |
| Arquivo de 34 MiB, segunda leitura | não medido | 5 ms |

O MD5 do arquivo de 4,4 MB lido pelos dois clientes coincidiu. Uma tentativa de criar arquivo foi recusada com "somente leitura". Nenhuma falha de leitura foi registrada. "Compartilhados comigo" listou 0/1204/31/285/350 itens contra 0/1148/28/254/329 do cliente instalado; a 0.5.0 mostra com sufixo ` (2)` os nomes duplicados que a 0.4.3 omite. O serviço ocupou cerca de 410 MB de memória com os 290 mil itens mapeados.

O ensaio real levou a três mudanças: blocos de 256 KiB em vez de 1 MiB (com 1 MiB, inspecionar o começo de um arquivo custava 2,3 s nesta linha), resolução de atalhos uma vez por pasta e a regra de "Compartilhados comigo" pelo campo `sharedWithMeTime`.

A primeira abertura de cada arquivo ainda custa cerca de 0,8 s de espera do Google Drive; o cache só elimina isso da segunda vez em diante.

Ensaio de gravação em conta Google real, autorizado pelo usuário, restrito a uma pasta nova `Teste GCP-Drive 0.5` em `Meu Drive`, com a mesma montagem isolada: criar pasta, criar arquivo, salvar por temporário + renomear, acrescentar linha, criar arquivo de trava, enviar 20 MB aleatórios, criar subpasta, mover e renomear. Todos os envios terminaram como concluídos e a fila ficou vazia. Conferência independente pelo cliente 0.4.3 instalado: a pasta continha um único `nota.txt` com as duas linhas esperadas, sem o temporário e sem o arquivo de trava, e o arquivo de 20 MB tinha o mesmo MD5 do original. Em seguida os itens e a pasta foram removidos pela unidade e ficaram na lixeira do Drive.

Instalação: o usuário instalou `gcp-drive-0.5.0-1-x86_64.pkg.tar.zst` com `pacman -U` sobre a 0.4.3. O serviço antigo só encerrou com SIGKILL do systemd, e o novo, iniciado enquanto as pastas ainda estavam presas, ficou com o erro de montagem até ser reiniciado. Depois do reinício as cinco contas montaram em `~/GCP-Drive` sem novo login e `Meu Drive` listou 201 itens em 7 ms. A revisão 0.5.0-2 passa a repetir a montagem a cada 10 s e a interface reinicia o serviço que tenha parado; essas duas mudanças passaram em `go vet` e `go test -race`, mas não foram exercitadas numa atualização real. O usuário relatou uso fluido da 0.5.0-1 instalada.

Não executado: conflito de versões e falha de rede durante envio em conta real, limites de banda com tráfego real, edição por LibreOffice ou outro programa gráfico, instalação dos pacotes `.deb` e `.rpm`, atualização a partir da 0.4.3, Dolphin/Nautilus/Nemo com a unidade nova, bandeja, login OAuth, Debian/Ubuntu e Fedora. O Drive simulado não reproduz latência, cota nem erros do Google. Não há versão para Windows ou macOS deste motor.

## Motor nativo para Windows — fase 1 e sonda da Cloud Filter API (13 de novembro de 2026)

Ainda não existe versão para Windows. O que foi feito é a preparação do código e uma sonda da API do sistema.

Executado no BigLinux, Go 1.27.4, depois de separar o código por sistema (`*_linux.go`, `*_windows.go`):

- `go vet ./...` sem avisos e `go test -race -count=2 ./...` aprovado no Linux, com o mesmo teste FUSE contra o Google Drive simulado descrito acima.
- `GOOS=windows go vet ./...`, `GOOS=windows go build` e a compilação dos testes para Windows concluíram sem erros. No Windows a pasta da conta ainda devolve "não faz parte desta compilação"; nada além da compilação foi verificado nesse binário.

Executado no GitHub Actions, runner `windows-latest` (Windows 10.0.26100, plataforma Cloud Files build 26100 revisão 33648, driver `cldflt` em execução), workflow `Native engine (Windows)`, execução 43548953459, com `native/cfapi` chamando `cldapi.dll` em Go puro, sem cgo:

- `CfRegisterSyncRoot` e `CfConnectSyncRoot` numa pasta temporária, com conteúdo servido da memória do teste (sem Google Drive, nem o simulado).
- Preenchimento de pastas sob demanda (`FETCH_PLACEHOLDERS`) para a raiz e uma subpasta, lidas por um segundo processo; uma pasta já preenchida não foi pedida de novo. O Windows não faz esse pedido quando quem lista é o próprio processo provedor.
- Leitura de 4 KiB de um arquivo de 1,3 MB pediu ao provedor dois trechos de 4 KiB, não o arquivo inteiro. A leitura completa conferiu byte a byte; a segunda leitura completa não gerou nenhum pedido.
- `CfDehydratePlaceholder` liberou o conteúdo e a leitura seguinte voltou a pedir os dados. `CfConvertToPlaceholder` e `CfSetInSyncState` funcionaram num arquivo criado dentro da pasta.

Três execuções anteriores da sonda falharam por erros do próprio teste (listagem feita pelo processo provedor; cancelamento normal de um pedido tratado como falha; progresso informado depois de o pedido terminar), corrigidos em seguida.

Não executado: qualquer coisa no Explorer (ícones de estado, painel de navegação, menus), registro pelo `StorageProviderSyncRootManager`, Windows 10, Windows em ARM, o motor (mapa, cache de blocos, fila de envio) atendendo um sync root, gravação, instalador, contas Google reais. O runner é um Windows Server sem sessão gráfica de usuário comum; o resultado não garante o mesmo comportamento no Windows 10/11 do usuário.

## Motor nativo para Windows — fase 2, pasta da conta somente leitura (14 de novembro de 2026)

Ainda não há instalador nem painel para Windows, e alterações feitas na pasta não são enviadas ao Drive.

Executado no GitHub Actions, runner `windows-latest` (Windows 10.0.26100), workflow `Native engine (Windows)`, execução 43565976823. O teste `TestEngineWindows` liga o motor (mapa, cache de blocos, cliente da API) a um sync root em pasta temporária contra o Google Drive simulado em memória, e lê a pasta por um segundo processo:

- Raiz com `Meu Drive`, `Compartilhados comigo` e `Drives compartilhados`; `Meu Drive` com a pasta e o documento Google como atalho `Planilha.url`, cujo conteúdo traz o endereço do documento. Nenhuma listagem baixou conteúdo.
- Os primeiros 4 KiB de um arquivo de 6 blocos custaram 1 requisição de conteúdo; a leitura completa conferiu byte a byte com 3 requisições no total.
- Depois de parar e religar o motor, a releitura conferiu sem nenhuma requisição.
- Alterações remotas entregues ao mapa foram escritas na pasta já exibida: arquivo novo apareceu e foi lido; arquivo editado remotamente passou a devolver o conteúdo novo; arquivo enviado à lixeira sumiu. O motor não registrou nenhuma falha.

Duas execuções anteriores falharam na parte das alterações remotas: o Windows informa o caminho da pasta como o programa o escreveu (com nomes curtos `RUNNER~1`), e o motor não o reconhecia. Corrigido.

No Linux, `go vet ./...` sem avisos e `go test -race -count=2 ./...` aprovado depois dessas mudanças. O teste FUSE precisou ser iniciado por `systemd-run --user`, porque o terminal usado na sessão não permitia `fusermount3`.

Não executado: Explorer (ícones, painel de navegação, progresso, cancelamento por interface), cancelamento de leitura em andamento, pastas grandes (o envio em lotes de 2.000 entradas não foi exercitado), `Compartilhados comigo` e drives compartilhados com conteúdo, o feed `changes.list` de verdade (as alterações foram injetadas direto no mapa), renomeação remota, falha de rede, serviço e socket de controle no Windows, limite de cache, Windows 10, ARM, contas Google reais. O conteúdo baixado fica no próprio arquivo e também no cache de blocos, até o limite configurado do cache; "Liberar espaço" ainda não existe.

## Motor nativo para Windows — fase 3, gravação na pasta da conta (14 de novembro de 2026)

Ainda não há instalador, painel nem integração com o Explorer para Windows.

Executado no GitHub Actions, runner `windows-latest` (Windows 10.0.26100), workflow `Native engine (Windows)`, execução 43597129791, uma única execução. O teste `TestEngineWindows` repete as verificações da fase 2 e, em seguida, altera a pasta por um segundo processo, contra o Google Drive simulado em memória:

- Arquivo novo criado na pasta chegou ao Drive simulado com o mesmo conteúdo e passou a constar como placeholder sincronizado (`CfGetPlaceholderInfo`), ainda legível.
- Salvar por arquivo temporário e renomear sobre um arquivo existente gerou nova revisão do mesmo item; o temporário não foi enviado.
- Edição no lugar de um arquivo já baixado gerou nova revisão do mesmo item, e o arquivo voltou ao estado sincronizado.
- Arquivo de trava de editor (`.~lock.…#`) não foi enviado.
- Pasta nova foi criada no Drive simulado; um arquivo movido e renomeado para dentro dela foi movido no Drive, sem cópia sob o nome antigo; arquivo e pasta apagados foram para a lixeira do Drive simulado.
- Uma renomeação feita no Drive apareceu na pasta e não foi devolvida ao Drive como renomeação local.
- Ao final a fila de envio estava vazia e o motor não registrou nenhuma falha.

O Drive simulado dos testes passou a guardar a data de modificação enviada junto com o conteúdo, como o Google Drive faz; antes devolvia a hora do envio.

No Linux, `go vet ./...` sem avisos e `go test -race -count=2 ./...` aprovado depois dessas mudanças (iniciado por `systemd-run --user`). A criação de pastas e o envio à lixeira passaram a usar funções comuns aos dois sistemas.

Não executado: conflito de versões (edição local e remota do mesmo arquivo) e o descarte da cópia local depois de o conflito ser salvo; alterações feitas com o serviço parado (o levantamento da pasta na partida roda no teste, mas sem nada a encontrar); arquivo mantido aberto por um programa durante a gravação; cópia de arquivo grande pelo Explorer; exclusão ou movimentação de pasta com conteúdo; itens sem permissão de edição, `Compartilhados comigo` e drives compartilhados; mover para fora da pasta da conta; estouro do buffer do vigia de alterações; falha de rede durante o envio; renomear ou mover antes de o envio terminar; Office, LibreOffice ou qualquer programa gráfico; ícones de estado no Explorer; Windows 10; contas Google reais. Não foi medido o custo de comparar pastas grandes: cada comparação consulta o estado de cada entrada da pasta. Cada arquivo em envio ocupa, até terminar, uma cópia temporária do seu tamanho na área de dados do aplicativo.

## Motor nativo para Windows — fase 4, Explorer, bandeja e painel (14 de novembro de 2026)

Ainda não há instalador para Windows. Nada desta fase foi visto numa área de trabalho do Windows: o runner não tem sessão gráfica de usuário, e as verificações abaixo são feitas por programa.

Executado no GitHub Actions, runner `windows-latest` (Windows 10.0.26100), workflow `Native engine (Windows)`, execução 43598293529, uma única execução. O teste `TestEngineWindows` repete as verificações das fases 2 e 3 e acrescenta, contra o Google Drive simulado em memória:

- A pasta da conta foi registrada pela classe `StorageProviderSyncRootManager` do Windows (chamada em Go puro, `native/cfapi/shell_windows.go`): a chave da conta apareceu em `HKLM\…\Explorer\SyncRootManager` com o nome de exibição contendo o e-mail, e todas as leituras e gravações das fases anteriores continuaram funcionando sobre esse registro.
- "Sempre manter neste dispositivo", aplicado por `CfSetPinState` como o Explorer faz: o arquivo foi baixado inteiro, passou a contar como seleção off-line e o cache de blocos descartou a cópia duplicada. "Liberar espaço" (`CfSetPinState` + `CfDehydratePlaceholder`): a seleção terminou, o conteúdo saiu do disco e a leitura seguinte conferiu byte a byte.
- Painel: o servidor local respondeu ao estado das contas com o token da janela, recusou (403) um token errado e entregou a página. O ícone da área de notificação foi criado e removido sem derrubar o processo.
- O motor não registrou nenhuma falha, inclusive nenhuma falha de integração com o Explorer.

Executado no BigLinux: a página do painel (`native/panel`) foi aberta num navegador com dados de exemplo servidos por um programa de teste, não pelo serviço; conferidos em tema escuro o cabeçalho com velocidades, os cartões de conta (estado, mapa, fila de envio, cache, off-line, uso no Google, envio em andamento, atividade recente) e os botões. `go vet ./...` sem avisos e `go test -race -count=2 ./...` aprovado no Linux depois dessas mudanças.

Não executado: a aparência no Explorer (entrada no painel de navegação, ícones de estado, itens "Sempre manter neste dispositivo" e "Liberar espaço" no menu); o ícone ao lado do relógio e seu menu; a janela do painel aberta pelo Microsoft Edge e a alternativa pelo navegador padrão; os botões do painel contra o serviço (adicionar conta, pausar, limpar cache, desconectar, salvar configurações); tema claro; início do serviço pelo atalho do aplicativo e o socket de controle no Windows; login OAuth no Windows; manter uma pasta inteira; liberação automática pelo Sensor de Armazenamento; Windows 10; contas Google reais. O ícone da bandeja é fixo, sem animação de atividade. O limite de cache vale só para os blocos de leitura; o espaço dos arquivos abertos é devolvido por "Liberar espaço" ou pelo Sensor de Armazenamento, não pelo aplicativo.

## Motor nativo para Windows — fase 5, instalador (14 de novembro de 2026)

O instalador foi gerado e exercitado no runner, mas não ficou disponível para download: o envio do arquivo como artefato do Actions foi recusado por cota de armazenamento de artefatos da conta esgotada (o repositório não tem nenhum artefato guardado). Nenhuma versão foi publicada.

Executado no GitHub Actions, runner `windows-latest` (Windows 10.0.26100), workflow `Native engine (Windows)`, execução 43599914249:

- `go vet` e os testes das fases anteriores aprovados. `TestEngineWindows` ganhou a retirada da conta do computador, que é o que desconectar e desinstalar fazem: as cópias do que está no Drive foram removidas, um arquivo que só existia no computador ficou na pasta como arquivo comum e legível, a pasta que o contém deixou de ser placeholder e o registro da conta no Explorer foi desfeito.
- O serviço foi compilado sem console (`-H=windowsgui`) e o NSIS gerou `GCP-Drive-0.5.0-instalador.exe` (SHA-256 `DCCCD392A78F1375027A979C6C532C075D595E27A54BEF83C61A81E16E0CC6D1`), sem cadastro do Google dentro.
- Instalação silenciosa por usuário: programa em `%LOCALAPPDATA%\Programs\GCP-Drive`, desinstalador, atalho no menu Iniciar, entrada em "Aplicativos instalados" e início com o Windows (`gcp-drive.exe daemon` na chave `Run` do usuário). Um `google-oauth.json` de teste colocado ao lado do instalador foi copiado para a instalação.
- O serviço instalado iniciou e respondeu a `status` pelo socket de controle. Instalar por cima com o serviço em execução encerrou o serviço e substituiu o programa; o serviço voltou a responder depois.
- Desinstalação silenciosa: serviço encerrado, programa, cadastro, atalho, início automático e entrada de aplicativos removidos, cache removido.

A execução anterior, 43599759255, falhou no teste do motor antes de chegar ao instalador: o atalho `.url` de um documento Google já aberto não era reconhecido como cópia do Drive e ficava na pasta depois da retirada da conta. Corrigido.

No Linux, `go vet ./...` sem avisos e `go test -race -count=2 ./...` aprovado depois dessas mudanças.

Não executado: o instalador com janelas (páginas, pergunta sobre remover contas, "Abrir o GCP-Drive" ao final); o aviso do SmartScreen para instalador sem assinatura digital; a desinstalação com contas conectadas pelo desinstalador (a retirada da conta foi testada pelo motor, não pelo instalador); início real no login do Windows; atualização com arquivos na fila de envio; Windows 10; instalação por um usuário sem direitos de administrador (o runner é administrador). O ícone do executável depende de `windres` no runner e não foi conferido.

## Cadastro no Google pelo painel e guia ilustrado (14 de novembro de 2026)

Executado no GitHub Actions, runner `windows-latest`, workflow `Native engine (Windows)`, execução 43601124193 (testes do motor e do instalador aprovados de novo; instalador `GCP-Drive-0.5.0-instalador.exe`, SHA-256 `3D24EDD0205394D0A7017011367196871082130AA6ECAC7B023A2323010DB66D`; o envio como artefato foi recusado outra vez pela cota da conta). No teste do painel: sem cadastro o servidor respondeu "ausente"; um arquivo de cliente do tipo errado foi recusado com a explicação; um arquivo de cliente "App para computador" de teste foi guardado junto das contas e passou a ser o cadastro usado; um endereço fora do console do Google foi recusado pelo botão de abrir páginas.

Executado no BigLinux: a página do guia (`native/panel/guia.html`) e o quadro "Cadastro no Google" do painel foram abertos num navegador com dados de exemplo, em tema escuro; conferidas as figuras dos passos 1 a 3 e a disposição do quadro.

Não executado: escolher um arquivo pelo botão do painel numa janela real; os botões do guia que abrem as páginas do Google; o percurso de criar o cadastro numa Conta do Google (os nomes das telas vieram da documentação pública do Google de 14 de novembro de 2026, não de uma conta); o login com um cadastro criado por esse guia e o aviso "O Google não verificou este app"; as figuras 4 a 7 e o tema claro.

Em 14 de novembro de 2026, com autorização do usuário, a execução 43602248834 do mesmo workflow repetiu os testes e anexou `GCP-Drive-0.5.0-instalador.exe` (2.888.893 bytes, SHA-256 `FF1EA27985A72C8C22BC405713F8CF920C65F59339BD6505A581C35BE80A445D`) a um rascunho de versão não publicado, `windows-teste`. É um instalador de teste: nada nele foi homologado numa área de trabalho do Windows.

Em 14 de novembro de 2026 o guia ganhou os passos 7 a 9, redesenhados a partir de três capturas do login enviadas pelo autor (aviso de app não verificado, confirmação da conta e caixa de acesso ao Drive), sem os e-mails e nomes que elas mostravam; as capturas não foram versionadas. As três figuras novas foram conferidas num navegador no BigLinux, em tema escuro. Essa mudança é só de página e figuras e não passou por nova execução no runner Windows; `GOOS=windows go vet ./...` concluiu sem avisos.

Ainda em 14 de novembro de 2026, a pedido do usuário, a execução 43628621523 do mesmo workflow, sobre o commit `3d90262` (já com os passos 7 a 9 do guia), repetiu com aprovação a análise estática, os testes do motor e o teste de instalar, atualizar e desinstalar, e substituiu o arquivo do rascunho não publicado `windows-teste` por um novo `GCP-Drive-0.5.0-instalador.exe` (2.889.514 bytes, SHA-256 `455888F89B74C8389F75BA864B8EDB6F91BFD2C4C3AB76F70C414D2A8ECC0DDE`). Continua sendo um instalador de teste: nada nele foi homologado numa área de trabalho do Windows, e o guia dentro dele não foi aberto no Windows.

## Publicação da 0.5.0 sem cadastro embutido (14 de novembro de 2026)

Executado no BigLinux, antes de abrir o repositório:

- Busca em todo o histórico do Git (todos os ramos e etiquetas) por segredos de cliente do Google, identificadores de cliente, tokens de acesso e de atualização, tokens do GitHub, chaves privadas e arquivos de conta: nada encontrado. Os únicos endereços de e-mail no histórico são o do autor, o de contato da Gestão Cultural Pro e endereços de exemplo.
- `go vet ./...`, `GOOS=windows go vet ./...` e `go test -race ./...` (unidade FUSE temporária contra o Drive simulado): aprovados.
- Comando novo `gcp-drive registration [arquivo]`, num perfil isolado: um arquivo de cliente do tipo errado e um arquivo inexistente foram recusados com explicação; um arquivo de cliente "App para computador" de teste foi guardado com permissão só do usuário.
- `native/package.sh` sem `GCP_DRIVE_OAUTH_FILE` gerou `gcp-drive-0.5.0-3-x86_64.pkg.tar.zst`, `gcp-drive_0.5.0-3_amd64.deb` e `gcp-drive-0.5.0-3.x86_64.rpm`. A lista de arquivos dos três foi conferida: nenhum traz `google-oauth.json`; o conteúdo extraído do pacote foi varrido por segredos e identificadores de cliente do Google, sem achados.
- As imagens `docs/images/painel-windows-exemplo.png` e `docs/images/guia-cadastro.png` foram capturadas das páginas do painel num navegador sem janela, no Linux, com contas e arquivos de exemplo. Não são capturas de uma área de trabalho do Windows.

Não executado: instalar os pacotes 0.5.0-3 em qualquer distribuição (a instalação testada foi a do 0.5.0-2, com cadastro embutido); a janela "Cadastro no Google" do painel do Linux numa sessão gráfica (o código foi apenas compilado); o login no Linux com um cadastro entregue por essa janela; tudo o que já constava como não executado no Windows.

Ainda em 14 de novembro de 2026, depois de o autor tornar o repositório público: a execução 43629851500 do workflow `Native engine (Windows)`, sobre o commit `e22de0b`, aprovou de novo a análise estática, os testes do motor e o teste de instalar, atualizar e desinstalar, e gerou `GCP-Drive-0.5.0-instalador.exe` (SHA-256 `8F998C3A2D047B9ABB8193B7913CD39CBB4E188D294F8A349C832A96538AAF39`), sem cadastro do Google dentro (o arquivo foi varrido por segredos e identificadores de cliente, sem achados). A versão `v0.5.0` foi publicada com esse instalador, os três pacotes Linux 0.5.0-3 e `SHA256SUMS.txt`; a página de versões e o README foram abertos sem login, com resposta normal. Nenhum dos arquivos publicados foi instalado numa área de trabalho depois da publicação.

## 0.5.1: menu do Explorador, painel do Windows no desenho do Linux e marcas de estado no Linux (15 de novembro de 2026)

Executado no GitHub Actions sobre o commit `90fe982`:

- `Native engine (Windows)`, execução 43767708086, runner `windows-latest`: `go vet`, testes do motor contra o Drive simulado e o teste de instalar, atualizar e desinstalar aprovados. O teste novo conferiu que o serviço grava o submenu em `HKCU\Software\Classes\*\shell\GCPDrive` e `...\Directory\shell\GCPDrive`, limitado à pasta GCP-Drive, com a ação `context-ui` nos comandos, e que a desinstalação remove as duas chaves. Instalador `GCP-Drive-0.5.1-instalador.exe`, SHA-256 `44D04B9E118061777F6F4D40A2165427F54624378252D11562116BF6A1613219`.
- `Native engine (Linux)`, execução 43767710717: `go vet` (Linux e Windows) e `go test -race` com a unidade FUSE temporária contra o Drive simulado, aprovados; o teste do motor agora cobre os estados (arquivo lido inteiro = neste computador, não lido e documento Google = só na nuvem, pasta e conteúdo de pasta mantida off-line = off-line, pasta da conta sem marcas). Num contêiner `archlinux:base-devel`, `package.sh` com `GCP_DRIVE_DOLPHIN=required` compilou o plugin do Dolphin contra o Qt 6 e o KIO 6 do Arch e gerou os três pacotes; o pacote Arch foi instalado no contêiner, o link do plugin em `/usr/lib/qt6/plugins/kf6/overlayicon` existe, `ldd` não aponta bibliotecas faltando, os quatro emblemas estão instalados e o caminho do plugin foi conferido dentro do `.rpm` (`/usr/lib64/...`) e do `.deb` (`/usr/lib/x86_64-linux-gnu/...`).
- Os quatro arquivos e o `.deb` extraído foram varridos por segredos de cliente, identificadores de cliente e tokens do Google: nada encontrado; nenhum pacote traz `google-oauth.json`.

Executado num Windows 11 (build 26300, em português), com as contas reais do autor:

- O painel novo foi aberto num navegador com respostas simuladas da API, em tema escuro (Início, Contas, Preferências, Apoie o projeto e a janela de compartilhamento). Não é o painel servido pelo serviço numa janela do Edge.
- Um serviço 0.5.1 isolado (perfil vazio, sem contas) gravou o submenu. A primeira versão do filtro usava `System.ItemPathDisplay`, que neste Windows mostra `C:\Usuários\...` e por isso nunca casava; com `System.ParsingPath` um verbo de controle apareceu para um arquivo e uma pasta dentro da pasta de teste e não apareceu fora dela (consulta pelo `Shell.Application`, que não lista menus em cascata). Corrigido no commit `90fe982`.
- O instalador da execução 43767708086 (hash conferido) foi aplicado em modo silencioso por cima da 0.5.0 em uso: terminou com código 0, o serviço reiniciado respondeu com a versão 0.5.1 e o submenu ficou limitado a `C:\Users\cliqu\GCP-Drive\`. A ação "Copiar link" do submenu, executada pelo comando gravado no registro numa pasta real de uma conta, pôs na área de transferência um link `https://drive.google.com/drive/folders/...`.

Não executado: abrir o menu com o botão direito no Explorador e ver o submenu (o `Shell.Application` não lista cascatas e não havia controle da área de trabalho nesta sessão); as outras ações do menu com contas reais (Gemini, abrir na nuvem, compartilhar, atalho, manter e remover off-line, abrir pasta, enviar arquivo); o painel servido pelo serviço numa janela do Edge e o aviso ao lado do relógio; as marcas vistas no Dolphin, Nautilus e Nemo numa sessão gráfica; o plugin do Dolphin fora do Arch (Fedora e Debian/Ubuntu podem ter Qt mais antigo que o da compilação); instalar os pacotes `.deb` e `.rpm`; Windows 10.
