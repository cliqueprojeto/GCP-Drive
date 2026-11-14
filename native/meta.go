package main

import (
	"compress/gzip"
	"context"
	"encoding/gob"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	vRoot      = "@root"
	vShared    = "@shared"
	vDrives    = "@drives"
	mimeFolder = "application/vnd.google-apps.folder"
	mimeLink   = "application/vnd.google-apps.shortcut"
	nameMy     = "Meu Drive"
	nameShared = "Compartilhados comigo"
	nameDrives = "Drives compartilhados"
)

type Item struct {
	ID, Name, Mime     string
	Parents            []string
	Size, MTime        int64
	MD5, Link, DriveID string
	Target, TargetMime string
	Owned, CanEdit     bool
	CanShare           bool
	// Shared marks items the Drive lists under "Shared with me".
	Shared bool
	// Local marks an item that exists only on this computer until its upload finishes.
	Local bool
}

func (it *Item) isDir() bool { return it.Mime == mimeFolder }

// native Google editors files have no downloadable bytes; they appear as links.
func (it *Item) isNative() bool {
	return strings.HasPrefix(it.Mime, "application/vnd.google-apps.") && it.Mime != mimeFolder && it.Mime != mimeLink
}

type sharedDrive struct{ ID, Name string }

type snapshot struct {
	Items    map[string]*Item
	RootID   string
	Drives   []sharedDrive
	Token    string
	Complete bool
	Loaded   map[string]bool
}

// entry is one visible name in a folder. Content is the item whose bytes or children it shows.
type entry struct {
	Name    string
	It      *Item
	Content *Item
	Kind    int
}

const (
	kindDir = iota
	kindFile
	kindLink
)

type Meta struct {
	mu sync.RWMutex
	snapshot
	kids     map[string]map[string]bool
	listings map[string][]entry
	missing  map[string]bool
	targeted map[string]bool
	sharedAt time.Time
	stale    bool
	loading  map[string]chan struct{}
	dirty    bool
	path     string
	crawling bool
	problem  string
	onChange func(dirs []string, id string)
}

func newMeta(path string) *Meta {
	m := &Meta{path: path, kids: map[string]map[string]bool{}, listings: map[string][]entry{}, missing: map[string]bool{}, targeted: map[string]bool{}, loading: map[string]chan struct{}{}}
	m.Items, m.Loaded = map[string]*Item{}, map[string]bool{}
	if f, err := os.Open(path); err == nil {
		defer f.Close()
		if z, err := gzip.NewReader(f); err == nil {
			var s snapshot
			if gob.NewDecoder(z).Decode(&s) == nil && s.Items != nil {
				m.snapshot = s
				if m.Loaded == nil {
					m.Loaded = map[string]bool{}
				}
				for id, it := range m.Items {
					if it.Local {
						delete(m.Items, id)
						continue
					}
					m.link(it)
				}
			}
		}
	}
	return m
}

func (m *Meta) save() {
	m.mu.Lock()
	if !m.dirty {
		m.mu.Unlock()
		return
	}
	m.dirty = false
	tmp := m.path + ".tmp"
	_ = os.MkdirAll(filepath.Dir(m.path), 0o700)
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err == nil {
		z := gzip.NewWriter(f)
		err = gob.NewEncoder(z).Encode(&m.snapshot)
		if cerr := z.Close(); err == nil {
			err = cerr
		}
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}
	m.mu.Unlock()
	if err == nil {
		_ = os.Rename(tmp, m.path)
	}
}

func (m *Meta) link(it *Item) {
	for _, p := range it.Parents {
		if m.kids[p] == nil {
			m.kids[p] = map[string]bool{}
		}
		m.kids[p][it.ID] = true
	}
}

func (m *Meta) unlink(it *Item) {
	for _, p := range it.Parents {
		delete(m.kids[p], it.ID)
		delete(m.listings, p)
	}
}

