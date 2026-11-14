package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// fakeDrive implements the part of the Drive API the engine uses, in memory.
type fakeDrive struct {
	mu       sync.Mutex
	files    map[string]*apiFile
	content  map[string][]byte
	sessions map[string]*apiFile
	media    int
	seq      int
	delay    time.Duration
}

func (f *fakeDrive) add(id, name, parent string, data []byte, mime string) {
	file := &apiFile{ID: id, Name: name, MimeType: mime, Parents: []string{parent}, ModifiedTime: "2026-01-02T03:04:05Z", OwnedByMe: true}
	file.Capabilities.CanEdit, file.Capabilities.CanShare = true, true
	if mime == "" {
		file.MimeType = "application/octet-stream"
		sum := md5.Sum(data)
		file.MD5, file.Size = hex.EncodeToString(sum[:]), strconv.Itoa(len(data))
		f.content[id] = data
	}
	f.files[id] = file
}

func (f *fakeDrive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path, q := r.URL.Path, r.URL.Query()
	reply := func(v any) { w.Header().Set("Content-Type", "application/json"); json.NewEncoder(w).Encode(v) }
	switch {
	case path == "/drive/changes/startPageToken":
		reply(map[string]string{"startPageToken": "1"})
	case path == "/drive/changes":
		reply(map[string]any{"newStartPageToken": "1", "changes": []any{}})
	case path == "/drive/drives":
		reply(map[string]any{"drives": []any{}})
	case path == "/drive/about":
		reply(map[string]any{"storageQuota": map[string]string{"limit": "1000000", "usage": "10"}})
	case path == "/drive/files/generateIds":
		ids := []string{}
		for i := 0; i < 100; i++ {
			f.seq++
			ids = append(ids, fmt.Sprintf("gen%d", f.seq))
		}
		reply(map[string]any{"ids": ids})
	case path == "/drive/files" && r.Method == "GET":
		out := []*apiFile{}
		query := q.Get("q")
		for _, file := range f.files {
			if file.Trashed {
				continue
			}
			if strings.Contains(query, "in parents") && !strings.Contains(query, "'"+file.Parents[0]+"'") {
				continue
			}
			if strings.Contains(query, "sharedWithMe") {
				continue
			}
			out = append(out, file)
		}
		reply(map[string]any{"files": out})
	case path == "/drive/files" && r.Method == "POST":
		var file apiFile
		json.NewDecoder(r.Body).Decode(&file)
		f.seq++
		file.ID = fmt.Sprintf("made%d", f.seq)
		file.OwnedByMe, file.ModifiedTime = true, "2026-01-02T03:04:05Z"
		file.Capabilities.CanEdit = true
		f.files[file.ID] = &file
		reply(&file)
	case strings.HasPrefix(path, "/upload/files") && r.Method != "PUT":
		var file apiFile
		json.NewDecoder(r.Body).Decode(&file)
		if id := strings.TrimPrefix(path, "/upload/files/"); id != path {
			existing := *f.files[id]
			file = existing
		}
		f.seq++
		key := fmt.Sprintf("s%d", f.seq)
		f.sessions[key] = &file
		w.Header().Set("Location", "http://"+r.Host+"/upload/session/"+key)
	case strings.HasPrefix(path, "/upload/session/"):
		file := f.sessions[strings.TrimPrefix(path, "/upload/session/")]
		data, _ := io.ReadAll(r.Body)
		sum := md5.Sum(data)
		file.MD5, file.Size, file.OwnedByMe = hex.EncodeToString(sum[:]), strconv.Itoa(len(data)), true
		file.Capabilities.CanEdit = true
		file.ModifiedTime = time.Now().UTC().Format(time.RFC3339)
		if file.MimeType == "" {
			file.MimeType = "application/octet-stream"
		}
		f.files[file.ID], f.content[file.ID] = file, data
		reply(file)
	case strings.HasPrefix(path, "/drive/files/"):
		id := strings.TrimPrefix(path, "/drive/files/")
		if id == "root" {
			reply(&apiFile{ID: "ROOT", Name: "My Drive", MimeType: mimeFolder})
			return
		}
		file := f.files[id]
		if file == nil {
			w.WriteHeader(404)
			return
		}
		switch {
		case r.Method == "PATCH":
			var change map[string]any
			json.NewDecoder(r.Body).Decode(&change)
			if name, ok := change["name"].(string); ok {
				file.Name = name
			}
			if trashed, ok := change["trashed"].(bool); ok {
				file.Trashed = trashed
			}
			if add := q.Get("addParents"); add != "" {
				file.Parents = []string{add}
			}
			reply(file)
		case q.Get("alt") == "media":
			f.media++
			time.Sleep(f.delay)
			var from, to int
			fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &from, &to)
			data := f.content[id]
			to = min(to, len(data)-1)
			w.WriteHeader(206)
			w.Write(data[from : to+1])
		default:
			reply(file)
		}
	default:
		w.WriteHeader(400)
	}
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestEngine(t *testing.T) {
	if _, err := os.Stat("/dev/fuse"); err != nil {
		t.Skip("FUSE is not available")
	}
	fake := &fakeDrive{files: map[string]*apiFile{}, content: map[string][]byte{}, sessions: map[string]*apiFile{}, delay: 20 * time.Millisecond}
	big := bytes.Repeat([]byte("0123456789abcdef"), 5*chunkSize/16+7)
	fake.add("D1", "Projetos", "ROOT", nil, mimeFolder)
	fake.add("F1", "relatório.pdf", "D1", big, "")
	fake.add("F2", "nota.txt", "D1", []byte("primeira versão"), "")
	fake.add("G1", "Planilha", "ROOT", nil, "application/vnd.google-apps.spreadsheet")
	fake.files["G1"].WebViewLink = "https://docs.google.com/spreadsheets/d/G1"
	server := httptest.NewServer(fake)
	defer server.Close()
	apiBase, uploadBase, writeBack = server.URL+"/drive", server.URL+"/upload", 300*time.Millisecond

	state := t.TempDir()
	t.Setenv("GCP_DRIVE_STATE", filepath.Join(state, "state"))
	t.Setenv("GCP_DRIVE_MOUNT_ROOT", filepath.Join(state, "mnt"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(state, "config"))
	set := &Settings{CacheGB: 1, Premap: true, Paused: map[string]bool{}}
	account := &Account{ID: "acct", Email: "teste@example.com", Token: &oauth2.Token{AccessToken: "x", Expiry: time.Now().Add(24 * time.Hour)}}
	m := newMount(account, set, newSched(set))
	if err := m.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer m.stop()
	root := filepath.Join(m.path, nameMy)
	waitFor(t, "map", func() bool { _, done := m.meta.count(); return done })

	names := func(dir string) string {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, e := range entries {
			out = append(out, e.Name())
		}
		return strings.Join(out, "|")
	}
	if got := names(m.path); got != "Compartilhados comigo|Drives compartilhados|Meu Drive" {
		t.Fatalf("root listing: %s", got)
	}
	if got := names(root); got != "Planilha.desktop|Projetos" {
		t.Fatalf("my drive listing: %s", got)
	}
	link, _ := os.ReadFile(filepath.Join(root, "Planilha.desktop"))
	if !strings.Contains(string(link), "URL=https://docs.google.com/spreadsheets/d/G1") {
		t.Fatalf("link file: %q", link)
	}

	// Reading downloads blocks once; the second read is served from disk.
	pdf := filepath.Join(root, "Projetos", "relatório.pdf")
	head := make([]byte, 4096)
	file, _ := os.Open(pdf)
	file.Read(head)
	file.Close()
	if !bytes.Equal(head, big[:4096]) {
		t.Fatal("first bytes differ")
	}
	got, err := os.ReadFile(pdf)
	if err != nil || !bytes.Equal(got, big) {
		t.Fatalf("content differs: %v", err)
	}
	fake.mu.Lock()
	requests := fake.media
	fake.mu.Unlock()
	if requests > 4 {
		t.Fatalf("a %d-block file took %d range requests", len(big)/chunkSize+1, requests)
	}
	m.stop() // drop the kernel's page cache by remounting
	if err := m.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again, _ := os.ReadFile(pdf); !bytes.Equal(again, big) {
		t.Fatal("cached content differs")
	}
	fake.mu.Lock()
	if fake.media != requests {
		t.Fatalf("cached read went to the network: %d → %d", requests, fake.media)
	}
	fake.mu.Unlock()

	remote := func(name string) (*apiFile, []byte) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		for id, f := range fake.files {
			if f.Name == name && !f.Trashed {
				return f, fake.content[id]
			}
		}
		return nil, nil
	}

	// A new file appears at once and reaches the Drive after the write-back delay.
	created := filepath.Join(root, "Projetos", "novo.txt")
	if err := os.WriteFile(created, []byte("conteúdo novo"), 0o644); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(created); string(data) != "conteúdo novo" {
		t.Fatalf("local read-back: %q", data)
	}
	waitFor(t, "upload", func() bool { _, data := remote("novo.txt"); return string(data) == "conteúdo novo" })

	// Saving through a temporary file and rename keeps the item and adds a revision.
	note := filepath.Join(root, "Projetos", "nota.txt")
	tmp := filepath.Join(root, "Projetos", "nota.txt.novo")
	if err := os.WriteFile(tmp, []byte("segunda versão"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmp, note); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(note); string(data) != "segunda versão" {
		t.Fatalf("after rename: %q", data)
	}
	waitFor(t, "revision", func() bool {
		f, data := remote("nota.txt")
		return f != nil && f.ID == "F2" && string(data) == "segunda versão"
	})
	if f, _ := remote("nota.txt.novo"); f != nil {
		t.Fatal("temporary file reached the Drive")
	}

	// Editing in place uploads a revision of the same item.
	edit, err := os.OpenFile(note, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	edit.WriteAt([]byte("TERCEIRA"), 0)
	edit.Close()
	waitFor(t, "in-place edit", func() bool { _, data := remote("nota.txt"); return strings.HasPrefix(string(data), "TERCEIRA") })

	// Editor lock files stay local.
	lock := filepath.Join(root, "Projetos", ".~lock.nota.txt#")
	os.WriteFile(lock, []byte("x"), 0o644)
	time.Sleep(800 * time.Millisecond)
	if f, _ := remote(".~lock.nota.txt#"); f != nil {
		t.Fatal("lock file was uploaded")
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}

	// Folders, renames and removal (to the trash).
	folder := filepath.Join(root, "Nova pasta")
	if err := os.Mkdir(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(created, filepath.Join(folder, "movido.txt")); err != nil {
		t.Fatal(err)
	}
	if f, _ := remote("movido.txt"); f == nil || f.Parents[0] == "D1" {
		t.Fatalf("move did not reach the Drive: %+v", f)
	}
	if err := os.Remove(filepath.Join(folder, "movido.txt")); err != nil {
		t.Fatal(err)
	}
	if f, _ := remote("movido.txt"); f != nil {
		t.Fatal("removed file is not in the trash")
	}
	if err := os.Remove(folder); err != nil {
		t.Fatal(err)
	}
	if n, failed := m.unsent(); n != 0 || failed != "" {
		t.Fatalf("unsent after test: %d %s", n, failed)
	}
}

func TestLocalOnlyAndNames(t *testing.T) {
	for _, name := range []string{".~lock.a.odt#", "~$a.docx", "x.part", "a~", ".goutputstream-ABC"} {
		if !localOnly(name) {
			t.Errorf("%s should stay local", name)
		}
	}
	if localOnly("relatório.pdf") || localOnly(".config") {
		t.Error("regular names must be uploaded")
	}
	if got := visibleName(&Item{Name: "a/b"}, kindFile); got != "a∕b" {
		t.Errorf("slash: %q", got)
	}
	m := newMeta(filepath.Join(t.TempDir(), "m"))
	m.RootID = "R"
	for _, id := range []string{"1", "2"} {
		m.put(&Item{ID: id, Name: "igual.txt", Parents: []string{"R"}})
	}
	list := m.listing("R")
	if len(list) != 2 || list[0].Name != "igual.txt" || list[1].Name != "igual (2).txt" {
		t.Errorf("duplicates: %+v", list)
	}
}
