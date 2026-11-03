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
