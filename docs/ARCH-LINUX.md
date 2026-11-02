# Arch Linux e distribuições compatíveis

## Instalação simples, sem compilar o aplicativo

Na [release 0.3.0-beta.2](https://github.com/cliqueprojeto/GCP-Drive/releases/tag/v0.3.0-beta.2), baixe:

- `gcp-drive-bin-0.3.0beta.2-2-x86_64.pkg.tar.zst`
- `SHA256SUMS-ARCH`, para conferir a integridade do pacote.

Na pasta do download, instale com o gerenciador do sistema:

```sh
sha256sum --ignore-missing --check SHA256SUMS-ARCH
sudo pacman -U ./gcp-drive-bin-0.3.0beta.2-2-x86_64.pkg.tar.zst
```

O pacman resolve dependências nos repositórios configurados e apresenta as alterações para aprovação. Abra **GCP-Drive** na categoria **Internet**, ou execute `gcp-drive`. Conecte as contas pela interface. O motor já acompanha o pacote; não é necessário instalar rclone separadamente.

O cofre de senhas da sessão deve estar disponível e desbloqueado. O pacote aceita provedores de `org.freedesktop.secrets`, permitindo usar o cofre compatível já instalado. FUSE 3 é uma dependência de montagem. O pacote é **x86_64**, não ARM.

## Receita compatível com AUR

AUR distribui receitas `PKGBUILD` e metadados `.SRCINFO`, não arquivos com extensão `.aur`. A receita do projeto chama-se **gcp-drive-bin**: reutiliza o binário Linux publicado, confere SHA-256 e monta um pacote nativo, sem compilar Electron ou o aplicativo.

A receita está em [packaging/arch/gcp-drive-bin](../packaging/arch/gcp-drive-bin). É possível utilizá-la diretamente pelo GitHub:

```sh
sudo pacman -Syu --needed base-devel git
git clone --depth 1 https://github.com/cliqueprojeto/GCP-Drive.git
cd GCP-Drive/packaging/arch/gcp-drive-bin
makepkg -si
```

Execute `makepkg` como usuário comum, sem `sudo`. Ele solicita autorização quando precisa instalar dependências ou o pacote. Revise o PKGBUILD antes de executar.

O registro da receita em **aur.archlinux.org** requer uma conta do mantenedor com chave SSH autorizada. Enquanto esse registro não estiver confirmado, não há comando `yay -S gcp-drive-bin` ou `paru -S gcp-drive-bin` anunciado como disponível. A instalação pelo pacote da release e pela receita do GitHub funciona independentemente do cadastro no AUR.

## Atualização e remoção

Atualize com um novo pacote publicado usando `pacman -U`, ou atualize a receita e execute `makepkg -si`. Nesta versão, o atualizador interno oferece DEB/RPM/AppImage; no Arch, use o pacote nativo e o pacman.

Para desinstalar somente o aplicativo:

```sh
sudo pacman -R gcp-drive-bin
```

O gerenciador não remove automaticamente configurações, contas ou cache no perfil pessoal. Encerre o aplicativo e aguarde uploads antes de remover. O pacote não adiciona repositórios, não usa instalador remoto via shell e não desativa o sandbox do Chromium.

## Validação

O workflow **Arch Linux package** constrói a receita com `makepkg` como usuário comum em um contêiner Arch, instala o pacote com pacman e verifica dependências dinâmicas, entrada desktop, licenças, permissões do sandbox e execução do motor. A [execução da revisão 2](https://github.com/cliqueprojeto/GCP-Drive/actions/runs/41545927213) passou, incluindo Electron 45.1.0 em modo Node e rclone 1.75.2. O `namcap` não apresentou erros; avisos de bibliotecas de compatibilidade do binário e dependências usadas por carregamento dinâmico ou comandos externos permanecem no relatório. Os arquivos publicados foram conferidos contra SHA-256.

Contêiner sem sessão gráfica não homologa cofre, login cloud, montagem FUSE, bandeja ou integração com Nautilus/Nemo/KDE em uma sessão real. A versão continua beta; comece com dados de teste.

Referências: [PKGBUILD](https://man.archlinux.org/man/PKGBUILD.5.en), [diretrizes do AUR](https://wiki.archlinux.org/title/AUR_submission_guidelines).
