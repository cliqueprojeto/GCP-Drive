//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"gcpdrive/cfapi"

	"golang.org/x/sys/windows"
)

// providerID identifies GCP-Drive to the Cloud Files platform.
var providerID = windows.GUID{Data1: 0x6f2a7c11, Data2: 0x3d5e, Data3: 0x4b8a, Data4: [8]byte{0x9c, 0x41, 0x2e, 0x77, 0x51, 0xa0, 0xd3, 0x08}}

// reconcileDelay groups remote changes before they are written to the folder.
var reconcileDelay = 2 * time.Second

// offlineInCache: files kept on this device hold their content themselves, so the cache is not filled for them.
const offlineInCache = false

// folderState is a folder of the account whose whole listing is on disk.
type folderState struct {
	// Dir is the Drive folder shown there.
	Dir string
	// Seen maps each item found there to the name it had: what tells a removal on this computer
	// from an arrival in the Drive, and a local rename from a remote one.
	Seen map[string]string
}

// platform is the Cloud Files sync root of one account. Folders are filled when first opened and
// compared with the Drive afterwards, in both directions; see sync_windows.go.
type platform struct {
	conn   *cfapi.Connection
	root   string // the account's folder in its long form
	prefix string // the root as callbacks name it: without the volume
	ctx    context.Context
	cancel context.CancelFunc
	watch  windows.Handle

	mu         sync.Mutex
	populated  map[string]*folderState // by folder path relative to the root, in lower case
	changed    bool
	dirty      map[string]bool      // Drive folders whose listing changed
	local      map[string]time.Time // folders that changed on disk, and when to look at them
	superseded map[string][2]int64  // files whose local content went to the Drive as a conflict copy: size and time
	gone       map[string]time.Time // entries missing from their folder, and since when
	keeping    map[string]bool      // files being downloaded whole because they are kept on this device
	slots      chan struct{}        // bounds those downloads
	readers    map[*cfile]*reader
	fetches    map[int64][]*fetchJob
}

type fetchJob struct {
	off, end int64
	cancel   context.CancelFunc
}

