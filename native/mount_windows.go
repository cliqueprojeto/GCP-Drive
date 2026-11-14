//go:build windows

package main

import (
	"context"
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

// platform is the Cloud Files sync root of one account. Folders are filled when first opened;
// populated remembers which ones exist on disk so remote changes can be written into them.
type platform struct {
	conn   *cfapi.Connection
	root   string // the account's folder in its long form
	prefix string // the root as callbacks name it: without the volume
	ctx    context.Context
	cancel context.CancelFunc

	mu        sync.Mutex
	populated map[string]string // folder path relative to the root → Drive folder shown there
	changed   bool
	dirty     map[string]bool // Drive folders whose listing changed
	readers   map[*cfile]*reader
	fetches   map[int64][]*fetchJob
}

type fetchJob struct {
	off, end int64
	cancel   context.CancelFunc
}

// identityOf is what the platform hands back with every request about an entry:
// its kind, the item whose bytes or children it shows, and the listed item.
func identityOf(e entry) []byte {
	return []byte(string("dfl"[e.Kind]) + "|" + e.Content.ID + "|" + e.It.ID)
}

func parseIdentity(b []byte) (kind int, content, id string, ok bool) {
	parts := strings.SplitN(string(b), "|", 3)
	if len(parts) != 3 || len(parts[0]) != 1 {
		return 0, "", "", false
	}
	kind = strings.Index("dfl", parts[0])
	return kind, parts[1], parts[2], kind >= 0
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

func (m *Mount) populatedPath() string { return filepath.Join(dataDir(), "pastas", m.a.ID+".json") }

// attach registers the account's folder as a sync root and starts answering the platform.
func (m *Mount) attach() error {
	if err := cfapi.Available(); err != nil {
		return errors.New("Este Windows não tem o recurso de arquivos sob demanda (Cloud Files). É necessário o Windows 10 versão 1809 ou mais recente.")
	}
	if err := os.MkdirAll(m.path, 0o700); err != nil {
		return err
	}
	root := m.path
	if p, err := windows.UTF16PtrFromString(root); err == nil {
		buf := make([]uint16, 1024)
		if n, err := windows.GetLongPathName(p, &buf[0], uint32(len(buf))); err == nil && n > 0 && int(n) < len(buf) {
			root = windows.UTF16ToString(buf[:n])
		}
	}
	reg := cfapi.Root{Path: root, Provider: "GCP-Drive", Version: version, Identity: []byte(m.a.ID), ProviderID: providerID,
		Hydration: cfapi.HydrationPartial, Population: cfapi.PopulationPartial}
	if err := cfapi.Register(reg); err != nil {
		reg.Flags = cfapi.RegisterUpdate
		if err := cfapi.Register(reg); err != nil {
			return errors.New("O Windows não aceitou a pasta desta conta como pasta sob demanda: " + err.Error())
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.plat.mu.Lock()
	m.plat.ctx, m.plat.cancel = ctx, cancel
	m.plat.root, m.plat.prefix = root, strings.TrimPrefix(root, filepath.VolumeName(root))
	m.plat.populated, m.plat.dirty = map[string]string{}, map[string]bool{}
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
	if conn != nil {
		_ = conn.Close()
	}
	m.savePopulated()
}

// forget removes the folder of a disconnected account, unless it holds files that never reached the Drive.
func (m *Mount) forget() {
	_ = cfapi.Unregister(m.path)
	os.Remove(m.populatedPath())
	if onlyPlaceholders(m.path) {
		os.RemoveAll(m.path)
	}
}

func (m *Mount) savePopulated() {
	m.plat.mu.Lock()
	changed := m.plat.changed
	m.plat.changed = false
	copy := make(map[string]string, len(m.plat.populated))
	for k, v := range m.plat.populated {
		copy[k] = v
	}
	m.plat.mu.Unlock()
	if changed {
		_ = writeJSON(m.populatedPath(), copy)
	}
}

// relative turns the path of a callback into one relative to the account's folder.
func (m *Mount) relative(path string) (string, bool) {
	prefix := m.plat.prefix
	if len(path) < len(prefix) || !strings.EqualFold(path[:len(prefix)], prefix) {
		return "", false
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
			kind, content, _, ok := parseIdentity(r.Identity)
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
		entries := m.meta.listing(dir)
		list := make([]cfapi.Placeholder, len(entries))
		for i, e := range entries {
			list[i] = placeholderOf(e)
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
		m.plat.populated[rel], m.plat.changed = dir, true
		// What changed while the listing was on its way is written by the next reconciliation.
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
		kind, content, _, ok := parseIdentity(r.Identity)
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

func (m *Mount) reconciler(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(reconcileDelay):
		}
		m.plat.mu.Lock()
		work := map[string]string{}
		for rel, dir := range m.plat.populated {
			if m.plat.dirty[dir] {
				work[rel] = dir
			}
		}
		m.plat.dirty = map[string]bool{}
		m.plat.mu.Unlock()
		for rel, dir := range work {
			m.reconcile(rel, dir)
		}
		m.savePopulated()
	}
}

func attributes(info os.FileInfo) uint32 {
	if data, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return data.FileAttributes
	}
	return 0
}

// onlyPlaceholders reports whether everything under path came from the Drive.
func onlyPlaceholders(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || attributes(info)&windows.FILE_ATTRIBUTE_REPARSE_POINT == 0 {
			return false
		}
		if e.IsDir() && !onlyPlaceholders(filepath.Join(path, e.Name())) {
			return false
		}
	}
	return true
}

// reconcile writes the Drive's current listing of a folder into its populated copy on disk:
// new entries appear, removed ones go away and changed files give up their old content.
// Files that are not placeholders were created on this computer and are left alone.
func (m *Mount) reconcile(rel, dir string) {
	path := filepath.Join(m.plat.root, rel)
	// The provider's own process sees the folder as it is on disk, without asking itself to fill it.
	onDisk, err := os.ReadDir(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			m.plat.mu.Lock()
			delete(m.plat.populated, rel)
			m.plat.changed = true
			m.plat.mu.Unlock()
		}
		return
	}
	want := map[string]entry{}
	for _, e := range m.meta.listing(dir) {
		want[nameKey(e.Name)] = e
	}
	for _, d := range onDisk {
		key := nameKey(d.Name())
		e, keep := want[key]
		delete(want, key)
		info, err := d.Info()
		if err != nil || attributes(info)&windows.FILE_ATTRIBUTE_REPARSE_POINT == 0 {
			continue
		}
		full := filepath.Join(path, d.Name())
		switch {
		case !keep:
			if !d.IsDir() {
				err = os.Remove(full)
			} else if onlyPlaceholders(full) {
				err = os.RemoveAll(full)
				m.plat.mu.Lock()
				sub := filepath.Join(rel, d.Name())
				for known := range m.plat.populated {
					if known == sub || strings.HasPrefix(known, sub+`\`) {
						delete(m.plat.populated, known)
						m.plat.changed = true
					}
				}
				m.plat.mu.Unlock()
			}
			if err != nil {
				m.problem("Atualizar pasta", d.Name(), err)
			}
		case d.IsDir() || e.Kind == kindDir:
		default:
			p := placeholderOf(e)
			if info.Size() == p.Size && (p.Modified.IsZero() || info.ModTime().Unix() == p.Modified.Unix()) {
				continue
			}
			handle, err := cfapi.Open(full)
			if err == nil {
				err = cfapi.Update(handle, p.Size, p.Modified, p.Identity)
				windows.CloseHandle(handle)
			}
			if err != nil {
				m.problem("Atualizar arquivo", d.Name(), err)
			}
		}
	}
	if len(want) == 0 {
		return
	}
	list := make([]cfapi.Placeholder, 0, len(want))
	for _, e := range want {
		list = append(list, placeholderOf(e))
	}
	if err := cfapi.CreatePlaceholders(path, list); err != nil {
		m.problem("Atualizar pasta", filepath.Base(path), err)
	}
	for _, p := range list {
		if p.Err != nil {
			m.problem("Atualizar pasta", p.Name, p.Err)
		}
	}
}