func toItem(f *apiFile) *Item {
	size, _ := strconv.ParseInt(f.Size, 10, 64)
	t, _ := time.Parse(time.RFC3339, f.ModifiedTime)
	it := &Item{ID: f.ID, Name: f.Name, Mime: intern(f.MimeType), Parents: f.Parents, Size: size, MTime: t.Unix(), MD5: f.MD5,
		DriveID: intern(f.DriveID), Shared: f.SharedTime != "", Target: f.Shortcut.TargetID, TargetMime: intern(f.Shortcut.TargetMime),
		Owned: f.OwnedByMe, CanEdit: f.Capabilities.CanEdit, CanShare: f.Capabilities.CanShare}
	// Only editor documents have a web address that cannot be rebuilt from the ID.
	if it.isNative() || it.Mime == mimeLink {
		it.Link = f.WebViewLink
	}
	return it
}

var (
	internMu sync.Mutex
	interned = map[string]string{}
)

// intern keeps one copy of values repeated across hundreds of thousands of items.
func intern(s string) string {
	internMu.Lock()
	defer internMu.Unlock()
	if v, ok := interned[s]; ok {
		return v
	}
	interned[s] = s
	return s
}

func linkOf(it *Item) string {
	switch {
	case it.Link != "":
		return it.Link
	case it.isDir():
		return "https://drive.google.com/drive/folders/" + url.PathEscape(it.ID)
	}
	return "https://drive.google.com/file/d/" + url.PathEscape(it.ID) + "/view"
}

// put inserts or replaces an item and returns the folders whose listing changed. Caller holds mu.
func (m *Meta) put(it *Item) []string {
	dirs := []string{vShared}
	if old := m.Items[it.ID]; old != nil {
		m.unlink(old)
		dirs = append(dirs, old.Parents...)
	}
	m.Items[it.ID] = it
	m.link(it)
	for _, p := range it.Parents {
		delete(m.listings, p)
	}
	m.stale = true
	delete(m.missing, it.ID)
	if it.Mime == mimeLink {
		delete(m.targeted, vShared)
		for _, p := range it.Parents {
			delete(m.targeted, p)
		}
	}
	m.dirty = true
	return append(dirs, it.Parents...)
}

func (m *Meta) drop(id string) []string {
	old := m.Items[id]
	if old == nil {
		return nil
	}
	m.unlink(old)
	delete(m.Items, id)
	m.stale = true
	m.dirty = true
	return append([]string{vShared}, old.Parents...)
}

func (m *Meta) apply(f *apiFile) {
	m.mu.Lock()
	var dirs []string
	if f.Trashed {
		dirs = m.drop(f.ID)
	} else {
		dirs = m.put(toItem(f))
	}
	m.mu.Unlock()
	if m.onChange != nil && len(dirs) > 0 {
		m.onChange(dirs, f.ID)
	}
}

func (m *Meta) remove(id string) {
	m.mu.Lock()
	dirs := m.drop(id)
	m.mu.Unlock()
	if m.onChange != nil && len(dirs) > 0 {
		m.onChange(dirs, id)
	}
}

func (m *Meta) item(id string) *Item {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.Items[id]
}

// visibleName turns a Drive name into one the local file system accepts; localName and linkSuffix are per system.
func visibleName(it *Item, kind int) string {
	name := localName(it.Name)
	if name == "" || name == "." || name == ".." {
		name = "_" + name
	}
	if kind == kindLink {
		name += linkSuffix
	}
	if len(name) > 250 {
		ext := filepath.Ext(name)
		if len(ext) > 20 {
			ext = ""
		}
		cut := 250 - len(ext)
		for cut > 0 && name[cut]&0xC0 == 0x80 {
			cut--
		}
		name = name[:cut] + ext
	}
	return name
}