// relKey names a folder in the platform's tables; NTFS does not tell upper from lower case.
func relKey(rel string) string { return strings.ToLower(strings.Trim(rel, `\`)) }

// identityOf is what the platform hands back with every request about an entry: its kind, the item
// whose bytes or children it shows, the listed item and the version of the content it stands for.
func identityOf(e entry) []byte {
	return []byte(string("dfl"[e.Kind]) + "|" + e.Content.ID + "|" + e.It.ID + "|" + e.Content.MD5)
}

func parseIdentity(b []byte) (kind int, content, id, version string, ok bool) {
	parts := strings.SplitN(string(b), "|", 4)
	if len(parts) < 3 || len(parts[0]) != 1 {
		return 0, "", "", "", false
	}
	if len(parts) == 4 {
		version = parts[3]
	}
	kind = strings.Index("dfl", parts[0])
	return kind, parts[1], parts[2], version, kind >= 0
}

// linkContent is the Internet shortcut that opens a Google editors document in the browser.
func linkContent(it *Item) []byte {
	return []byte("[InternetShortcut]\r\nURL=" + linkOf(it) + "\r\n")
}

func placeholderOf(e entry) cfapi.Placeholder {
	p := cfapi.Placeholder{Name: e.Name, Identity: identityOf(e), Dir: e.Kind == kindDir, InSync: true}
	if e.Content.MTime > 0 {
		p.Modified = time.Unix(e.Content.MTime, 0)
	}
	switch e.Kind {
	case kindFile:
		p.Size = e.Content.Size
	case kindLink:
		p.Size = int64(len(linkContent(e.Content)))
	}
	return p
}

// shellID names the account's folder to the Explorer: provider, Windows user and account.
func (m *Mount) shellID() string {
	sid := "S-1-0-0"
	if user, err := windows.GetCurrentProcessToken().GetTokenUser(); err == nil {
		sid = user.User.Sid.String()
	}
	return "GCP-Drive!" + sid + "!" + m.a.ID
}

func (m *Mount) populatedPath() string { return filepath.Join(dataDir(), "pastas", m.a.ID+".json") }

// attach registers the account's folder as a sync root and starts answering the platform.
func (m *Mount) attach() error {
	if err := cfapi.Available(); err != nil {
		return errors.New("Este Windows não tem o recurso de arquivos sob demanda (Cloud Files). É necessário o Windows 10 versão 1809 ou mais recente.")
	}
	if err := os.MkdirAll(m.path, 0o700); err != nil {
		return err
	}
	root := longPath(m.path)
	// Registered with the Explorer, the folder gets its entry in the navigation pane, state icons and the
	// commands to keep files on this device or free their space. Storage Sense may free files not used for long.
	shell := cfapi.RegisterShell(cfapi.ShellRoot{ID: m.shellID(), Path: root, DisplayName: "GCP-Drive – " + m.a.Email, Icon: iconPath(),
		Version: version, Context: []byte(m.a.ID), Hydration: cfapi.HydrationPartial, HydrationModifier: cfapi.HydrationModifierAutoDehydration})
	if shell != nil {
		// Without the Explorer's part the folder still works; only the icons and commands are missing.
		m.problem("Integrar ao Explorer", m.a.Email, shell)
		reg := cfapi.Root{Path: root, Provider: "GCP-Drive", Version: version, Identity: []byte(m.a.ID), ProviderID: providerID,
			Hydration: cfapi.HydrationPartial, Population: cfapi.PopulationPartial}
		if err := cfapi.Register(reg); err != nil {
			reg.Flags = cfapi.RegisterUpdate
			if err := cfapi.Register(reg); err != nil {
				return errors.New("O Windows não aceitou a pasta desta conta como pasta sob demanda: " + err.Error())
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.plat.mu.Lock()
	m.plat.ctx, m.plat.cancel = ctx, cancel
	m.plat.root, m.plat.prefix = root, strings.TrimPrefix(root, filepath.VolumeName(root))
	m.plat.populated, m.plat.dirty = map[string]*folderState{}, map[string]bool{}
	m.plat.local, m.plat.superseded = map[string]time.Time{}, map[string][2]int64{}
	m.plat.gone, m.plat.keeping = map[string]time.Time{}, map[string]bool{}
	if m.plat.slots == nil {
		m.plat.slots = make(chan struct{}, 2)
	}
	m.plat.readers, m.plat.fetches = map[*cfile]*reader{}, map[int64][]*fetchJob{}
	_ = readJSON(m.populatedPath(), &m.plat.populated)
	m.plat.mu.Unlock()
	m.meta.onChange = m.remoteChanged
	conn, err := cfapi.Connect(root, cfapi.Callbacks{FetchPlaceholders: m.fetchPlaceholders, FetchData: m.fetchData, CancelFetchData: m.cancelFetch})
	if err != nil {
		cancel()
		return errors.New("Não foi possível ligar a pasta desta conta ao GCP-Drive: " + err.Error())
	}
	m.plat.mu.Lock()
	m.plat.conn = conn
	m.plat.mu.Unlock()
	if p, err := windows.UTF16PtrFromString(root); err == nil {
		// Without the watcher, changes made on this computer are still found when the service starts.
		handle, err := windows.CreateFile(p, windows.FILE_LIST_DIRECTORY, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
			nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
		if err == nil {
			m.plat.watch = handle
			go m.watcher(ctx, handle)
		} else {
			m.problem("Acompanhar pasta", m.a.Email, err)
		}
	}
	go m.reconciler(ctx)
	return nil
}

// detach stops answering. The folder and what was already downloaded stay on disk.
func (m *Mount) detach() {
	m.plat.mu.Lock()
	conn, cancel := m.plat.conn, m.plat.cancel
	m.plat.conn, m.plat.cancel = nil, nil
	m.plat.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if m.plat.watch != 0 {
		_ = windows.CancelIoEx(m.plat.watch, nil)
		_ = windows.CloseHandle(m.plat.watch)
		m.plat.watch = 0
	}
	if conn != nil {
		_ = conn.Close()
	}
	m.savePopulated()
}

// forget takes the account's folder out of the Explorer. Copies of what the Drive has are removed;
// files that never reached the Drive, or changed since, stay as ordinary files in the folder.
func (m *Mount) forget() {
	root := longPath(m.path)
	// Connected as the provider, this process sees the folder as it is on disk, without being asked to fill it.
	conn, _ := cfapi.Connect(root, cfapi.Callbacks{})
	empty := m.prune(root)
	if conn != nil {
		_ = conn.Close()
	}
	if cfapi.UnregisterShell(m.shellID()) != nil {
		_ = cfapi.Unregister(root)
	}
	os.Remove(m.populatedPath())
	if empty {
		os.Remove(root)
	}
}

// prune empties a folder of what is only a copy of the Drive and reports whether nothing is left.
func (m *Mount) prune(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	empty := true
	for _, e := range entries {
		full := filepath.Join(path, e.Name())
		info, err := e.Info()
		state, serr := cfapi.Stat(full)
		if err != nil || serr != nil {
			empty = false
			continue
		}
		if e.IsDir() {
			if m.prune(full) && os.Remove(full) == nil {
				continue
			}
		} else if state.Placeholder {
			// Without content there is nothing to lose; with content, it must be the version the Drive has.
			copyOfDrive := attributes(info)&attributeRecallOnDataAccess != 0
			if _, content, _, version, ok := parseIdentity(state.Identity); ok && !copyOfDrive && state.InSync {
				it := m.meta.item(content)
				copyOfDrive = it != nil && !it.Local && version == it.MD5 && sameContent(info, it)
			}
			if copyOfDrive && os.Remove(full) == nil {
				continue
			}
		}
		empty = false
		if state.Placeholder {
			_ = withHandle(full, cfapi.Revert)
		}
	}
	return empty
}

func (m *Mount) savePopulated() {
	m.plat.mu.Lock()
	changed := m.plat.changed
	m.plat.changed = false
	var data []byte
	if changed {
		data, _ = json.Marshal(m.plat.populated)
	}
	m.plat.mu.Unlock()
	if data != nil {
		_ = writePrivate(m.populatedPath(), data)
	}
}

// longPath replaces 8.3 short names (RUNNER~1) in an existing path by the real ones.
func longPath(path string) string {
	if p, err := windows.UTF16PtrFromString(path); err == nil {
		buf := make([]uint16, 4096)
		if n, err := windows.GetLongPathName(p, &buf[0], uint32(len(buf))); err == nil && n > 0 && int(n) < len(buf) {
			return windows.UTF16ToString(buf[:n])
		}
	}
	return path
}

// relative turns the path of a callback into one relative to the account's folder.
// The platform repeats the path as the program that opened it wrote it, short names included.
func (m *Mount) relative(path string) (string, bool) {
	prefix := m.plat.prefix
	if len(path) < len(prefix) || !strings.EqualFold(path[:len(prefix)], prefix) {
		volume := filepath.VolumeName(m.plat.root)
		path = strings.TrimPrefix(longPath(volume+path), volume)
		if len(path) < len(prefix) || !strings.EqualFold(path[:len(prefix)], prefix) {
			return "", false
		}
	}
	return strings.Trim(path[len(prefix):], `\`), true
}

const statusCloudFileUnsuccessful = int32(-1073688821) // 0xC000CF0B, network unavailable

// fetchPlaceholders fills a folder the first time a program opens it.
func (m *Mount) fetchPlaceholders(r *cfapi.Request, _ string) {
	go func() {
		ctx, cancel := context.WithTimeout(m.plat.ctx, 50*time.Second)
		defer cancel()
		dir := vRoot
		if len(r.Identity) > 0 {
			kind, content, _, _, ok := parseIdentity(r.Identity)
			if !ok || kind != kindDir {
				_ = r.FailPlaceholders(cfapi.StatusUnsuccessful)
				return
			}
			dir = content
		}
		// The root's entries are known once the account answered for the first time.
		for dir == vRoot && ctx.Err() == nil {
			m.meta.mu.RLock()
			ready := m.meta.RootID != ""
			m.meta.mu.RUnlock()
			if ready {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		err := ctx.Err()
		if err == nil {
			err = m.meta.ensure(ctx, m.drive, dir)
		}
		if err != nil {
			m.problem("Listar pasta", filepath.Base(r.Path), err)
			_ = r.FailPlaceholders(statusCloudFileUnsuccessful)
			return
		}
		var list []cfapi.Placeholder
		for _, e := range m.meta.listing(dir) {
			// What is still on its way to the Drive is already here as an ordinary file.
			if !e.It.Local {
				list = append(list, placeholderOf(e))
			}
		}
		const batch = 2000
		for first := 0; ; first += batch {
			last := min(first+batch, len(list))
			if err := r.TransferPlaceholders(list[first:last], len(list), last == len(list)); err != nil {
				if err != cfapi.ErrCanceled {
					m.problem("Listar pasta", filepath.Base(r.Path), err)
				}
				return
			}
			if last == len(list) {
				break
			}
		}
		rel, ok := m.relative(r.Path)
		if !ok {
			m.problem("Listar pasta", r.Path, errors.New("O Windows informou um caminho fora da pasta desta conta."))
			return
		}
		m.plat.mu.Lock()
		if st := m.plat.populated[relKey(rel)]; st == nil || st.Dir != dir {
			m.plat.populated[relKey(rel)], m.plat.changed = &folderState{Dir: dir, Seen: map[string]string{}}, true
		}
		// The next comparison records what arrived and writes what changed while the listing was on its way.
		m.plat.dirty[dir] = true
		m.plat.mu.Unlock()
	}()
}

// fetchData delivers a range of a file from the block cache, downloading what is missing.
func (m *Mount) fetchData(r *cfapi.Request, offset, length int64) {
	ctx, cancel := context.WithCancel(m.plat.ctx)
	job := &fetchJob{off: offset, end: offset + length, cancel: cancel}
	m.plat.mu.Lock()
	m.plat.fetches[r.Transfer()] = append(m.plat.fetches[r.Transfer()], job)
	m.plat.mu.Unlock()
	go func() {
		defer func() {
			cancel()
			m.plat.mu.Lock()
			jobs := m.plat.fetches[r.Transfer()]
			for i, j := range jobs {
				if j == job {
					jobs = append(jobs[:i], jobs[i+1:]...)
					break
				}
			}
			if len(jobs) == 0 {
				delete(m.plat.fetches, r.Transfer())
			} else {
				m.plat.fetches[r.Transfer()] = jobs
			}
			m.plat.mu.Unlock()
		}()
		kind, content, _, _, ok := parseIdentity(r.Identity)
		it := m.meta.item(content)
		if !ok || kind == kindDir || it == nil {
			_ = r.FailData(offset, length, cfapi.StatusUnsuccessful)
			return
		}
		read := func(p []byte, off int64) (int, error) { return 0, nil }
		size := it.Size
		if kind == kindLink {
			data := linkContent(it)
			size = int64(len(data))
			read = func(p []byte, off int64) (int, error) { return copy(p, data[off:]), nil }
		} else {
			file := m.cache.file(it)
			// One read pattern per file: the platform asks in small pieces, the cache answers ahead of them.
			m.plat.mu.Lock()
			if len(m.plat.readers) > 512 {
				m.plat.readers = map[*cfile]*reader{}
			}
			rd := m.plat.readers[file]
			if rd == nil {
				rd = &reader{}
				m.plat.readers[file] = rd
			}
			m.plat.mu.Unlock()
			read = func(p []byte, off int64) (int, error) { return file.ReadAt(ctx, p, off, rd, prioInteractive) }
		}
		end := min(offset+length, size)
		buf := make([]byte, chunkSize)
		for off := offset; off < end; {
			n, err := read(buf[:min(int64(len(buf)), end-off)], off)
			if err == nil && n == 0 {
				err = errors.New("O arquivo mudou no Google Drive durante a leitura.")
			}
			if err == nil && int64(n) < end-off {
				// Whole 4 KiB pages, except at the end of the file.
				n -= n % 4096
				if n == 0 {
					continue
				}
			}
			if err != nil {
				if ctx.Err() == nil {
					m.problem("Ler do Drive", it.Name, err)
				}
				_ = r.FailData(off, offset+length-off, statusCloudFileUnsuccessful)
				return
			}
			if err := r.TransferData(buf[:n], off); err != nil {
				if err != cfapi.ErrCanceled {
					m.problem("Ler do Drive", it.Name, err)
				}
				return
			}
			off += int64(n)
			if off < end {
				_ = r.Progress(end-offset, off-offset)
			}
		}
	}()
}

// cancelFetch stops waiting for ranges nobody is reading anymore; blocks already requested still reach the cache.
func (m *Mount) cancelFetch(r *cfapi.Request, offset, length int64) {
	m.plat.mu.Lock()
	defer m.plat.mu.Unlock()
	for _, job := range m.plat.fetches[r.Transfer()] {
		if job.off < offset+length && offset < job.end {
			job.cancel()
		}
	}
}

// remoteChanged notes the populated folders whose listing changed in the Drive.
func (m *Mount) remoteChanged(dirs []string, _ string) {
	m.plat.mu.Lock()
	defer m.plat.mu.Unlock()
	if m.plat.dirty == nil {
		return
	}
	for _, dir := range dirs {
		m.plat.dirty[dir] = true
	}
}

func attributes(info os.FileInfo) uint32 {
	if data, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return data.FileAttributes
	}
	return 0
}
