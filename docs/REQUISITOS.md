# Requisitos acordados e aceite

Linux é uma plataforma prioritária. Nenhum item fica homologado apenas por ter uma tela, um teste com provider simulado ou configuração de empacotamento. A versão de desenvolvimento não satisfaz ainda todos os requisitos abaixo.

| Requisito | Implementação atual | Validação necessária |
|---|---|---|
| Identidade roxa premium, PT-BR, inglês e espanhol | Interface e ícone próprios, troca de idiomas | Fluxos de erro e perguntas de provedor também traduzidos; revisão visual e acessibilidade |
| Google pessoal/Workspace, OneDrive, Dropbox, múltiplas contas | Adaptador de login e identidades distintas | OAuth real, renovação/expiração, consentimento, mesma conta conectada duas vezes, isolamento |
| Streaming e edição em programas externos | VFS full e abertura de caminho montado | Abrir/editar/salvar/salvar como em GCP-PDF, LibreOffice, Office, editores de imagem e arquivos grandes |
| Nomes reais e favoritos | Nomes separados da identidade interna; favoritos persistentes | Unicode, nomes duplicados, caracteres inválidos por SO, atalhos, renomeações e exclusões |
| Meu Drive e Drives compartilhados dentro da unidade | Composição rclone Google | Conta com vários drives, permissões diferentes, alterações de membership, drives com mesmo nome |
| Indicador de outra pessoa usando | Exibe desconhecido | API ou protocolo de presença confiável; sem ausência presumida e sem inferir identidade por arquivo temporário |
| Verde/laranja/vermelho | Indicadores no app por observação VFS/transferências; cinza para desconhecido | Recuperação, falhas, estado obsoleto, download, upload e conflitantes; overlays de sistema pendentes |
| Bandeja animada | Oito frames durante listagens, aberturas, downloads, uploads e sincronização de pastas observados | Windows, macOS, GNOME com indicador, Cinnamon, KDE; pausa e retomada; sem busy loop |
| Selecionar pastas do sistema e sincronizar automaticamente | Seletor nativo, prévia, revisão e scheduler implementados | Homologar com contas reais, exclusões, quedas, locks, reinício e volumes de produção |
| Espelhamento bidirecional | rclone bisync com histórico, preservação de versões e pausa após finalização; fixtures locais passaram | Homologar com provedores reais, falhas e interrupção durante finalização |
| Montar automaticamente no login | Montagem ao abrir app; integração de login Windows/macOS e autostart XDG com backup | Testar login real nos três sistemas, cofre bloqueado e rede tardia |
| Busca inteligente indexável | FTS5 por conta e pastas visitadas | Busca global de metadados, progresso/cobertura, atualização, exclusão e desconexão; integração indexadores nativos |
| Menus com botão direito | Pendente | Explorer, Finder, Nautilus/Nemo/Dolphin: abrir, copiar link, compartilhar, fixar, offline, versões conforme capacidade |
| Linux no grupo Internet | Configuração `Network` | Instalar e remover `.deb`/`.rpm`, validar atalhos sem duplicação em Cinnamon/GNOME/KDE |
| Windows/Linux/macOS Intel e Apple Silicon | Configuração de build | Produzir, instalar, atualizar, remover; assinatura/notarização; drivers e permissões |
| Segurança | Renderer isolado, IPC limitado, config criptografada, RC autenticado em loopback | Revisão de ameaças, OAuth próprio/verificado, revogação, logs, permissões, backups e recuperação de chave |

## Busca e privacidade

O índice deve manter identidade do provedor, nome original, conta, revisão e momento da observação separados. Cobertura parcial precisa permanecer visível. Não baixar o conteúdo de toda a nuvem apenas para indexar nomes. Busca por conteúdo deve ser opcional, com escolha de pastas, custo, volume e privacidade claros.

Windows Search, Spotlight e Tracker/Baloo não indexam necessariamente todo o conteúdo de unidades FUSE/virtuais. Ter uma unidade montada não constitui uma integração de busca. Extensões por sistema precisarão de evidência de consulta no gerenciador real, incluindo arquivos nunca baixados.

## Contextos de sistema

Menus devem atuar só em caminhos de contas pertencentes ao GCP-Drive. Não assumir posse por prefixo de nome nem interceptar todas as extensões. Separar copiar link existente de criar link público. Ações de compartilhamento precisam explicitar destinatários e permissões. Pin offline deve garantir retenção, não apenas aquecer cache que poderá ser evicto.

Linux: integrações específicas para Nautilus, Nemo e Dolphin, distribuídas e removidas pelo pacote apropriado, sem instalar dependências de outros gerenciadores. macOS: Finder Sync/File Provider conforme autoridade e capacidade. Windows: integração Explorer apropriada à versão, com instalador e desinstalador idempotentes.

## Homologação Linux obrigatória

Testar ao menos Ubuntu/GNOME, Linux Mint/Cinnamon e Fedora/KDE ou GNOME, com `.deb` e `.rpm`, X11/Wayland onde aplicável. Confirmar menu Internet, ícone, bandeja, login, cofre bloqueado, FUSE, nomes reais, diálogos de salvar, favoritos, montagem após login e retomada após suspender/reconectar.

O gate de dados inclui edição concorrente, rename seguido de edição, falha de disco/cache, sem espaço, quota/API, offline, término inesperado, encerramento com uploads, cancelamento na finalização e repetição de cleanup. Usar conjuntos de teste isolados em cada provedor antes de liberar dados reais.
