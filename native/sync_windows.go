//go:build windows

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unsafe"

	"gcpdrive/cfapi"

	"golang.org/x/sys/windows"
)

// The account's folder holds real files, so programs change it without asking the engine. A watcher
// notes which folders changed; the reconciler then compares each of them with the Drive's listing and
// carries the difference to the side that is behind. A round has two steps over all its folders: first
// what is on disk (uploads, renames, moves), then what is missing from it (removals, arrivals), so an
// entry moved between two folders is never mistaken for a removal.

// scan is one folder in a round.
type scan struct {
	rel, path, dir string
	st             *folderState    // nil while the folder's listing is not all on disk
	claimed        map[string]bool // names in use on disk
	present        map[string]bool // items found on disk
	stray          map[string]bool // shared by the round: items found where the Drive does not have them
}

// later asks for another look at a folder once a file there has settled or been closed.
func (m *Mount) later(rel string) {
	m.plat.mu.Lock()
	if _, waiting := m.plat.local[rel]; !waiting {
		m.plat.local[rel] = time.Now().Add(max(writeBack, time.Second))
	}
	m.plat.mu.Unlock()
}

func (m *Mount) touched(rel string) {
	m.plat.mu.Lock()
	if m.plat.local != nil {
		m.plat.local[relKey(rel)] = time.Time{}
	}
	m.plat.mu.Unlock()
}

func (s *scan) sub(name string) string { return relKey(filepath.Join(s.rel, name)) }

func (m *Mount) remember(s *scan, id, name string) {
	if s.st == nil {
		return
	}
	m.plat.mu.Lock()
	if s.st.Seen[id] != name {
		s.st.Seen[id], m.plat.changed = name, true
	}
	m.plat.mu.Unlock()
}

func (m *Mount) unsee(s *scan, id string) {
	m.plat.mu.Lock()
	if _, ok := s.st.Seen[id]; ok {
		delete(s.st.Seen, id)
		m.plat.changed = true
	}
	m.plat.mu.Unlock()
}

