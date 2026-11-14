import os
import subprocess
import time
from urllib.parse import unquote, urlsplit

import gi
from gi.repository import GObject

if "nemo-python" in __file__:
    gi.require_version("Nemo", "3.0")
    from gi.repository import Nemo as Files
else:
    gi.require_version("Nautilus", "4.0")
    from gi.repository import Nautilus as Files

ROOT = os.path.join(os.path.expanduser("~"), "GCP-Drive")
UI = "/usr/bin/gcp-drive-ui"
MENU = (
    ("gemini", "Pedir ao Gemini no Drive"),
    ("web", "Abrir na nuvem"),
    ("link", "Copiar link da nuvem"),
    ("share", "Compartilhar"),
    ("shortcut", "Adicionar atalho a Meu Drive"),
)

MOUNT_AGE = 3
mounts = []
checked = float("-inf")


def refresh_mounts():
    global mounts, checked
    now = time.monotonic()
    if now - checked < MOUNT_AGE:
        return
    checked = now
    mounts = []
    try:
        with open("/proc/self/mountinfo", encoding="utf-8") as mountinfo:
            for line in mountinfo:
                before, _, after = line.partition(" - ")
                columns = before.split()
                if len(columns) < 5 or not after.startswith("fuse.opengdrive OpenGdrive:"):
                    continue
                path = columns[4].replace(r"\040", " ").replace(r"\011", "\t").replace(r"\012", "\n").replace(r"\134", "\\")
                if os.path.dirname(path) == ROOT:
                    mounts.append(path)
    except OSError:
        pass


class OpenGdrive(GObject.GObject, Files.MenuProvider):
    def get_file_items(self, *args):
        files = args[-1]
        if len(files) != 1:
            return []
        item = files[0]
        uri = urlsplit(item.get_uri())
        if uri.scheme != "file" or uri.netloc:
            return []
        path = os.path.normpath(unquote(uri.path))
        refresh_mounts()
        for mount in mounts:
            if path.startswith(mount + os.sep):
                relative = os.path.relpath(path, mount)
                if relative in ("Compartilhados comigo", "Drives compartilhados"):
                    return []
                break
        else:
            return []
        root = Files.MenuItem(name="OpenGdrive::menu", label="GCP-Drive", tip="Ações do Google Drive", icon="gcp-drive")
        menu = Files.Menu()
        actions = list(MENU)
        if item.is_directory():
            actions.extend((
                ("upload", "Enviar arquivo para esta pasta"),
                ("pin", "Manter esta pasta off-line"),
                ("unpin", "Deixar de manter off-line"),
            ))
        else:
            actions.extend((
                ("pin", "Disponibilizar off-line"),
                ("offline-open", "Abrir pasta da cópia off-line"),
                ("unpin", "Remover cópia off-line"),
            ))
        for action, title in actions:
            entry = Files.MenuItem(name="OpenGdrive::" + action, label=title, tip=title, icon="gcp-drive")
            entry.connect("activate", lambda _item, operation=action: subprocess.Popen([UI, "--context", operation, path], close_fds=True))
            menu.append_item(entry)
        root.set_submenu(menu)
        return [root]
