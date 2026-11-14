package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
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
		// The Drive keeps the modification time the client sends with the content.
		modified := file.ModifiedTime
		if id := strings.TrimPrefix(path, "/upload/files/"); id != path {
			existing := *f.files[id]
			file = existing
		}
		file.ModifiedTime = modified
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
		if file.ModifiedTime == "" {
			file.ModifiedTime = time.Now().UTC().Format(time.RFC3339)
		}
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
	if got := visibleName(&Item{Name: "Planilha"}, kindLink); got != "Planilha"+linkSuffix {
		t.Errorf("link: %q", got)
	}
	m := newMeta(t.TempDir() + "/m")
	m.RootID = "R"
	for _, id := range []string{"1", "2"} {
		m.put(&Item{ID: id, Name: "igual.txt", Parents: []string{"R"}})
	}
	list := m.listing("R")
	if len(list) != 2 || list[0].Name != "igual.txt" || list[1].Name != "igual (2).txt" {
		t.Errorf("duplicates: %+v", list)
	}
}
