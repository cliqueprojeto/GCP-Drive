package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Pending is a local copy with changes that still have to reach the Drive.
type Pending struct {
	Key     string
	FileID  string
	New     bool
	Parent  string
	Name    string
	BaseMD5 string
	dir     string
	refs    int
	dirty   bool
	gen     int
	closed  time.Time
	sending bool
	sent    int64
	failed  string
	retry   time.Time
	tries   int
}

func (p *Pending) data() string { return filepath.Join(p.dir, p.Key+".data") }
func (p *Pending) side() string { return filepath.Join(p.dir, p.Key+".json") }

type Activity struct {
	ID, Action, Name, Status, Detail string
	At                               time.Time
}

type Mount struct {
	a     *Account
	set   *Settings
	sched *Sched
	drive *Drive
	meta  *Meta
	cache *Cache
	path  string
	// plat is how this system shows the account as a folder; see mount_<system>.go.
	plat platform

	mu       sync.Mutex
	pend     map[string]*Pending
	ids      []string
	pins     map[string]bool
	activity []Activity
	problems map[string]string
	mountErr string
	usage    int64
	limit    int64
	quotaAt  time.Time
	cancel   context.CancelFunc
	on       bool
}

func newMount(a *Account, set *Settings, sched *Sched) *Mount {
	m := &Mount{a: a, set: set, sched: sched, path: filepath.Join(mountRoot(), a.Email),
		pend: map[string]*Pending{}, pins: map[string]bool{}, problems: map[string]string{}}
	m.drive = newDrive(a, sched)
	m.meta = newMeta(filepath.Join(dataDir(), "mapa", a.ID+".v2.gob.gz"))
	m.cache = newCache(filepath.Join(cacheRoot(), a.ID), m.drive, set, func(id string) bool {
		m.mu.Lock()
		defer m.mu.Unlock()
		for pin := range m.pins {
			if safeID(pin) == id {
				return true
			}
		}
		return false
	})
	var pins []string
	_ = readJSON(m.pinsPath(), &pins)
	for _, id := range pins {
		m.pins[id] = true
	}
	m.restorePending()
	return m
}

func (m *Mount) pendDir() string  { return filepath.Join(dataDir(), "envios", m.a.ID) }
func (m *Mount) pinsPath() string { return filepath.Join(configDir(), "offline", m.a.ID+".json") }

func (m *Mount) paused() bool { return m.set.Paused[m.a.ID] }

func (m *Mount) log(action, name, status, detail string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.activity = append([]Activity{{ID: hex.EncodeToString(b), Action: action, Name: name, Status: status, Detail: detail, At: time.Now()}}, m.activity...)
	if len(m.activity) > 60 {
		m.activity = m.activity[:60]
	}
	return m.activity[0].ID
}

func (m *Mount) update(id, status, detail string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.activity {
		if m.activity[i].ID == id {
			m.activity[i].Status, m.activity[i].Detail, m.activity[i].At = status, detail, time.Now()
		}
	}
}

// problem records a failure once per item so repeated reads do not flood the list.
func (m *Mount) problem(action, name string, err error) {
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	m.mu.Lock()
	seen := m.problems[action+name] == err.Error()
	m.problems[action+name] = err.Error()
	m.mu.Unlock()
	if !seen {
		m.log(action, name, "Falhou", err.Error())
	}
}

func (m *Mount) quota(ctx context.Context) (usage, limit int64) {
	m.mu.Lock()
	fresh := time.Since(m.quotaAt) < 5*time.Minute
	usage, limit = m.usage, m.limit
	m.mu.Unlock()
	if fresh {
		return
	}
	var about struct {
		Quota struct {
			Limit string `json:"limit"`
			Usage string `json:"usage"`
		} `json:"storageQuota"`
	}
	if m.drive.json(ctx, prioInteractive, "GET", apiBase+"/about?fields=storageQuota(limit,usage)", nil, &about) == nil {
		fmt.Sscan(about.Quota.Usage, &usage)
		limit = 0
		fmt.Sscan(about.Quota.Limit, &limit)
		m.mu.Lock()
		m.usage, m.limit, m.quotaAt = usage, limit, time.Now()
		m.mu.Unlock()
	}
	return
}

