# Desempenho da unidade — 0.3.0-beta.3

## Observado antes da mudança

Medição no Windows do usuário, com o GCP-Drive 0.3.0-beta.2 instalado e a conta Google montada em `G:` (somente leitura, via PowerShell):

| Pasta | Itens | Primeira abertura | Segunda abertura |
|---|---:|---:|---:|
| `G:\Meu Drive` | 179 | 8,3 s | 9 ms |
| `G:\Compartilhados comigo` | 1171 | 13,5 s | — |
| Subpastas de `Meu Drive` | 1–22 | ~0,3 s | — |

Após cerca de 20 minutos as mesmas pastas voltaram a levar 5–7 s. Os processos rclone usavam 120–160 MB de memória cada.

## Causas identificadas no código

1. **Cache de diretórios curto.** `--dir-cache-time 10m` descartava a lista de cada pasta a cada 10 minutos, embora Google Drive, OneDrive e Dropbox informem alterações por polling. Toda reabertura depois disso voltava à nuvem.
2. **Listagem duplicada.** Com a unidade montada, o painel "Meus arquivos" pedia `operations/list` ao backend, fora do cache VFS. O Explorador e o painel faziam a mesma consulta à nuvem separadamente e disputavam a cota do provedor.
3. **Atributos expirando em 1 s.** Gerenciadores de arquivos consultam os atributos de cada item várias vezes; com `--attr-timeout 1s` (padrão), quase toda consulta voltava ao rclone.
4. **Abertura de arquivos grandes em fluxo único.** A leitura usava blocos crescentes em uma única conexão.
5. **Prontidão antecipada.** A montagem era considerada ativa quando o servidor RC respondia, antes de o volume aparecer. No ensaio WinFsp isso falhou em 1 de 3 execuções com `ENOENT`.

## O que mudou

- Provedores com polling (`drive`, `onedrive`, `dropbox`): `--dir-cache-time 168h` e `--poll-interval 15s`. As listas continuam válidas até o provedor informar mudança. MEGA e Proton Drive, sem polling, expiram em 5 minutos.
- `--attr-timeout 10s`, `--vfs-fast-fingerprint`, `--vfs-read-chunk-size 16M` com `--vfs-read-chunk-streams 4`, `--buffer-size 4M` (antes 8M por arquivo aberto) e `--vfs-write-back 5s`.
- Cache em disco: 10 GB, mínimo de 2 GB livres e validade de 14 dias.
- O painel lista pastas montadas pelo próprio volume (`rclone lsjson` no caminho local). O Explorador/Dolphin/Finder e o painel passam a compartilhar a mesma lista em cache. Sem montagem, o painel continua consultando o provedor.
- Depois de montar, o app pré-carrega em segundo plano a raiz, `Meu Drive` e `Compartilhados comigo` (`vfs/refresh` assíncrono, não recursivo).
- A montagem só é marcada como ativa quando o volume está visível (letra acessível no Windows; dispositivo diferente da pasta-pai no Linux/macOS).
- macOS: `noappledouble` e `noapplexattr` evitam que o Finder grave arquivos `._*` na nuvem.
- Windows: mantém o modo rede (o Explorador não lê imagens e vídeos para gerar miniaturas). O rótulo passa a ser `GCP-Drive · Conta (G:)`, sem `(\\server)`. O atalho fixado no painel de navegação, criado pelas betas anteriores, é removido.
- Se a unidade for ejetada ou desconectada fora do app, ela é remontada automaticamente: até 5 tentativas em 2 s, 5 s, 15 s, 30 s e 60 s. Para desmontar, use **Desconectar** no painel.
- Bandeja: 8 quadros animados enquanto houver listagem, abertura, download, upload ou sincronização de pastas. A detecção usa o avanço dos contadores do motor, não apenas os uploads.
- Painel: a última lista de cada pasta aparece na hora enquanto é atualizada. Trilha clicável, botão para subir de pasta, aviso para pastas grandes e paginação só quando necessária. O snapshot para de ser consultado com a janela oculta.

## Medido depois da mudança

Ensaio `scripts/mount-smoke.mjs`: WinFsp real, origem local, 200 arquivos e um arquivo de 4 MB. Três execuções alternadas por configuração, mesma máquina:

| Métrica (ms) | Antes (beta.2) | Depois |
|---|---:|---:|
| Primeira listagem | 5,5–6,8 | 3,5–6,4 |
| Listagem repetida | 2,3–5,0 | 1,6–3,0 |
| Primeira leitura de 4 MB | 43–65 | 28–31 |
| Leitura repetida de 4 MB | 14–20 | 9–16 |

A listagem do painel pelo volume levou cerca de 0,45 s em pastas já em cache no `G:` real, sendo a maior parte a inicialização do processo rclone. Antes, cada listagem do painel ia ao provedor (0,3–8 s).

**Não medido:** a nova versão contra a nuvem real. O ensaio com origem local não reproduz a latência nem a cota dos provedores. Memória, CPU e tokens não foram medidos. O ganho com a nuvem depende de a pasta já estar em cache. A primeira abertura de uma pasta grande continua limitada pelo provedor.

## Motores alternativos

