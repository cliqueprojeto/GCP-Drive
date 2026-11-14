import os
import tempfile
from pathlib import Path
from xml.dom import Node, minidom
from xml.parsers.expat import ExpatError

OWNER = "org.gcpdrive.Desktop"
BOOKMARK = "http://www.freedesktop.org/standards/desktop-bookmarks"


def elements(parent, tag):
    return [node for node in parent.childNodes
            if node.nodeType == Node.ELEMENT_NODE and node.tagName == tag]


def owned_id(bookmark):
    for info in elements(bookmark, "info"):
        for metadata in elements(info, "metadata"):
            if metadata.getAttribute("owner") == OWNER:
                return metadata.getAttribute("account")
    return ""


def update_places(rows, data_home):
    """Register each mounted account in Dolphin's shared Places file."""
    path = data_home / "user-places.xbel"
    try:
        original = path.read_bytes()
    except FileNotFoundError:
        original = None
    wanted = {}
    for row in rows:
        if not row["Mounted"]:
            continue
        wanted[row["ID"]] = (Path(row["Path"]).as_uri(), row["Email"], "gcp-drive")
    if not wanted and original is None:
        return
    try:
        xml = minidom.parseString(original if original is not None else
                                  '<xbel version="1.0" xmlns:bookmark="' + BOOKMARK + '"/>')
    except ExpatError as error:
        raise ValueError("Os Locais do Dolphin não puderam ser lidos.") from error
    root = xml.documentElement
    if root.tagName != "xbel":
        raise ValueError("O arquivo de Locais do Dolphin tem um formato desconhecido.")
    bookmarks = elements(root, "bookmark")
    unmanaged_urls = {node.getAttribute("href") for node in bookmarks if not owned_id(node)}
    changed = False
    for node in bookmarks:
        identifier = owned_id(node)
        if not identifier:
            continue
        target = wanted.pop(identifier, None)
        if target is None or target[0] in unmanaged_urls:
            root.removeChild(node)
            changed = True
            continue
        href, title, _ = target
        labels = elements(node, "title")
        current_title = "".join(child.data for child in labels[0].childNodes
                                if child.nodeType == Node.TEXT_NODE) if labels else ""
        if node.getAttribute("href") != href or current_title != title:
            node.setAttribute("href", href)
            if labels:
                node.removeChild(labels[0])
            element = xml.createElement("title")
            element.appendChild(xml.createTextNode(title))
            node.insertBefore(element, node.firstChild)
            changed = True
    for identifier, (href, title, icon_name) in wanted.items():
        if href in unmanaged_urls:
            continue
        node = xml.createElement("bookmark")
        node.setAttribute("href", href)
        label = xml.createElement("title")
        label.appendChild(xml.createTextNode(title))
        node.appendChild(label)
        info = xml.createElement("info")
        native = xml.createElement("metadata")
        native.setAttribute("owner", "http://freedesktop.org")
        icon = xml.createElementNS(BOOKMARK, "bookmark:icon")
        icon.setAttribute("xmlns:bookmark", BOOKMARK)
        icon.setAttribute("name", icon_name)
        native.appendChild(icon)
        info.appendChild(native)
        kde = xml.createElement("metadata")
        kde.setAttribute("owner", "http://www.kde.org")
        stable_id = xml.createElement("ID")
        stable_id.appendChild(xml.createTextNode("gcp-drive-" + identifier))
        kde.appendChild(stable_id)
        info.appendChild(kde)
        managed = xml.createElement("metadata")
        managed.setAttribute("owner", OWNER)
        managed.setAttribute("account", identifier)
        info.appendChild(managed)
        node.appendChild(info)
        root.appendChild(node)
        changed = True
    if not changed:
        return
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if original is not None:
        backup = path.with_suffix(".xbel.gcp-drive.bak")
        try:
            with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as file:
                file.write(original)
        except FileExistsError:
            pass
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".gcp-drive-", delete=False) as file:
            temporary = Path(file.name)
            file.write(xml.toxml(encoding="utf-8"))
        try:
            current = path.read_bytes()
        except FileNotFoundError:
            current = None
        if current != original:
            raise ValueError("Os Locais do Dolphin foram editados. O GCP-Drive tentará novamente.")
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
