# GCP-Drive nativo para Linux (FUSE)

Cliente do Google Drive para Linux sem rclone. Cada conta aparece como uma pasta em `~/GCP-Drive/<e-mail>`, com `Meu Drive`, `Compartilhados comigo` e `Drives compartilhados`.

## Como funciona

| Parte | Arquivo | Papel |
|---|---|---|
| Mapa de pastas | `meta.go` | Lê a árvore da conta uma vez (`files.list`) e depois aplica só as alterações (`changes.list`, a cada 20 s). Fica salvo em `~/.local/share/opengdrive/mapa`. Enquanto o mapa não termina, cada pasta é carregada na primeira visita. |
| Cache de blocos | `cache.go` | Blocos de 1 MiB em `~/.cache/gcp-drive`. Leitura sequencial dobra o pedido até 16 MiB por requisição. Um leitor cancelado não cancela o download. Limite configurável, com descarte do menos usado; cópias off-line não são descartadas. |
| Prioridade e banda | `api.go` (`Sched`) | Abrir arquivo e listar pasta passam na frente; mapa, leitura antecipada e cópias off-line esperam. Limites de download e envio em KB/s. |
| Gravação | `mount.go` | Alterações vão para uma cópia local em `~/.local/share/opengdrive/envios` e sobem 5 s depois de o arquivo ser fechado. Salvar por arquivo temporário + renomear vira uma nova revisão do mesmo item. Conflito com alteração remota gera um segundo arquivo. Excluir manda para a lixeira do Drive. Arquivos de trava de editores não são enviados. |
| Sistema de arquivos | `fs.go` | go-fuse. Documentos do Google (Docs, Planilhas…) aparecem como atalhos `.desktop` que abrem no navegador. |
| Serviço e comandos | `main.go` | O serviço atende a interface por um socket local em `$XDG_RUNTIME_DIR`. |
| Interface | `ui/` | GTK 3 em Python. |

As contas ficam em `~/.config/opengdrive/accounts`, no mesmo formato das versões 0.4.x, e a montagem mantém o tipo `fuse.opengdrive`. Uma atualização a partir da 0.4.x não exige novo login.

## Diferenças em relação à 0.4.x

- Só Google Drive. Contas Dropbox e OneDrive de versões anteriores não são montadas.
- O modo "espelhamento" foi substituído por **manter off-line** (arquivo ou pasta, pelo menu do gerenciador de arquivos).
- Gravações que a 0.4.x deixou em `~/.local/share/opengdrive/gravacoes-pendentes` não são migradas. Conclua os envios antes de atualizar.

## Compilar, testar e empacotar

Go 1.27, FUSE 3, `makepkg`, `rpmbuild`, `ar` e `fakeroot`.

```sh
go vet ./... && go test -race ./...
./package.sh
```

`go test` monta uma unidade FUSE temporária contra um Google Drive simulado em memória; não usa contas reais. `package.sh` grava os pacotes e o `SHA256SUMS.txt` em `.local/installers/<versão>` e lê o cadastro OAuth do aplicativo de `GCP_DRIVE_OAUTH_FILE` (não versionado).

Variáveis para ensaio isolado: `GCP_DRIVE_STATE` (dados, cache e socket), `GCP_DRIVE_MOUNT_ROOT` (pasta das montagens) e `GCP_DRIVE_READONLY=1` (recusa qualquer gravação).