func (m *Mount) pending(id string) *Pending {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pend[id]
}

func (m *Mount) retain(p *Pending) { m.mu.Lock(); p.refs++; m.mu.Unlock() }

func (m *Mount) touch(p *Pending) { m.mu.Lock(); p.dirty = true; p.gen++; m.mu.Unlock() }

func (m *Mount) release(p *Pending) {
	m.mu.Lock()
	p.refs--
	p.closed = time.Now()
	drop := p.refs <= 0 && !p.dirty && !p.New && !p.sending
	if drop {
		delete(m.pend, p.FileID)
	}
	m.mu.Unlock()
	if drop {
		os.Remove(p.data())
		os.Remove(p.side())
	}
}

func (m *Mount) persist(p *Pending) error { return writeJSON(p.side(), p) }

func (m *Mount) restorePending() {
	entries, _ := os.ReadDir(m.pendDir())
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		p := &Pending{}
		if readJSON(filepath.Join(m.pendDir(), e.Name()), p) != nil || p.FileID == "" {
			continue
		}
		p.dir = m.pendDir()
		info, err := os.Stat(p.data())
		if err != nil {
			continue
		}
		p.dirty, p.closed = true, time.Now()
		m.pend[p.FileID] = p
		if p.New {
			m.meta.mu.Lock()
			m.meta.put(&Item{ID: p.FileID, Name: p.Name, Parents: []string{p.Parent}, Size: info.Size(), MTime: info.ModTime().Unix(), Owned: true, CanEdit: true, Local: true})
			m.meta.mu.Unlock()
		}
	}
}

func newKey() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newID returns an ID the Drive reserved, so a new file keeps one identity from creation to upload.
func (m *Mount) newID(ctx context.Context) (string, error) {
	m.mu.Lock()
	if len(m.ids) > 0 {
		id := m.ids[0]
		m.ids = m.ids[1:]
		m.mu.Unlock()
		return id, nil
	}
	m.mu.Unlock()
	var out struct {
		IDs []string `json:"ids"`
	}
	if err := m.drive.json(ctx, prioInteractive, "GET", apiBase+"/files/generateIds?count=100&space=drive", nil, &out); err != nil || len(out.IDs) == 0 {
		if err == nil {
			err = errors.New("O Google Drive não reservou um identificador para o novo arquivo.")
		}
		return "", err
	}
	m.mu.Lock()
	m.ids = append(m.ids, out.IDs[1:]...)
	m.mu.Unlock()
	return out.IDs[0], nil
}

func (m *Mount) newLocal(ctx context.Context, parent, name string) (*Item, error) {
	id, err := m.newID(ctx)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(m.pendDir(), 0o700); err != nil {
		return nil, err
	}
	p := &Pending{Key: newKey(), FileID: id, New: true, Parent: parent, Name: name, dir: m.pendDir(), dirty: true}
	if err := os.WriteFile(p.data(), nil, 0o600); err != nil {
		return nil, err
	}
	if err := m.persist(p); err != nil {
		return nil, err
	}
	it := &Item{ID: id, Name: name, Parents: []string{parent}, MTime: time.Now().Unix(), Owned: true, CanEdit: true, Local: true}
	m.mu.Lock()
	m.pend[id] = p
	m.mu.Unlock()
	m.meta.mu.Lock()
	m.meta.put(it)
	m.meta.mu.Unlock()
	return it, nil
}