// forgetFolders drops a folder and everything below it from the table of listed folders.
func (m *Mount) forgetFolders(rel string) {
	m.plat.mu.Lock()
	for known := range m.plat.populated {
		if known == rel || strings.HasPrefix(known, rel+`\`) {
			delete(m.plat.populated, known)
			m.plat.changed = true
		}
	}
	m.plat.mu.Unlock()
}

// moveFolders follows a folder that got another path on disk.
func (m *Mount) moveFolders(dir, to string) {
	m.plat.mu.Lock()
	defer m.plat.mu.Unlock()
	from, found := "", false
	for known, st := range m.plat.populated {
		if st.Dir == dir {
			from, found = known, true
		}
	}
	if !found || from == to {
		return
	}
	moved := map[string]*folderState{}
	for known, st := range m.plat.populated {
		if known == from || strings.HasPrefix(known, from+`\`) {
			moved[to+known[len(from):]] = st
			delete(m.plat.populated, known)
		}
	}
	for known, st := range moved {
		m.plat.populated[known] = st
	}
	m.plat.changed = true
}

// watcher notes the folders in which something was created, written, renamed or removed.
func (m *Mount) watcher(ctx context.Context, handle windows.Handle) {
	const mask = windows.FILE_NOTIFY_CHANGE_FILE_NAME | windows.FILE_NOTIFY_CHANGE_DIR_NAME | windows.FILE_NOTIFY_CHANGE_SIZE | windows.FILE_NOTIFY_CHANGE_LAST_WRITE
	buf := make([]byte, 64<<10)
	for ctx.Err() == nil {
		var n uint32
		err := windows.ReadDirectoryChanges(handle, &buf[0], uint32(len(buf)), true, mask, &n, nil, 0)
		if ctx.Err() != nil {
			return
		}
		if err != nil || n == 0 {
			// More changes than fit in the buffer, or the watch failed: look at everything.
			if err != nil && err != windows.ERROR_NOTIFY_ENUM_DIR {
				m.problem("Acompanhar pasta", m.a.Email, err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
			m.survey()
			continue
		}
		for off := uint32(0); off+12 <= n; {
			info := (*windows.FileNotifyInformation)(unsafe.Pointer(&buf[off]))
			name := windows.UTF16ToString(unsafe.Slice(&info.FileName, info.FileNameLength/2))
			if dir := filepath.Dir(name); dir == "." {
				m.touched("")
			} else {
				m.touched(dir)
			}
			if info.NextEntryOffset == 0 {
				break
			}
			off += info.NextEntryOffset
		}
	}
}

// survey asks for a look at every folder on disk: what changed while the service was not running
// has no other trace. The provider's own process sees folders as they are on disk, without filling them.
func (m *Mount) survey() {
	pending := []string{""}
	for len(pending) > 0 {
		rel := pending[0]
		pending = pending[1:]
		m.touched(rel)
		entries, _ := os.ReadDir(filepath.Join(m.plat.root, rel))
		for _, e := range entries {
			if e.IsDir() {
				pending = append(pending, filepath.Join(rel, e.Name()))
			}
		}
	}
}

func (m *Mount) reconciler(ctx context.Context) {
	m.survey()
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(reconcileDelay):
		}
		// Until the account answered once there is nothing to compare with.
		m.meta.mu.RLock()
		ready := m.meta.RootID != ""
		m.meta.mu.RUnlock()
		if !ready {
			continue
		}
		now := time.Now()
		m.plat.mu.Lock()
		work := map[string]bool{}
		for rel, when := range m.plat.local {
			if !when.After(now) {
				work[rel] = true
				delete(m.plat.local, rel)
			}
		}
		for rel, st := range m.plat.populated {
			if m.plat.dirty[st.Dir] {
				work[rel] = true
			}
		}
		m.plat.dirty = map[string]bool{}
		m.plat.mu.Unlock()
		if len(work) == 0 {
			continue
		}
		rels := make([]string, 0, len(work))
		for rel := range work {
			rels = append(rels, rel)
		}
		// Parents first: a new folder must exist in the Drive before what is inside it.
		sort.Slice(rels, func(i, j int) bool {
			if a, b := strings.Count(rels[i], `\`), strings.Count(rels[j], `\`); a != b {
				return a < b
			}
			return rels[i] < rels[j]
		})
		stray := map[string]bool{}
		var scans []*scan
		for _, rel := range rels {
			if s := m.compare(ctx, rel, stray); s != nil {
				scans = append(scans, s)
			}
		}
		for _, s := range scans {
			m.settle(ctx, s)
		}
		m.savePopulated()
	}
}

// compare looks at what is on disk in one folder and sends the Drive what changed there.
func (m *Mount) compare(ctx context.Context, rel string, stray map[string]bool) *scan {
	s := &scan{rel: rel, path: filepath.Join(m.plat.root, rel), claimed: map[string]bool{}, present: map[string]bool{}, stray: stray}
	m.plat.mu.Lock()
	s.st = m.plat.populated[rel]
	m.plat.mu.Unlock()
	switch {
	case s.st != nil:
		s.dir = s.st.Dir
	case rel == "":
		s.dir = vRoot
	default:
		// Not listed yet: only what programs put there is on disk. An ordinary folder waits for its parent to create it in the Drive.
		state, err := cfapi.Stat(s.path)
		kind, content, _, _, ok := parseIdentity(state.Identity)
		if err != nil || !state.Placeholder || !ok || kind != kindDir {
			return nil
		}
		s.dir = content
	}
	onDisk, err := os.ReadDir(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			m.forgetFolders(rel)
		}
		return nil
	}
	if s.st == nil && len(onDisk) == 0 {
		return nil
	}
	if err := m.meta.ensure(ctx, m.drive, s.dir); err != nil {
		m.later(rel)
		return nil
	}
	want, byID := map[string]entry{}, map[string]entry{}
	for _, e := range m.meta.listing(s.dir) {
		want[nameKey(e.Name)], byID[e.It.ID] = e, e
	}
	for _, d := range onDisk {
		info, err := d.Info()
		if err != nil {
			continue
		}
		s.claimed[nameKey(d.Name())] = true
		full := filepath.Join(s.path, d.Name())
		if attributes(info)&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			// Links and junctions are not followed.
			if state, err := cfapi.Stat(full); err == nil && state.Placeholder {
				m.comparePlaceholder(ctx, s, d, info, full, state, byID)
			}
			continue
		}
		if !keptLocal(d.Name()) {
			m.compareLocal(ctx, s, d, info, full, want)
		}
	}
	return s
}

// keptLocal names what never goes to the Drive: working files of programs and of the Explorer.
func keptLocal(name string) bool {
	lower := strings.ToLower(name)
	return localOnly(name) || lower == "desktop.ini" || lower == "thumbs.db" || strings.HasSuffix(lower, ".tmp")
}

// driveName is the name the Drive gets for an entry renamed on disk.
func driveName(kind int, name string) string {
	if kind == kindLink && len(name) > len(linkSuffix) && strings.EqualFold(name[len(name)-len(linkSuffix):], linkSuffix) {
		return name[:len(name)-len(linkSuffix)]
	}
	return name
}

// shownAs finds the folder and the name under which the map lists an item.
func (m *Mount) shownAs(it *Item) (string, entry, bool) {
	for _, parent := range it.Parents {
		for _, e := range m.meta.listing(parent) {
			if e.It.ID == it.ID {
				return parent, e, true
			}
		}
	}
	return "", entry{}, false
}

// settling reports whether a file was written too recently to be taken as finished.
func settling(info os.FileInfo) bool {
	age := time.Since(info.ModTime())
	return age >= 0 && age < writeBack
}

func sameContent(info os.FileInfo, it *Item) bool {
	return info.Size() == it.Size && (it.MTime == 0 || info.ModTime().Unix() == it.MTime)
}

// withHandle runs a placeholder operation on a path.
func withHandle(path string, do func(windows.Handle) error) error {
	handle, err := cfapi.Open(path)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return do(handle)
}

// comparePlaceholder handles an entry the Drive knows: renamed, moved or edited here, or changed there.
func (m *Mount) comparePlaceholder(ctx context.Context, s *scan, d os.DirEntry, info os.FileInfo, full string, state cfapi.State, byID map[string]entry) {
	kind, _, id, version, ok := parseIdentity(state.Identity)
	if !ok {
		return
	}
	name := d.Name()
	s.present[id] = true
	m.plat.mu.Lock()
	delete(m.plat.gone, id)
	m.plat.mu.Unlock()
	e, here := byID[id]
	seen, was := "", false
	if s.st != nil {
		m.plat.mu.Lock()
		seen, was = s.st.Seen[id]
		m.plat.mu.Unlock()
	}
	if !here {
		s.stray[id] = true
		it := m.meta.item(id)
		if it == nil || was {
			// Removed from this folder in the Drive.
			m.dropLocal(s, d, full, state, id)
			return
		}
		// Brought here on this computer: the Drive follows.
		from, old, ok := m.shownAs(it)
		if !ok {
			m.problem("Mover", name, errors.New("Este item não pode ser movido para outra pasta do Drive a partir deste computador."))
			return
		}
		if _, eno := m.rename(ctx, from, old.Name, s.dir, driveName(kind, name)); eno != 0 {
			m.problem("Mover", name, errors.New("O Google Drive não aceitou mover este item para esta pasta; no Drive ele continua onde estava."))
			return
		}
		if kind == kindDir {
			m.moveFolders(old.Content.ID, s.sub(name))
		}
		delete(s.stray, id)
		m.remember(s, id, name)
		m.touched(s.rel)
		return
	}
	if name != e.Name {
		if was && seen == name {
			// Renamed in the Drive.
			if err := os.Rename(full, filepath.Join(s.path, e.Name)); err != nil {
				m.problem("Atualizar pasta", name, err)
				return
			}
			s.claimed[nameKey(e.Name)] = true
			if kind == kindDir {
				m.moveFolders(e.Content.ID, s.sub(e.Name))
			}
			m.remember(s, id, e.Name)
			m.touched(s.rel)
			return
		}
		if _, eno := m.rename(ctx, s.dir, e.Name, s.dir, driveName(kind, name)); eno != 0 {
			m.problem("Renomear", name, errors.New("O Google Drive não aceitou o novo nome; no Drive o item continua como “"+e.Name+"”."))
			return
		}
		if kind == kindDir {
			m.moveFolders(e.Content.ID, s.sub(name))
		}
		m.remember(s, id, name)
		m.touched(s.rel)
		return
	}
	m.remember(s, id, name)
	if kind != kindFile || d.IsDir() {
		return
	}
	c := e.Content
	same := sameContent(info, c)
	var err error
	switch {
	case c.Local:
		m.queue(s, full, info, c.ID, true, name, "")
	case same && state.InSync && version == c.MD5:
	case same:
		// What is here is what the Drive has: an upload finished.
		err = withHandle(full, func(h windows.Handle) error { return cfapi.SetIdentity(h, identityOf(e), true) })
	case state.InSync && version != c.MD5:
		// Changed in the Drive: the old content gives way and the new one comes when the file is opened.
		err = withHandle(full, func(h windows.Handle) error {
			return cfapi.Update(h, c.Size, time.Unix(c.MTime, 0), identityOf(e), false)
		})
	case m.wasSuperseded(c.ID, info):
		// These bytes are in the Drive under another name after a conflict; the folder shows the Drive's version again.
		err = withHandle(full, func(h windows.Handle) error {
			return cfapi.Update(h, c.Size, time.Unix(c.MTime, 0), identityOf(e), true)
		})
	case !c.CanEdit:
		err = errors.New("Você não tem permissão para alterar este arquivo no Drive; a alteração ficou só neste computador.")
	case settling(info):
		m.later(s.rel)
	default:
		base := version
		if base == "" {
			base = c.MD5
		}
		m.queue(s, full, info, c.ID, false, c.Name, base)
	}
	if err != nil {
		m.problem("Atualizar arquivo", name, err)
		m.later(s.rel)
	}
}

// dropLocal removes from disk an entry the Drive no longer has in this folder, unless it holds unsent changes.
func (m *Mount) dropLocal(s *scan, d os.DirEntry, full string, state cfapi.State, id string) {
	var err error
	switch {
	case d.IsDir() && disposable(full):
		err = os.RemoveAll(full)
		m.forgetFolders(s.sub(d.Name()))
	case d.IsDir():
		return
	case state.InSync:
		err = os.Remove(full)
	default:
		m.problem("Atualizar pasta", d.Name(), errors.New("Este arquivo saiu desta pasta no Google Drive, mas a cópia deste computador tem alterações não enviadas e foi mantida."))
		return
	}
	if err != nil {
		m.problem("Atualizar pasta", d.Name(), err)
		return
	}
	delete(s.claimed, nameKey(d.Name()))
	delete(s.present, id)
	if s.st != nil {
		m.unsee(s, id)
	}
}

// compareLocal handles an ordinary file or folder: something created here, or saved over an entry of the Drive.
func (m *Mount) compareLocal(ctx context.Context, s *scan, d os.DirEntry, info os.FileInfo, full string, want map[string]entry) {
	name := d.Name()
	e, exists := want[nameKey(name)]
	if exists {
		s.present[e.It.ID] = true
	}
	refuse := func(why string) { m.problem("Enviar para o Drive", name, errors.New(why)) }
	convert := func(e entry, inSync bool) {
		err := withHandle(full, func(h windows.Handle) error { return cfapi.ConvertToPlaceholder(h, identityOf(e), inSync) })
		if err != nil {
			// Usually a program still has it open; it stays an ordinary file until the next look.
			m.later(s.rel)
		}
	}
	if d.IsDir() {
		switch {
		case exists && e.Kind != kindDir:
			refuse("Já existe no Drive um arquivo com o nome desta pasta.")
			return
		case !exists:
			if m.writableDir(s.dir) != 0 {
				refuse("Não é possível criar pastas aqui; use uma pasta dentro de “" + nameMy + "” ou de um drive compartilhado.")
				return
			}
			it, eno := m.makeDir(ctx, s.dir, name)
			if eno != 0 {
				m.later(s.rel)
				return
			}
			e = entry{Name: name, It: it, Content: it, Kind: kindDir}
			s.present[it.ID] = true
		}
		err := withHandle(full, func(h windows.Handle) error { return cfapi.ConvertToPlaceholder(h, identityOf(e), true) })
		if err != nil {
			m.problem("Criar pasta", name, err)
			m.later(s.rel)
			return
		}
		// Everything inside is on disk already; what the Drive has there, if anything, joins it.
		m.plat.mu.Lock()
		m.plat.populated[s.sub(name)] = &folderState{Dir: e.Content.ID, Seen: map[string]string{}}
		m.plat.local[s.sub(name)], m.plat.dirty[e.Content.ID], m.plat.changed = time.Time{}, true, true
		m.plat.mu.Unlock()
		m.remember(s, e.It.ID, name)
		return
	}
	if settling(info) {
		m.later(s.rel)
		return
	}
	switch {
	case exists && e.Kind != kindFile:
		refuse("Já existe no Drive uma pasta ou um documento com este nome.")
	case exists && e.Content.Local:
		if m.queue(s, full, info, e.Content.ID, true, name, "") {
			convert(e, false)
		}
	case exists && sameContent(info, e.Content):
		// The upload finished and nothing was written since.
		convert(e, true)
		m.remember(s, e.It.ID, name)
	case exists && !e.Content.CanEdit:
		refuse("Você não tem permissão para alterar este arquivo no Drive; a alteração ficou só neste computador.")
	case exists:
		// Saved over a file of the Drive: its next revision.
		if m.queue(s, full, info, e.Content.ID, false, e.Content.Name, e.Content.MD5) {
			convert(e, false)
		}
	case m.writableDir(s.dir) != 0:
		refuse("Não é possível criar arquivos aqui; use uma pasta dentro de “" + nameMy + "” ou de um drive compartilhado.")
	default:
		id, err := m.newID(ctx)
		if err != nil {
			m.later(s.rel)
			return
		}
		if m.queue(s, full, info, id, true, name, "") {
			it := &Item{ID: id, Name: name}
			convert(entry{Name: name, It: it, Content: it, Kind: kindFile}, false)
			s.present[id] = true
		}
	}
}

// copyQuiet copies a file nobody is writing to. A program that still has it open for writing makes it fail.
func copyQuiet(src, dst string, modified time.Time) error {
	p, err := windows.UTF16PtrFromString(src)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	in := os.NewFile(uintptr(handle), src)
	defer in.Close()
	out, err := os.OpenFile(dst+".novo", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chtimes(dst+".novo", modified, modified)
	}
	if err == nil {
		err = os.Rename(dst+".novo", dst)
	}
	if err != nil {
		os.Remove(dst + ".novo")
	}
	return err
}

// queue hands a copy of a file to the upload queue: a new item of the folder, or the next revision of id.
// It reports whether the current content is queued.
func (m *Mount) queue(s *scan, full string, info os.FileInfo, id string, isNew bool, name, base string) bool {
	if readOnly() {
		return false
	}
	m.mu.Lock()
	p := m.pend[id]
	if p != nil {
		if p.sending {
			m.mu.Unlock()
			m.later(s.rel)
			return false
		}
		p.refs++ // keeps the uploader away while the copy is replaced
	}
	m.mu.Unlock()
	fresh := p == nil
	hold := func() {
		if !fresh {
			m.mu.Lock()
			p.refs--
			m.mu.Unlock()
		}
	}
	if fresh {
		if err := os.MkdirAll(m.pendDir(), 0o700); err != nil {
			m.problem("Enviar para o Drive", name, err)
			return false
		}
		p = &Pending{Key: newKey(), FileID: id, New: isNew, Parent: s.dir, Name: name, BaseMD5: base, dir: m.pendDir()}
	} else if copied, err := os.Stat(p.data()); err == nil && copied.Size() == info.Size() && copied.ModTime().Equal(info.ModTime()) {
		hold()
		return true
	}
	if err := copyQuiet(full, p.data(), info.ModTime()); err != nil {
		hold()
		if !errors.Is(err, windows.ERROR_SHARING_VIOLATION) && !errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
			m.problem("Enviar para o Drive", name, err)
		}
		m.later(s.rel)
		return false
	}
	if err := m.persist(p); err != nil {
		hold()
		m.problem("Enviar para o Drive", name, err)
		return false
	}
	m.mu.Lock()
	if fresh {
		m.pend[id] = p
	} else {
		p.refs--
	}
	p.dirty, p.closed = true, time.Time{}
	p.gen++
	m.mu.Unlock()
	if fresh && isNew {
		m.meta.mu.Lock()
		m.meta.put(&Item{ID: id, Name: name, Parents: []string{s.dir}, Size: info.Size(), MTime: info.ModTime().Unix(), Owned: true, CanEdit: true, Local: true})
		m.meta.mu.Unlock()
	}
	return true
}

// superseded notes that the local content of a file went to the Drive under another name.
func (m *Mount) superseded(id string, info os.FileInfo) {
	if info == nil {
		return
	}
	m.plat.mu.Lock()
	if m.plat.superseded != nil {
		m.plat.superseded[id] = [2]int64{info.Size(), info.ModTime().UnixNano()}
	}
	m.plat.mu.Unlock()
}

func (m *Mount) wasSuperseded(id string, info os.FileInfo) bool {
	m.plat.mu.Lock()
	defer m.plat.mu.Unlock()
	sig, ok := m.plat.superseded[id]
	delete(m.plat.superseded, id)
	return ok && sig == [2]int64{info.Size(), info.ModTime().UnixNano()}
}

// settle handles what the Drive lists and the folder does not have: removed here, or new there.
func (m *Mount) settle(ctx context.Context, s *scan) {
	if s.st == nil {
		return
	}
	var list []cfapi.Placeholder
	var ids []string
	listed := map[string]bool{}
	for _, e := range m.meta.listing(s.dir) {
		id := e.It.ID
		listed[id] = true
		if s.present[id] || s.claimed[nameKey(e.Name)] {
			continue
		}
		if e.It.Local {
			// Removed here before it reached the Drive.
			m.removeEntry(ctx, s.dir, e.Name, false)
			continue
		}
		m.plat.mu.Lock()
		_, was := s.st.Seen[id]
		m.plat.mu.Unlock()
		if was {
			if s.stray[id] {
				// It is on disk in a folder the Drive could not move it to.
				continue
			}
			// A move arrives as a removal here and an arrival elsewhere, not always together: wait before taking it for a removal.
			grace := max(writeBack, time.Second)
			m.plat.mu.Lock()
			since, noted := m.plat.gone[id]
			if !noted {
				since = time.Now()
				m.plat.gone[id] = since
			}
			m.plat.mu.Unlock()
			if time.Since(since) < grace {
				m.later(s.rel)
				continue
			}
			m.plat.mu.Lock()
			delete(m.plat.gone, id)
			m.plat.mu.Unlock()
			m.unsee(s, id)
			if m.writableDir(s.dir) == 0 && m.trash(ctx, id, e.Name) == nil {
				if e.Kind == kindDir {
					m.forgetFolders(s.sub(e.Name))
				}
				continue
			}
			// The Drive keeps it, so it comes back.
		}
		list, ids = append(list, placeholderOf(e)), append(ids, id)
	}
	// What left this folder, on either side, is no longer expected here.
	m.plat.mu.Lock()
	for id := range s.st.Seen {
		if !listed[id] && !s.present[id] {
			delete(s.st.Seen, id)
			m.plat.changed = true
		}
	}
	m.plat.mu.Unlock()
	// Windows marks a folder as pending when its entries change; each entry carries its own state.
	if s.rel != "" {
		if state, err := cfapi.Stat(s.path); err == nil && state.Placeholder && !state.InSync {
			_ = withHandle(s.path, func(h windows.Handle) error { return cfapi.SetInSync(h, true) })
		}
	}
	if len(list) == 0 {
		return
	}
	if err := cfapi.CreatePlaceholders(s.path, list); err != nil {
		m.problem("Atualizar pasta", filepath.Base(s.path), err)
	}
	for i, p := range list {
		if p.Err != nil {
			m.problem("Atualizar pasta", p.Name, p.Err)
		} else {
			m.remember(s, ids[i], p.Name)
		}
	}
}

// disposable reports whether everything under path is a copy of what the Drive has.
func disposable(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		full := filepath.Join(path, e.Name())
		state, err := cfapi.Stat(full)
		if err != nil || !state.Placeholder || (!e.IsDir() && !state.InSync) {
			return false
		}
		if e.IsDir() && !disposable(full) {
			return false
		}
	}
	return true
}
