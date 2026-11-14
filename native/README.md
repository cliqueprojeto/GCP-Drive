# GCP-Drive nativo para Linux (FUSE)

Cliente do Google Drive para Linux sem rclone. Cada conta aparece como uma pasta em `~/GCP-Drive/<e-mail>`, com `Meu Drive`, `Compartilhados comigo` e `Drives compartilhados`.

## Como funciona

| Parte | Arquivo | Papel |
|---|---|---|
| Mapa de pastas | `meta.go` | Lê a árvore da conta uma vez (`files.list`) e depois aplica só as alterações (`changes.list`, a cada 20 s). Fica salvo em `~/.local/share/opengdrive/mapa`. Enquanto o mapa não termina, cada pasta é carregada na primeira visita. |
| Cache de blocos | `cache.go` | Blocos de 256 KiB em `~/.cache/gcp-drive`. A primeira leitura pede um bloco; leitura sequencial dobra o pedido até 16 MiB por requisição, e cada bloco é entregue assim que chega. Um leitor cancelado não cancela o download. Limite configurável, com descarte do menos usado; cópias off-line não são descartadas. |
| Prioridade e banda | `api.go` (`Sched`) | Abrir arquivo e listar pasta passam na frente; mapa, leitura antecipada e cópias off-line esperam. Limites de download e envio em KB/s. |
| Gravação | `mount.go` | Alterações vão para uma cópia local em `~/.local/share/opengdrive/envios` e sobem 5 s depois de o arquivo ser fechado. Salvar por arquivo temporário + renomear vira uma nova revisão do mesmo item. Conflito com alteração remota gera um segundo arquivo. Excluir manda para a lixeira do Drive. Arquivos de trava de editores não são enviados. |
| Sistema de arquivos | `fs.go`, `mount_linux.go` | go-fuse. Documentos do Google (Docs, Planilhas…) aparecem como atalhos `.desktop` que abrem no navegador. |
| Serviço e comandos | `main.go` | O serviço atende a interface por um socket local em `$XDG_RUNTIME_DIR`. |
| Interface | `ui/` | GTK 3 em Python. |

As contas ficam em `~/.config/opengdrive/accounts`, no mesmo formato das versões 0.4.x, e a montagem mantém o tipo `fuse.opengdrive`. Uma atualização a partir da 0.4.x não exige novo login.

## Separação por sistema

O cliente da API, o mapa, o cache de blocos, a fila de envio, as contas e o serviço não dependem do sistema. O que é próprio de cada um fica em arquivos com sufixo: `fs.go`, `mount_linux.go` e `os_linux.go` (FUSE, pastas XDG, trava de sessão) e `mount_windows.go`, `sync_windows.go` e `os_windows.go` (pastas do perfil, regras de nomes do NTFS). No Windows (`mount_windows.go`), cada conta é uma pasta sob demanda da Cloud Filter API em `%USERPROFILE%\GCP-Drive\<e-mail>`, sem letra de unidade e sem driver de terceiros. As pastas são preenchidas a partir do mapa na primeira abertura, o conteúdo vem do cache de blocos e as alterações remotas são escritas nas pastas já exibidas. Documentos do Google aparecem como atalhos `.url`. O que muda na pasta é percebido por um vigia de alterações e por um levantamento na partida (`sync_windows.go`): arquivos novos e editados vão para a fila de envio como cópia do momento e viram placeholders sincronizados, renomeações, movimentações e pastas novas são repetidas no Drive, e o que é apagado vai para a lixeira do Drive depois de uma espera curta que distingue apagar de mover. Um arquivo aberto para escrita por um programa só é enviado depois de fechado. Conteúdo local ainda não enviado nunca é substituído por uma alteração remota. A pasta é registrada no Explorer pela classe `StorageProviderSyncRootManager` (`cfapi/shell_windows.go`), o que dá a entrada no painel de navegação, os ícones de estado e os comandos "Sempre manter neste dispositivo" e "Liberar espaço"; se esse registro falhar, a pasta funciona sem eles e a falha aparece no painel. Um arquivo mantido no dispositivo é baixado inteiro e conta como seleção off-line; um arquivo com todo o conteúdo no disco deixa de ocupar o cache de blocos. O serviço mostra um ícone ao lado do relógio (`desktop_windows.go`) e um painel (`panel_windows.go`, `panel/`): uma página servida só para este computador, com token por execução, aberta em janela própria pelo Microsoft Edge ou, sem ele, pelo navegador padrão.

O instalador do Windows (`windows/installer.nsi`, NSIS) é por usuário e não pede administrador: instala em `%LOCALAPPDATA%\Programs\GCP-Drive`, cria o atalho no menu Iniciar e inicia o serviço com o Windows. Ele não leva o cadastro do aplicativo no Google; um `google-oauth.json` colocado ao lado do instalador é copiado para a instalação. A desinstalação chama `gcp-drive.exe uninstall` (`setup_windows.go`), que encerra o serviço, tira as pastas das contas do Explorer, remove as cópias do que está no Drive e o cache e mantém, como arquivos comuns, o que ainda não chegou ao Drive; a fila de envio fica guardada. O workflow `Native engine (Windows)` gera o instalador e testa instalar, atualizar e desinstalar em modo silencioso (`windows/test-installer.ps1`). `cfapi/` contém as chamadas a `cldapi.dll` em Go puro; os testes de Windows rodam pelo workflow `Native engine (Windows)`.

## Diferenças em relação à 0.4.x

- Só Google Drive. Contas Dropbox e OneDrive de versões anteriores não são montadas.
- O modo "espelhamento" foi substituído por **manter off-line** (arquivo ou pasta, pelo menu do gerenciador de arquivos).
- Gravações que a 0.4.x deixou em `~/.local/share/opengdrive/gravacoes-pendentes` não são migradas. Conclua os envios antes de atualizar.

## Compilar, testar e empacotar

Go 1.27, FUSE 3, `makepkg`, `rpmbuild`, `ar` e `fakeroot`.

```sh
go vet ./... && go test -race ./...
GOOS=windows go vet ./...
./package.sh
```

`go test` monta uma unidade FUSE temporária contra um Google Drive simulado em memória; não usa contas reais. `package.sh` grava os pacotes e o `SHA256SUMS.txt` em `.local/installers/<versão>` e lê o cadastro OAuth do aplicativo de `GCP_DRIVE_OAUTH_FILE` (não versionado).

Variáveis para ensaio isolado: `GCP_DRIVE_STATE` (dados, cache e socket), `GCP_DRIVE_MOUNT_ROOT` (pasta das montagens) e `GCP_DRIVE_READONLY=1` (recusa qualquer gravação).