// materialize returns the local copy of a file, creating it with the first keep bytes (all when keep < 0).
func (m *Mount) materialize(ctx context.Context, id string, keep int64) (*Pending, error) {
	if p := m.pending(id); p != nil {
		return p, nil
	}
	it := m.meta.item(id)
	if it == nil {
		return nil, syscall.ENOENT
	}
	if !it.CanEdit {
		return nil, syscall.EACCES
	}
	if err := os.MkdirAll(m.pendDir(), 0o700); err != nil {
		return nil, err
	}
	parent := ""
	if len(it.Parents) > 0 {
		parent = it.Parents[0]
	}
	p := &Pending{Key: newKey(), FileID: id, Parent: parent, Name: it.Name, BaseMD5: it.MD5, dir: m.pendDir()}
	file, err := os.OpenFile(p.data(), os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	if keep < 0 || keep > it.Size {
		keep = it.Size
	}
	src, r, buf := m.cache.file(it), &reader{}, make([]byte, chunkSize)
	for off := int64(0); off < keep; {
		n, err := src.ReadAt(ctx, buf[:min(int64(len(buf)), keep-off)], off, r, prioInteractive)
		if err != nil || n == 0 {
			file.Close()
			os.Remove(p.data())
			if err == nil {
				err = io.ErrUnexpectedEOF
			}
			return nil, err
		}
		if _, err := file.Write(buf[:n]); err != nil {
			file.Close()
			os.Remove(p.data())
			return nil, err
		}
		off += int64(n)
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	mtime := time.Unix(it.MTime, 0)
	_ = os.Chtimes(p.data(), mtime, mtime)
	if err := m.persist(p); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if other := m.pend[id]; other != nil {
		os.Remove(p.data())
		os.Remove(p.side())
		return other, nil
	}
	m.pend[id] = p
	return p, nil
}

// localOnly names are working files of editors; they stay on this computer.
func localOnly(name string) bool {
	return strings.HasPrefix(name, ".~lock.") || strings.HasPrefix(name, "~$") || strings.HasPrefix(name, ".goutputstream-") ||
		strings.HasPrefix(name, ".fuse_hidden") || strings.HasSuffix(name, "~") || strings.HasSuffix(name, ".part") ||
		strings.HasSuffix(name, ".swp") || strings.HasSuffix(name, ".kate-swp") || strings.HasSuffix(name, ".crdownload") ||
		(strings.HasPrefix(name, ".") && strings.HasSuffix(name, ".tmp"))
}

var writeBack = 5 * time.Second

// uploader sends closed local copies after a short delay, so save-by-rename lands as one revision.
func (m *Mount) uploader(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
		if m.paused() {
			continue
		}
		m.mu.Lock()
		var ready []*Pending
		for _, p := range m.pend {
			if p.refs <= 0 && p.dirty && !p.sending && time.Since(p.closed) >= writeBack && time.Now().After(p.retry) && !localOnly(p.Name) {
				p.sending = true
				ready = append(ready, p)
			}
		}
		m.mu.Unlock()
		for _, p := range ready {
			go m.send(ctx, p)
		}
	}
}

func (m *Mount) send(ctx context.Context, p *Pending) {
	m.mu.Lock()
	gen, name, parent, isNew, base := p.gen, p.Name, p.Parent, p.New, p.BaseMD5
	p.sent = 0
	m.mu.Unlock()
	act := m.log("Enviar para o Drive", name, "Em andamento", "")
	progress := func(n int64) { m.mu.Lock(); p.sent = n; m.mu.Unlock() }
	info, _ := os.Stat(p.data())
	meta := map[string]any{}
	if info != nil {
		meta["modifiedTime"] = info.ModTime().UTC().Format(time.RFC3339)
	}
	var f *apiFile
	var err error
	switch {
	case isNew:
		meta["id"], meta["name"], meta["parents"] = p.FileID, name, []string{parent}
		f, err = m.drive.upload(ctx, "", meta, p.data(), progress)
		var se *statusError
		if errors.As(err, &se) && se.Code == 409 {
			// An earlier attempt created the item before its answer was lost.
			f, err = m.drive.upload(ctx, p.FileID, map[string]any{}, p.data(), progress)
		}
	default:
		var current *apiFile
		current, err = m.drive.get(ctx, prioUpload, p.FileID)
		if err == nil && current.MD5 != base && base != "" {
			// Someone changed the file in the Drive meanwhile: keep both versions.
			host, _ := os.Hostname()
			ext := filepath.Ext(name)
			meta["name"] = fmt.Sprintf("%s (conflito de %s %s)%s", strings.TrimSuffix(name, ext), host, time.Now().Format("2006-01-02 15h04"), ext)
			meta["parents"] = []string{parent}
			f, err = m.drive.upload(ctx, "", meta, p.data(), progress)
			if err == nil {
				m.log("Conflito de versões", name, "Concluída", "A sua versão foi salva como “"+meta["name"].(string)+"”.")
				// The folder shows the Drive's version again; what was written here is in the copy.
				m.superseded(p.FileID, info)
				m.meta.apply(current)
			}
		} else if err == nil {
			f, err = m.drive.upload(ctx, p.FileID, meta, p.data(), progress)
		}
	}
	m.mu.Lock()
	p.sending = false
	if err != nil {
		p.tries++
		p.failed = err.Error()
		p.retry = time.Now().Add(min(time.Duration(10<<min(p.tries, 6))*time.Second, 10*time.Minute))
		m.mu.Unlock()
		m.update(act, "Falhou", err.Error()+" Nova tentativa automática em instantes.")
		return
	}
	p.failed, p.tries = "", 0
	changed := p.gen != gen || p.refs > 0
	if changed {
		// Edited again during the upload: the copy stays and goes out as the next revision.
		p.New, p.BaseMD5 = false, f.MD5
		if f.ID != p.FileID {
			p.BaseMD5 = ""
		}
		p.closed = time.Now()
	} else {
		delete(m.pend, p.FileID)
	}
	m.mu.Unlock()
	if changed {
		_ = m.persist(p)
	} else {
		os.Remove(p.data())
		os.Remove(p.side())
	}
	m.meta.apply(f)
	m.update(act, "Concluída", "")
}

// discard forgets a local copy. It waits for an upload in flight so the result is known.
func (m *Mount) discard(ctx context.Context, id string) {
	for i := 0; i < 600; i++ {
		m.mu.Lock()
		p := m.pend[id]
		if p == nil || !p.sending {
			if p != nil {
				delete(m.pend, id)
				os.Remove(p.data())
				os.Remove(p.side())
			}
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// errno gives each failure the code programs expect from a file system.
func errno(err error) syscall.Errno {
	switch e := err.(type) {
	case nil:
		return 0
	case syscall.Errno:
		return e
	case *statusError:
		switch {
		case e.Code == 404:
			return syscall.ENOENT
		case e.Code == 403 || e.Code == 401:
			return syscall.EACCES
		}
	}
	if err == context.Canceled || err == context.DeadlineExceeded {
		return syscall.EINTR
	}
	return syscall.EIO
}

// writableDir reports whether new entries may be created inside the folder dir.
func (m *Mount) writableDir(dir string) syscall.Errno {
	if readOnly() {
		return syscall.EROFS
	}
	if dir == vRoot || dir == vShared || dir == vDrives {
		return syscall.EPERM
	}
	return 0
}

func (m *Mount) removeEntry(ctx context.Context, dir, name string, wantDir bool) syscall.Errno {
	if eno := m.writableDir(dir); eno != 0 {
		return eno
	}
	_ = m.meta.ensure(ctx, m.drive, dir)
	e, ok := m.meta.find(dir, name)
	if !ok {
		return syscall.ENOENT
	}
	if (e.Kind == kindDir) != wantDir {
		if wantDir {
			return syscall.ENOTDIR
		}
		return syscall.EISDIR
	}
	if wantDir && e.It.Mime != mimeLink {
		if err := m.meta.ensure(ctx, m.drive, e.Content.ID); err != nil {
			return errno(err)
		}
		if len(m.meta.listing(e.Content.ID)) > 0 {
			return syscall.ENOTEMPTY
		}
	}
	if e.It.Local {
		m.discard(ctx, e.It.ID)
		if it := m.meta.item(e.It.ID); it == nil || it.Local {
			m.meta.remove(e.It.ID)
			return 0
		}
	}
	return errno(m.trash(ctx, e.It.ID, name))
}

// trash sends an item to the Drive's trash, where it can be restored for 30 days.
func (m *Mount) trash(ctx context.Context, id, name string) error {
	if _, err := m.drive.patch(ctx, id, map[string]any{"trashed": true}, nil); err != nil {
		m.problem("Mover para a lixeira", name, err)
		return err
	}
	m.discard(ctx, id)
	m.meta.remove(id)
	m.log("Mover para a lixeira", name, "Concluída", "")
	return nil
}

// makeDir creates a folder inside the Drive folder dir.
func (m *Mount) makeDir(ctx context.Context, dir, name string) (*Item, syscall.Errno) {
	f, err := m.drive.create(ctx, map[string]any{"name": name, "mimeType": mimeFolder, "parents": []string{dir}})
	if err != nil {
		m.problem("Criar pasta", name, err)
		return nil, errno(err)
	}
	m.meta.apply(f)
	m.meta.mu.Lock()
	m.meta.Loaded[f.ID] = true
	m.meta.mu.Unlock()
	return m.meta.item(f.ID), 0
}

// rename moves or renames an entry between the folders from and to. When a temporary file replaces an
// existing item (save-by-rename), adopted is that item's ID: the bytes now belong to it.
func (m *Mount) rename(ctx context.Context, from, name, to, newName string) (adopted string, eno syscall.Errno) {
	if eno := m.writableDir(from); eno != 0 {
		return "", eno
	}
	if eno := m.writableDir(to); eno != 0 {
		return "", eno
	}
	_ = m.meta.ensure(ctx, m.drive, from)
	_ = m.meta.ensure(ctx, m.drive, to)
	src, ok := m.meta.find(from, name)
	if !ok {
		return "", syscall.ENOENT
	}
	dst, exists := m.meta.find(to, newName)
	if exists && dst.It.ID == src.It.ID {
		return "", 0
	}
	if exists {
		if dst.Kind == kindDir || src.Kind == kindDir {
			return "", syscall.EEXIST
		}
		// Saving through a temporary file: its bytes become the next revision of the existing item.
		m.mu.Lock()
		p := m.pend[src.It.ID]
		movable := src.It.Local && p != nil && !p.sending && dst.Kind == kindFile && dst.Content.CanEdit && !dst.Content.Local
		if movable {
			if old := m.pend[dst.Content.ID]; old != nil && old.refs <= 0 && !old.sending {
				os.Remove(old.data())
				os.Remove(old.side())
				delete(m.pend, dst.Content.ID)
			}
			movable = m.pend[dst.Content.ID] == nil
		}
		if movable {
			delete(m.pend, p.FileID)
			p.FileID, p.New, p.Name, p.BaseMD5 = dst.Content.ID, false, dst.Content.Name, dst.Content.MD5
			if len(dst.Content.Parents) > 0 {
				p.Parent = dst.Content.Parents[0]
			}
			p.dirty, p.closed = true, time.Now()
			p.gen++
			m.pend[p.FileID] = p
		}
		m.mu.Unlock()
		if movable {
			_ = m.persist(p)
			m.meta.remove(src.It.ID)
			return dst.Content.ID, 0
		}
		if eno := m.removeEntry(ctx, to, newName, false); eno != 0 {
			return "", eno
		}
	}
	if src.It.Local {
		m.mu.Lock()
		p := m.pend[src.It.ID]
		idle := p != nil && !p.sending
		if idle {
			p.Name, p.Parent = newName, to
			p.gen++
		}
		m.mu.Unlock()
		if idle {
			_ = m.persist(p)
			it := *src.It
			it.Name, it.Parents = newName, []string{to}
			m.meta.mu.Lock()
			m.meta.put(&it)
			m.meta.mu.Unlock()
			return "", 0
		}
		// The upload is finishing; rename the item it creates.
		for i := 0; i < 600 && m.meta.item(src.It.ID) != nil && m.meta.item(src.It.ID).Local; i++ {
			time.Sleep(100 * time.Millisecond)
		}
	}
	q := url.Values{}
	if from != to {
		q.Set("addParents", to)
		q.Set("removeParents", from)
	}
	f, err := m.drive.patch(ctx, src.It.ID, map[string]any{"name": newName}, q)
	if err != nil {
		m.problem("Renomear", name, err)
		return "", errno(err)
	}
	m.mu.Lock()
	if p := m.pend[src.It.ID]; p != nil {
		p.Name = newName
	}
	m.mu.Unlock()
	m.meta.apply(f)
	return "", 0
}

// pinnedFiles expands offline selections to the files they contain.
func (m *Mount) pinnedFiles(ctx context.Context) []*Item {
	m.mu.Lock()
	ids := make([]string, 0, len(m.pins))
	for id := range m.pins {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	var out []*Item
	seen := map[string]bool{}
	var visit func(id string, depth int)
	visit = func(id string, depth int) {
		it := m.meta.item(id)
		if it == nil || seen[id] || depth > 40 {
			return
		}
		seen[id] = true
		if it.isDir() {
			_ = m.meta.ensure(ctx, m.drive, id)
			for _, e := range m.meta.listing(id) {
				visit(e.Content.ID, depth+1)
			}
		} else if !it.isNative() && it.Mime != mimeLink && !it.Local {
			out = append(out, it)
		}
	}
	for _, id := range ids {
		visit(id, 0)
	}
	return out
}

func (m *Mount) offlineLoop(ctx context.Context) {
	for {
		if !m.paused() {
			for _, it := range m.pinnedFiles(ctx) {
				f := m.cache.file(it)
				if f.cached() >= it.Size {
					continue
				}
				act := m.log("Guardar cópia off-line", it.Name, "Em andamento", "")
				if err := f.fill(ctx); err != nil {
					m.update(act, "Falhou", err.Error())
				} else {
					m.update(act, "Concluída", "")
				}
				if ctx.Err() != nil {
					return
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

func (m *Mount) setPin(id string, on bool) error {
	m.mu.Lock()
	if on {
		m.pins[id] = true
	} else {
		delete(m.pins, id)
	}
	ids := make([]string, 0, len(m.pins))
	for pin := range m.pins {
		ids = append(ids, pin)
	}
	m.mu.Unlock()
	return writeJSON(m.pinsPath(), ids)
}

// syncLoop builds the map once and then follows the account's change feed.
func (m *Mount) syncLoop(ctx context.Context) {
	fail := func(err error) {
		m.meta.mu.Lock()
		m.meta.problem = ""
		if err != nil && ctx.Err() == nil {
			m.meta.problem = err.Error()
		}
		m.meta.mu.Unlock()
	}
	for ctx.Err() == nil {
		err := m.meta.identify(ctx, m.drive)
		fail(err)
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(15 * time.Second):
		}
	}
	for ctx.Err() == nil {
		wait := 20 * time.Second
		if !m.paused() {
			if _, complete := m.meta.count(); !complete && m.set.Premap {
				err := m.meta.crawl(ctx, m.drive)
				fail(err)
				if err != nil {
					wait = time.Minute
				}
			}
			fail(m.meta.poll(ctx, m.drive))
			m.meta.save()
			m.cache.evict(false)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// start shows the account as a folder and begins following the Drive.
func (m *Mount) start(parent context.Context) error {
	if err := m.attach(); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(parent)
	m.mu.Lock()
	m.cancel, m.on = cancel, true
	m.mu.Unlock()
	go m.syncLoop(ctx)
	go m.offlineLoop(ctx)
	if !readOnly() {
		go m.uploader(ctx)
	}
	return nil
}

func (m *Mount) isMounted() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.on
}

func (m *Mount) stop() {
	m.mu.Lock()
	cancel, on := m.cancel, m.on
	m.cancel, m.on = nil, false
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.meta.save()
	if on {
		m.detach()
	}
}

// unsent counts local copies that have not reached the Drive.
func (m *Mount) unsent() (count int, failed string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.pend {
		if p.dirty && !localOnly(p.Name) {
			count++
			if p.failed != "" {
				failed = p.Name + ": " + p.failed
			}
		}
	}
	return
}