// resolve decides how an item appears. Caller holds at least a read lock.
func (m *Meta) resolve(it *Item) (kind int, content *Item) {
	switch {
	case it.isDir():
		return kindDir, it
	case it.Mime == mimeLink:
		if it.TargetMime == mimeFolder {
			return kindDir, &Item{ID: it.Target, Name: it.Name, Mime: mimeFolder, MTime: it.MTime, CanEdit: m.Items[it.Target] != nil && m.Items[it.Target].CanEdit}
		}
		if t := m.Items[it.Target]; t != nil && !t.isNative() {
			return kindFile, t
		}
		return kindLink, it
	case it.isNative():
		return kindLink, it
	}
	return kindFile, it
}

func (m *Meta) childIDs(dir string) []string {
	var ids []string
	if dir == vShared {
		for id, it := range m.Items {
			if it.Shared && !it.Local {
				ids = append(ids, id)
			}
		}
		return ids
	}
	for id := range m.kids[dir] {
		ids = append(ids, id)
	}
	return ids
}

// listing returns the visible names of a folder, with stable de-duplication.
func (m *Meta) listing(dir string) []entry {
	m.mu.RLock()
	cached, ok := m.listings[dir]
	fresh := dir != vShared || !m.stale || (m.crawling && time.Since(m.sharedAt) < 2*time.Second)
	m.mu.RUnlock()
	if ok && fresh {
		return cached
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if dir == vShared {
		m.stale, m.sharedAt = false, time.Now()
	}
	var out []entry
	switch dir {
	case vRoot:
		now := time.Now().Unix()
		out = []entry{
			{Name: nameMy, It: &Item{ID: m.RootID, Name: nameMy, Mime: mimeFolder, MTime: now, CanEdit: true}, Kind: kindDir},
			{Name: nameShared, It: &Item{ID: vShared, Name: nameShared, Mime: mimeFolder, MTime: now}, Kind: kindDir},
			{Name: nameDrives, It: &Item{ID: vDrives, Name: nameDrives, Mime: mimeFolder, MTime: now}, Kind: kindDir},
		}
		for i := range out {
			out[i].Content = out[i].It
		}
	case vDrives:
		used := map[string]int{}
		for _, d := range m.Drives {
			it := &Item{ID: d.ID, Name: d.Name, Mime: mimeFolder, DriveID: d.ID, CanEdit: true}
			name := visibleName(it, kindDir)
			used[nameKey(name)]++
			if n := used[nameKey(name)]; n > 1 {
				name = fmt.Sprintf("%s (%d)", name, n)
			}
			out = append(out, entry{Name: name, It: it, Content: it, Kind: kindDir})
		}
	default:
		ids := m.childIDs(dir)
		sort.Strings(ids)
		items := make([]*Item, 0, len(ids))
		for _, id := range ids {
			if it := m.Items[id]; it != nil {
				items = append(items, it)
			}
		}
		sort.SliceStable(items, func(i, j int) bool { return items[i].Name < items[j].Name })
		used := map[string]int{}
		for _, it := range items {
			kind, content := m.resolve(it)
			name := visibleName(it, kind)
			used[nameKey(name)]++
			if n := used[nameKey(name)]; n > 1 {
				ext := filepath.Ext(name)
				name = fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), n, ext)
			}
			out = append(out, entry{Name: name, It: it, Content: content, Kind: kind})
		}
	}
	m.listings[dir] = out
	return out
}

func (m *Meta) find(dir, name string) (entry, bool) {
	for _, e := range m.listing(dir) {
		if e.Name == name {
			return e, true
		}
	}
	return entry{}, false
}