| Opção | Streaming sob demanda | Multiprovedor | Embutível em app GPL | Observação |
|---|---|---|---|---|
| rclone mount (atual) | Sim (VFS + cache) | Sim | Sim (MIT) | Os gargalos encontrados eram de configuração, não do motor. |
| Google Drive para desktop | Sim | Só Google | Não | Proprietário, sem API de embutimento. |
| Insync | Não (espelha/baixa) | Google/OneDrive/Dropbox | Não | Proprietário; sincroniza cópias, não faz streaming. |
| google-drive-ocamlfuse | Sim | Só Google | Separado | Só Linux. |
| Windows Cloud Files API (CfAPI) | Sim (placeholders) | Qualquer, com código próprio | Sim | Base do OneDrive e do Google Drive. Traz ícones nativos, "manter offline", miniaturas sem download e sem driver WinFsp. Exige um provedor nativo por sistema. |
| macOS File Provider | Sim | Qualquer, com extensão própria | Sim, com app assinado | Substitui macFUSE e traz integração nativa ao Finder; exige assinatura e notarização Apple. |

Recomendação: manter o rclone. Ele é o único motor aberto, multiprovedor e com streaming nos três sistemas, e as lentidões observadas vinham dos parâmetros e da listagem duplicada. Os próximos saltos de integração nativa são CfAPI no Windows e File Provider no macOS, usando o rclone como transporte. Esse é um projeto separado, que precisa de decisão de escopo. No Linux, FUSE continua sendo o mecanismo disponível.

## Limitações que continuam

- Dolphin, Nautilus e o Explorador ainda geram miniaturas e pré-visualizações de pastas lendo o conteúdo dos arquivos. No KDE, desativar "Visualizações de pastas" para unidades remotas reduz downloads. O app não altera essa configuração global.
- Criar uma pasta ou renomear um item continua sendo uma operação síncrona no provedor. O gerenciador de arquivos espera a resposta da nuvem.
- Indexação global (Windows Search, Spotlight, Tracker/Baloo), ícones de estado nativos, "manter offline" permanente e presença de outros editores continuam pendentes. Ver CfAPI/File Provider acima.

## Indicadores de estado — 0.3.0-beta.4

O app lê os metadados do cache do motor (`vfsMeta`, rclone 1.75.2) de cada unidade montada. Um arquivo só recebe a cor depois dessa leitura:

| Cor | Estado | Origem |
|---|---|---|
| Verde | Disponível neste computador | Todos os bytes estão no cache e não há alteração pendente. |
| Laranja | Enviando, aguardando envio ou alteração pendente | Fila de envio do motor ou `Dirty: true`. |
| Cinza | Somente na nuvem ou parcialmente baixado | O arquivo não aparece numa leitura completa do cache, ou só parte dele está no disco. |
| Vermelho | Problema | O envio falhou e está sendo repetido. |
| Cinza "Não verificado" | Desconhecido | Leitura incompleta, metadado inválido ou nome que o Windows codifica de outra forma. |

As pastas não recebem cor agregada, exceto quando há uma transferência em curso dentro delas. O painel "Meus arquivos" mostra esses estados nos três sistemas. No Linux, a extensão instalada pelo app no Nautilus e no Nemo mostra os mesmos estados como emblemas (`emblem-default`, `emblem-synchronizing`, `emblem-web`, `emblem-important`). A extensão requer `python3-nautilus` ou `nemo-python`. Depois da primeira instalação, feche e reabra o gerenciador de arquivos.

O GCP-Drive não terá extensões nativas para Dolphin, Finder ou Explorador. Nesses gerenciadores, os estados aparecem só no painel do app.

## Streaming e estabilidade no Linux — 0.3.0-beta.5

A unidade montada é a rota padrão ao abrir uma conta conectada pela barra lateral no Linux. O painel ainda permite navegar em **Meus arquivos**. A montagem deixou de antecipar listagens no provedor e a leitura de metadados do cache sai do caminho crítico da Atividade. O kernel informa se o volume está anexado sem listar sua raiz. Uma montagem lenta pode passar a disponível em uma observação posterior.

O Linux usa cache VFS esparso, com meta de 2 GiB por conta e expiração após 48 horas sem acesso. O rclone pode ultrapassar temporariamente a meta, por exemplo com arquivos abertos ou gravações pendentes. A redução de leituras em paralelo por arquivo diminui a quantidade de requisições quando várias montagens ou miniaturas disputam a rede. A velocidade de leitura sequencial de arquivos grandes pode cair em conexões de alta latência. [Documentação do cache de arquivos do rclone](https://rclone.org/commands/rclone_mount/#file-caching).

| Alternativa | Comportamento relevante para o Linux |
|---|---|
| Insync | Sincronização seletiva de cópias locais. A equipe descreve essa abordagem como diferente de streaming sob demanda no explorador. [Insync](https://www.insynchq.com/syncing-superpowers), [resposta da equipe](https://forums.insynchq.com/t/streaming-instead-of-syncing/19796). |
| Grive2 | Sincroniza uma árvore local, com seleção de subdiretórios e disparo por inotify/systemd. [Grive2](https://github.com/vitalif/grive2). |
| KIO GDrive | Acesso ao Google Drive em aplicativos KDE por `gdrive:/`. É útil no Dolphin, mas o endereço KIO difere de um caminho de unidade comum para programas externos. [KDE](https://apps.kde.org/kio_gdrive/). |
| google-drive-ocamlfuse | Montagem Linux especializada em Google Drive, com múltiplas contas. É a alternativa mais próxima para um ensaio Google-only. [google-drive-ocamlfuse](https://github.com/astrada/google-drive-ocamlfuse). |

Mantivemos o rclone nesta beta para preservar a montagem multiprovedor e o cache de gravações existente. A comparação acima é de arquitetura e escopo. Os tempos medidos são os do GCP-Drive em [VALIDACAO.md](VALIDACAO.md).
