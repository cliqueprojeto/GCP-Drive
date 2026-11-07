# GCP-Drive owned extension: local metadata only; never access cloud files in the shell.
import json, os, subprocess, time
from gi.repository import GObject, Gio, GLib
import gi
if '/nemo-python/' not in __file__:
    gi.require_version('Nautilus', '4.0')
    from gi.repository import Nautilus as Files
else:
    gi.require_version('Nemo', '3.0')
    from gi.repository import Nemo as Files

MANIFEST = os.path.join(os.environ.get('XDG_STATE_HOME', os.path.expanduser('~/.local/state')), 'gcp-drive', 'shell.json')
_state, _read_at = {}, 0
def state():
    global _state, _read_at
    now = time.monotonic()
    if now - _read_at < 1:
        return _state
    _read_at = now
    try:
        with open(MANIFEST, encoding='utf-8') as file:
            data = file.read(8388609)
        if len(data) > 8388608:
            raise ValueError('manifest too large')
        parsed = json.loads(data)
        _state = parsed if time.time() - parsed.get('timestamp', 0) < 15 else {}
    except (OSError, ValueError, TypeError):
        _state = {}
    return _state

def owned_path(uri):
    target = Gio.File.new_for_uri(uri).get_path()
    if not target:
        return None
    for root in state().get('roots', []):
        try:
            if os.path.commonpath([target, root]) == root:
                return target
        except ValueError:
            pass
    return None

# States are interpreted by GCP-Drive from the engine cache; this extension only maps them to emblems.
TRANSFER_EMBLEMS = {'queued': 'emblem-synchronizing', 'transferring': 'emblem-synchronizing', 'waiting': 'emblem-synchronizing', 'problem': 'emblem-important', 'complete': 'emblem-default'}
CACHE_EMBLEMS = {'local': 'emblem-default', 'pending': 'emblem-synchronizing', 'partial': 'emblem-web', 'cloud': 'emblem-web'}
def emblem_for(target):
    current = state()
    transfer = current.get('status', {}).get(target)
    if transfer in TRANSFER_EMBLEMS:
        return TRANSFER_EMBLEMS[transfer]
    cached = current.get('cache', {}).get(target)
    if cached is None:
        for root in current.get('complete', []):
            try:
                if os.path.commonpath([target, root]) == root:
                    cached = 'cloud'
                    break
            except ValueError:
                pass
    return CACHE_EMBLEMS.get(cached)

class GCPDrive(GObject.GObject, Files.MenuProvider, Files.InfoProvider):
    def __init__(self):
        super().__init__()
        self.files = {}
        self.previous_status = {}
        GLib.timeout_add_seconds(3, self.refresh_status)

    def refresh_status(self):
        current = {}
        for uri in self.files:
            target = owned_path(uri)
            if target:
                current[target] = emblem_for(target)
        for uri, info in list(self.files.items()):
            target = Gio.File.new_for_uri(uri).get_path()
            if current.get(target) != self.previous_status.get(target):
                info.invalidate_extension_info()
        self.previous_status = current
        return True

    def get_file_items(self, *args):
        files = args[-1]
        if len(files) != 1:
            return []
        target = owned_path(files[0].get_uri())
        executable = state().get('executable')
        if not target or not executable or not os.path.isabs(executable):
            return []
        parent = Files.MenuItem(name='GCPDrive', label='GCP-Drive', tip='Ações da sua conta conectada', icon='folder-remote')
        submenu = Files.Menu()
        for action, label in [('open', 'Abrir com GCP-Drive'), ('web', 'Abrir na nuvem'), ('share', 'Compartilhar no provedor'), ('favorite', 'Fixar / desafixar nos favoritos'), ('download', 'Baixar uma cópia')]:
            item = Files.MenuItem(name='GCPDrive::'+action, label=label, tip=label)
            item.connect('activate', lambda _item, action=action: subprocess.Popen([executable, '--gcp-native-action='+action, '--gcp-native-path='+target], close_fds=True))
            submenu.append_item(item)
        parent.set_submenu(submenu)
        return [parent]

    def update_file_info(self, file):
        target = owned_path(file.get_uri())
        if target:
            if len(self.files) >= 2000:
                self.files.clear()
            self.files[file.get_uri()] = file
        emblem = emblem_for(target) if target and not file.is_directory() else None
        if emblem:
            file.add_emblem(emblem)
        return Files.OperationResult.COMPLETE
