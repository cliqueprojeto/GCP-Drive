import json
import os
import socket
import subprocess
import time
from urllib.parse import unquote, urlsplit

import gi
from gi.repository import GLib, GObject

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
# The marks the Windows Explorer shows: only in the cloud, on this computer, kept off-line, sending.
EMBLEMS = {
    "cloud": "gcp-drive-emblem-cloud",
    "local": "gcp-drive-emblem-local",
    "offline": "gcp-drive-emblem-offline",
    "sync": "gcp-drive-emblem-sync",
}
STATE_AGE = 3

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


def local_path(item):
    uri = urlsplit(item.get_uri())
    if uri.scheme != "file" or uri.netloc:
        return None
    return os.path.normpath(unquote(uri.path))


def account_of(path):
    refresh_mounts()
    for mount in mounts:
        if path.startswith(mount + os.sep):
            return mount
    return None


def socket_path():
    runtime = os.environ.get("XDG_RUNTIME_DIR")
    if runtime:
        return os.path.join(runtime, "gcp-drive.sock")
    data = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local/share")
    return os.path.join(data, "opengdrive", "control.sock")


def folder_states(folder):
    """Asks the service for the state of each name in a folder; None when it does not answer."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(0.5)
            conn.connect(socket_path())
            conn.sendall(json.dumps({"Args": ["states", folder]}).encode() + b"\n")
            data = b""
            while not data.endswith(b"\n"):
                chunk = conn.recv(65536)
                if not chunk:
                    break
                data += chunk
        reply = json.loads(data)
        if reply.get("Err"):
            return None
        return json.loads(reply.get("Out") or "{}")
    except (OSError, ValueError):
        return None


class OpenGdrive(GObject.GObject, Files.MenuProvider, Files.InfoProvider):
    def __init__(self):
        super().__init__()
        self.folders = {}  # folder -> (time, states)
        self.watched = {}  # folder -> {name: file item}
        GLib.timeout_add_seconds(STATE_AGE, self.follow)

    def states_of(self, folder):
        now = time.monotonic()
        cached = self.folders.get(folder)
        if cached and now - cached[0] < STATE_AGE:
            return cached[1]
        states = folder_states(folder)
        if states is None:
            states = cached[1] if cached else {}
        self.folders[folder] = (now, states)
        return states

    def update_file_info(self, item):
        path = local_path(item)
        if not path or not account_of(path):
            return
        folder, name = os.path.split(path)
        state = self.states_of(folder).get(name)
        self.watched.setdefault(folder, {})[name] = item
        if state in EMBLEMS:
            item.add_emblem(EMBLEMS[state])

    def follow(self):
        """Marks change while a folder is shown: an upload ends, a file finishes downloading."""
        for folder in list(self.watched):
            items = self.watched[folder]
            old = self.folders.get(folder, (0, {}))[1]
            states = folder_states(folder)
            if states is None:
                continue
            self.folders[folder] = (time.monotonic(), states)
            for name, item in list(items.items()):
                if old.get(name) != states.get(name):
                    item.invalidate_extension_info()
            if len(self.watched) > 8:
                self.watched.pop(folder, None)
                self.folders.pop(folder, None)
        return GLib.SOURCE_CONTINUE

    def get_file_items(self, *args):
        files = args[-1]
        if len(files) != 1:
            return []
        item = files[0]
        path = local_path(item)
        mount = account_of(path) if path else None
        if not mount:
            return []
        relative = os.path.relpath(path, mount)
        if relative in ("Compartilhados comigo", "Drives compartilhados"):
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
