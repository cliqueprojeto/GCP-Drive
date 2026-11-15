#!/bin/bash
# Builds the engine and the Linux packages (.pkg.tar.zst, .deb, .rpm) into ../.local/installers/<version>.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
version="$(sed -n 's/^const version = "\(.*\)"$/\1/p' "$here/account.go")"
release=1
# The packages carry no registration with Google: each person hands their own to the panel
# (docs/CADASTRO-GOOGLE.md). GCP_DRIVE_OAUTH_FILE embeds one, for private builds only.
oauth="${GCP_DRIVE_OAUTH_FILE:-}"
[ -z "$oauth" ] || [ -r "$oauth" ] || { echo "Cadastro OAuth do aplicativo não encontrado: $oauth" >&2; exit 1; }
out="$here/../.local/installers/$version"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stage="$work/stage"
mkdir -p "$out" "$stage"

(cd "$here" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$work/gcp-drive" .)

install -Dm755 "$work/gcp-drive" "$stage/usr/bin/gcp-drive"
install -Dm755 /dev/stdin "$stage/usr/bin/gcp-drive-ui" <<'SH'
#!/bin/sh
exec /usr/bin/python3 /usr/lib/opengdrive/opengdrive-ui "$@"
SH
for f in opengdrive-ui drive_places.py style.css support-pix.png support-stripe.png; do
  install -Dm644 "$here/ui/$f" "$stage/usr/lib/opengdrive/$f"
done
[ -z "$oauth" ] || install -Dm644 "$oauth" "$stage/usr/lib/opengdrive/google-oauth.json"
for f in "$here"/files/icons/*.svg; do install -Dm644 "$f" "$stage/usr/share/icons/hicolor/scalable/apps/$(basename "$f")"; done
# Dolphin's status marks: a KDE Frameworks 6 plugin, built when its development files are present.
# GCP_DRIVE_DOLPHIN=required makes a missing plugin an error (release builds).
plugin=""
if command -v cmake >/dev/null && cmake -S "$here/dolphin" -B "$work/dolphin" -DCMAKE_BUILD_TYPE=Release >"$work/dolphin.log" 2>&1 \
   && cmake --build "$work/dolphin" >>"$work/dolphin.log" 2>&1; then
  install -Dm644 "$work/dolphin/gcpdriveoverlay.so" "$stage/usr/lib/opengdrive/gcpdriveoverlay.so"
  plugin=1
elif [ "${GCP_DRIVE_DOLPHIN:-}" = required ]; then
  cat "$work/dolphin.log" >&2; echo "O plugin do Dolphin não compilou." >&2; exit 1
else
  echo "Aviso: plugin do Dolphin não compilado (faltam cmake, Qt 6 ou KIO 6); os pacotes saem sem as marcas no Dolphin." >&2
fi
for f in "$here"/files/servicemenus/*.desktop; do install -Dm644 "$f" "$stage/usr/share/kio/servicemenus/$(basename "$f")"; done
install -Dm644 "$here/../LICENSE" "$stage/usr/share/licenses/gcp-drive/LICENSE"
for f in "$here"/files/licenses/*.txt; do install -Dm644 "$f" "$stage/usr/share/licenses/gcp-drive/$(basename "$f")"; done
install -Dm644 "$here/files/file-manager-extension.py" "$stage/usr/share/nautilus-python/extensions/gcp-drive.py"
install -Dm644 "$here/files/file-manager-extension.py" "$stage/usr/share/nemo-python/extensions/gcp-drive.py"
install -Dm644 "$here/files/org.gcpdrive.Desktop.desktop" "$stage/usr/share/applications/org.gcpdrive.Desktop.desktop"
install -Dm644 "$here/files/opengdrive.desktop" "$stage/etc/xdg/autostart/opengdrive.desktop"
install -Dm644 "$here/files/gcp-drive.menu" "$stage/etc/xdg/menus/applications-merged/gcp-drive.menu"

summary="Google Drive no Linux com streaming, cópias off-line e várias contas."
# A package update replaces the files but not the service already running in each session.
updated='echo "GCP-Drive atualizado. Para concluir, abra o painel do GCP-Drive e aceite reiniciar o serviço, ou saia da sessão e entre de novo."'

# Each distribution looks for Qt plugins in its own directory; the plugin is linked from there.
stage_for() {
  local dir="$work/stage-$1"
  cp -a "$stage" "$dir"
  if [ -n "$plugin" ]; then
    install -d "$dir$2"
    ln -s /usr/lib/opengdrive/gcpdriveoverlay.so "$dir$2/gcpdriveoverlay.so"
  fi
}
stage_for arch /usr/lib/qt6/plugins/kf6/overlayicon
stage_for deb /usr/lib/x86_64-linux-gnu/qt6/plugins/kf6/overlayicon
stage_for rpm /usr/lib64/qt6/plugins/kf6/overlayicon

# Arch, Manjaro and BigLinux
mkdir -p "$work/arch"
cat > "$work/arch/PKGBUILD" <<PKG
pkgname=gcp-drive
pkgver=$version
pkgrel=$release
pkgdesc="$summary"
arch=('x86_64')
url="https://github.com/cliqueprojeto/GCP-Drive"
license=('GPL-3.0-only')
depends=('fuse3' 'python' 'python-gobject' 'gtk3' 'libayatana-appindicator' 'xdg-utils' 'wl-clipboard' 'xclip' 'ca-certificates' 'hicolor-icon-theme')
optdepends=('kio: marcas de estado nas pastas do Dolphin' 'kde-cli-tools: resolver pastas recentes e resultados de busca do Dolphin' 'python-nautilus: ações no Nautilus' 'nemo-python: ações no Nemo')
conflicts=('opengdrive' 'gcp-drive-bin')
replaces=('opengdrive' 'gcp-drive-bin')
options=('!strip' '!debug')
install=gcp-drive.install
package() { cp -a "$work/stage-arch/." "\$pkgdir/"; }
PKG
printf 'post_upgrade() {\n  %s\n}\n' "$updated" > "$work/arch/gcp-drive.install"
(cd "$work/arch" && PKGDEST="$out" PKGEXT=.pkg.tar.zst makepkg --nodeps --force --noconfirm >/dev/null)

# Debian and Ubuntu
deb="$work/deb"
mkdir -p "$deb/control"
size="$(du -sk "$work/stage-deb" | cut -f1)"
cat > "$deb/control/control" <<CTL
Package: gcp-drive
Version: $version-$release
Section: net
Priority: optional
Architecture: amd64
Maintainer: Gestão Cultural Pro <contato@gestaoculturalpro.com.br>
Installed-Size: $size
Depends: fuse3, python3, python3-gi, gir1.2-gtk-3.0, gir1.2-ayatanaappindicator3-0.1, xdg-utils, wl-clipboard | xclip, ca-certificates
Suggests: python3-nautilus, nemo-python
Conflicts: opengdrive
Replaces: opengdrive
Homepage: https://gestaoculturalpro.com.br
Description: $summary
 Monta cada conta do Google Drive como uma pasta do computador. Os arquivos
 são baixados sob demanda e ficam em cache local para abrir na hora.
CTL
(cd "$work/stage-deb" && find etc -type f | sed 's|^|/|') > "$deb/control/conffiles"
(cd "$work/stage-deb" && find usr etc -type f -exec md5sum {} + ) > "$deb/control/md5sums"
printf '#!/bin/sh\nset -e\n[ "$1" = configure ] && [ -n "$2" ] && %s\nexit 0\n' "$updated" > "$deb/control/postinst"
chmod 755 "$deb/control/postinst"
echo 2.0 > "$deb/debian-binary"
fakeroot sh -c "cd '$deb/control' && tar --owner=0 --group=0 -cJf ../control.tar.xz ./control ./conffiles ./md5sums ./postinst && cd '$work/stage-deb' && tar --owner=0 --group=0 -cJf '$deb/data.tar.xz' ./usr ./etc"
rm -f "$out/gcp-drive_${version}-${release}_amd64.deb"
(cd "$deb" && ar rc "$out/gcp-drive_${version}-${release}_amd64.deb" debian-binary control.tar.xz data.tar.xz)

# Fedora
mkdir -p "$work/rpm/SPECS"
{
cat <<SPEC
Name: gcp-drive
Version: $version
Release: $release
Summary: $summary
License: GPL-3.0-only AND BSD-3-Clause
URL: https://gestaoculturalpro.com.br
BuildArch: x86_64
AutoReqProv: no
Requires: fuse3, python3, python3-gobject, gtk3, libayatana-appindicator-gtk3, xdg-utils, ca-certificates, (wl-clipboard or xclip)
Obsoletes: opengdrive < $version
%description
Monta cada conta do Google Drive como uma pasta do computador. Os arquivos
são baixados sob demanda e ficam em cache local para abrir na hora.
%post
[ "\$1" -gt 1 ] && $updated || :
%install
cp -a "$work/stage-rpm/." "%{buildroot}/"
%files
SPEC
(cd "$work/stage-rpm" && find usr \( -type f -o -type l \) | sed 's|^|"/|; s|$|"|')
(cd "$work/stage-rpm" && find etc -type f | sed 's|^|%config(noreplace) "/|; s|$|"|')
} > "$work/rpm/SPECS/gcp-drive.spec"
rpmbuild -bb --quiet --define "_topdir $work/rpm" --define "_rpmdir $work/rpm/out" --define "_build_id_links none" --define "debug_package %{nil}" "$work/rpm/SPECS/gcp-drive.spec"
cp "$work"/rpm/out/x86_64/*.rpm "$out/gcp-drive-${version}-${release}.x86_64.rpm"

(cd "$out" && sha256sum gcp-drive-${version}-${release}-x86_64.pkg.tar.zst gcp-drive_${version}-${release}_amd64.deb gcp-drive-${version}-${release}.x86_64.rpm > SHA256SUMS.txt && cat SHA256SUMS.txt)