// ensure loads one folder on demand while the full map is still being built.
func (m *Meta) ensure(ctx context.Context, d *Drive, dir string) error {
	if dir == vRoot || dir == vDrives || dir == "" || strings.HasPrefix(dir, "local:") {
		return nil
	}
	m.mu.RLock()
	ready := (m.Complete || m.Loaded[dir]) && m.targeted[dir]
	m.mu.RUnlock()
	if ready {
		return nil
	}
	m.mu.Lock()
	if m.Complete || m.Loaded[dir] {
		m.mu.Unlock()
		return m.targets(ctx, d, dir)
	}
	if wait := m.loading[dir]; wait != nil {
		m.mu.Unlock()
		select {
		case <-wait:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	wait := make(chan struct{})
	m.loading[dir] = wait
	m.mu.Unlock()
	q := url.Values{"q": {"'" + dir + "' in parents and trashed=false"}}
	if dir == vShared {
		q = url.Values{"q": {"sharedWithMe=true and trashed=false"}}
	}
	// The listing outlives an interrupted caller so the next visit finds it ready.
	err := d.list(context.WithoutCancel(ctx), prioInteractive, q, func(files []apiFile) {
		for i := range files {
			m.apply(&files[i])
		}
	})
	m.mu.Lock()
	if err == nil {
		m.Loaded[dir] = true
		m.dirty = true
	}
	delete(m.loading, dir)
	close(wait)
	m.mu.Unlock()
	if err != nil {
		return err
	}
	return m.targets(ctx, d, dir)
}

// targets fetches the files that shortcuts in a folder point to, once.
func (m *Meta) targets(ctx context.Context, d *Drive, dir string) error {
	m.mu.RLock()
	var need []string
	for _, id := range m.childIDs(dir) {
		it := m.Items[id]
		if it != nil && it.Mime == mimeLink && it.TargetMime != mimeFolder && m.Items[it.Target] == nil && !m.missing[it.Target] {
			need = append(need, it.Target)
		}
	}
	m.mu.RUnlock()
	for _, id := range need {
		f, err := d.get(ctx, prioInteractive, id)
		if err != nil {
			m.mu.Lock()
			m.missing[id] = true
			m.mu.Unlock()
			continue
		}
		m.apply(f)
		m.mu.Lock()
		delete(m.listings, dir)
		m.mu.Unlock()
	}
	m.mu.Lock()
	m.targeted[dir] = true
	m.mu.Unlock()
	return nil
}

// crawl maps the whole account once; afterwards the change feed keeps it current.
func (m *Meta) crawl(ctx context.Context, d *Drive) error {
	m.mu.Lock()
	if m.crawling {
		m.mu.Unlock()
		return nil
	}
	m.crawling = true
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.crawling = false; m.mu.Unlock() }()
	if err := m.identify(ctx, d); err != nil {
		return err
	}
	seen := map[string]bool{}
	visit := func(files []apiFile) {
		for i := range files {
			seen[files[i].ID] = true
			m.apply(&files[i])
		}
	}
	if err := d.list(ctx, prioBackground, url.Values{"q": {"trashed=false"}, "corpora": {"user"}}, visit); err != nil {
		return err
	}
	m.mu.RLock()
	drives := append([]sharedDrive(nil), m.Drives...)
	m.mu.RUnlock()
	for _, drive := range drives {
		if err := d.list(ctx, prioBackground, url.Values{"q": {"trashed=false"}, "corpora": {"drive"}, "driveId": {drive.ID}}, visit); err != nil {
			return err
		}
	}
	m.mu.Lock()
	var gone []string
	for id, it := range m.Items {
		if !seen[id] && !it.Local {
			gone = append(gone, id)
		}
	}
	m.Complete, m.dirty = true, true
	m.mu.Unlock()
	for _, id := range gone {
		m.remove(id)
	}
	m.save()
	return nil
}

// identify records the root folder, the shared drives and where the change feed starts.
func (m *Meta) identify(ctx context.Context, d *Drive) error {
	m.mu.RLock()
	root, token := m.RootID, m.Token
	m.mu.RUnlock()
	if token == "" {
		var start struct {
			Token string `json:"startPageToken"`
		}
		if err := d.json(ctx, prioInteractive, "GET", apiBase+"/changes/startPageToken?supportsAllDrives=true", nil, &start); err != nil {
			return err
		}
		token = start.Token
	}
	if root == "" {
		f, err := d.get(ctx, prioInteractive, "root")
		if err != nil {
			return err
		}
		root = f.ID
	}
	drives, err := d.drives(ctx)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.RootID, m.Token, m.Drives, m.dirty = root, token, drives, true
	delete(m.listings, vRoot)
	delete(m.listings, vDrives)
	m.mu.Unlock()
	return nil
}

func (d *Drive) drives(ctx context.Context) ([]sharedDrive, error) {
	var out []sharedDrive
	token := ""
	for {
		var page struct {
			Next   string `json:"nextPageToken"`
			Drives []struct{ ID, Name string }
		}
		if err := d.json(ctx, prioInteractive, "GET", apiBase+"/drives?pageSize=100&fields=nextPageToken,drives(id,name)&pageToken="+url.QueryEscape(token), nil, &page); err != nil {
			return nil, err
		}
		for _, x := range page.Drives {
			out = append(out, sharedDrive{x.ID, x.Name})
		}
		if token = page.Next; token == "" {
			return out, nil
		}
	}
}

// poll applies what changed in the account since the last call.
func (m *Meta) poll(ctx context.Context, d *Drive) error {
	m.mu.RLock()
	token := m.Token
	m.mu.RUnlock()
	if token == "" {
		return nil
	}
	for {
		var page struct {
			Next     string `json:"nextPageToken"`
			NewStart string `json:"newStartPageToken"`
			Changes  []struct {
				Removed    bool    `json:"removed"`
				FileID     string  `json:"fileId"`
				ChangeType string  `json:"changeType"`
				File       apiFile `json:"file"`
			} `json:"changes"`
		}
		q := url.Values{"pageToken": {token}, "includeRemoved": {"true"}, "supportsAllDrives": {"true"}, "includeItemsFromAllDrives": {"true"},
			"pageSize": {"1000"}, "fields": {"nextPageToken,newStartPageToken,changes(removed,fileId,changeType,file(" + itemFields + "))"}}
		if err := d.json(ctx, prioBackground, "GET", apiBase+"/changes?"+q.Encode(), nil, &page); err != nil {
			return err
		}
		refreshDrives := false
		for i := range page.Changes {
			c := &page.Changes[i]
			switch {
			case c.ChangeType == "drive":
				refreshDrives = true
			case c.Removed || c.File.ID == "":
				if c.FileID != "" {
					m.remove(c.FileID)
				}
			default:
				m.apply(&c.File)
			}
		}
		if refreshDrives {
			if drives, err := d.drives(ctx); err == nil {
				m.mu.Lock()
				m.Drives = drives
				delete(m.listings, vDrives)
				m.mu.Unlock()
				if m.onChange != nil {
					m.onChange([]string{vDrives}, "")
				}
			}
		}
		m.mu.Lock()
		if page.Next != "" {
			m.Token = page.Next
		} else if page.NewStart != "" {
			m.Token = page.NewStart
		}
		token = m.Token
		m.dirty = m.dirty || len(page.Changes) > 0
		m.mu.Unlock()
		if page.Next == "" {
			return nil
		}
	}
}

// walk resolves a path relative to the account's mount to its visible entry.
func (m *Meta) walk(ctx context.Context, d *Drive, rel string) (entry, string, bool) {
	dir := vRoot
	var e entry
	parts := strings.Split(strings.Trim(filepath.ToSlash(rel), "/"), "/")
	for i, part := range parts {
		if part == "" {
			return entry{}, "", false
		}
		_ = m.ensure(ctx, d, dir)
		found, ok := m.find(dir, part)
		if !ok {
			return entry{}, "", false
		}
		e = found
		if i < len(parts)-1 {
			if e.Kind != kindDir {
				return entry{}, "", false
			}
			dir = e.Content.ID
		}
	}
	return e, dir, true
}

func (m *Meta) count() (items int, complete bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.Items), m.Complete
}
