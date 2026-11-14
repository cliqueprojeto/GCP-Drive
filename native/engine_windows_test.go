//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"gcpdrive/cfapi"

	"golang.org/x/oauth2"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Windows does not ask a provider to fill folders for the provider's own process, so the test reads
// the account's folder the way the Explorer would: from another process, which is this binary again.
func TestMain(m *testing.M) {
	path := os.Getenv("GCP_DRIVE_TEST_PATH")
	switch os.Getenv("GCP_DRIVE_TEST_HELPER") {
	case "":
		os.Exit(m.Run())
	case "list":
		entries, err := os.ReadDir(path)
		if err != nil {
			os.Stderr.WriteString(err.Error())
			os.Exit(1)
		}
		var out []string
		for _, e := range entries {
			out = append(out, e.Name())
		}
		sort.Strings(out)
		os.Stdout.WriteString(strings.Join(out, "|"))
	case "head", "read":
		file, err := os.Open(path)
		if err == nil {
			if os.Getenv("GCP_DRIVE_TEST_HELPER") == "head" {
				_, err = io.CopyN(os.Stdout, file, 4096)
			} else {
				_, err = io.Copy(os.Stdout, file)
			}
		}
		if err != nil {
			os.Stderr.WriteString(err.Error())
			os.Exit(1)
		}
	case "write":
		check(os.WriteFile(path, []byte(os.Getenv("GCP_DRIVE_TEST_DATA")), 0o644))
	case "patch":
		file, err := os.OpenFile(path, os.O_RDWR, 0)
		check(err)
		_, err = file.WriteAt([]byte(os.Getenv("GCP_DRIVE_TEST_DATA")), 0)
		check(err)
		check(file.Close())
	case "rename":
		check(os.Rename(path, os.Getenv("GCP_DRIVE_TEST_DATA")))
	case "remove":
		check(os.Remove(path))
	case "mkdir":
		check(os.Mkdir(path, 0o755))
	}
	os.Exit(0)
}

func check(err error) {
	if err != nil {
		os.Stderr.WriteString(err.Error())
		os.Exit(1)
	}
}

func other(op, path string, data ...string) ([]byte, error) {
	cmd := exec.Command(os.Args[0])
	cmd.Env = append(os.Environ(), "GCP_DRIVE_TEST_HELPER="+op, "GCP_DRIVE_TEST_PATH="+path, "GCP_DRIVE_TEST_DATA="+strings.Join(data, ""))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, &os.PathError{Op: op, Path: path, Err: errorString(stderr.String() + " " + err.Error())}
	}
	return out, nil
}

type errorString string

func (e errorString) Error() string { return string(e) }

// TestEngineWindows serves a Cloud Files sync root from the engine against the in-memory Drive.
// Every access to the folder is made by another process, as a program of the user would.
// Nothing here involves the Explorer or a Google account.
func TestEngineWindows(t *testing.T) {
	fake := &fakeDrive{files: map[string]*apiFile{}, content: map[string][]byte{}, sessions: map[string]*apiFile{}, delay: 20 * time.Millisecond}
	big := bytes.Repeat([]byte("0123456789abcdef"), 5*chunkSize/16+7)
	fake.add("D1", "Projetos", "ROOT", nil, mimeFolder)
	fake.add("F1", "relatório.pdf", "D1", big, "")
	fake.add("F2", "nota.txt", "D1", []byte("primeira versão"), "")
	fake.add("G1", "Planilha", "ROOT", nil, "application/vnd.google-apps.spreadsheet")
	fake.files["G1"].WebViewLink = "https://docs.google.com/spreadsheets/d/G1"
	server := httptest.NewServer(fake)
	defer server.Close()
	apiBase, uploadBase, reconcileDelay, writeBack = server.URL+"/drive", server.URL+"/upload", 200*time.Millisecond, 300*time.Millisecond

	state, err := os.MkdirTemp("", "gcp-drive-engine")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GCP_DRIVE_STATE", filepath.Join(state, "state"))
	t.Setenv("GCP_DRIVE_MOUNT_ROOT", filepath.Join(state, "GCP-Drive"))
	t.Setenv("APPDATA", filepath.Join(state, "config"))
	set := &Settings{CacheGB: 1, Premap: true, Paused: map[string]bool{}}
	account := &Account{ID: "acct", Email: "teste@example.com", Token: &oauth2.Token{AccessToken: "x", Expiry: time.Now().Add(24 * time.Hour)}}
	m := newMount(account, set, newSched(set))
	if err := m.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		m.stop()
		m.forget()
		if err := os.RemoveAll(state); err != nil {
			t.Logf("leftover test folder: %v", err)
		}
	}()
	waitFor(t, "map", func() bool { _, done := m.meta.count(); return done })
	root := filepath.Join(m.path, nameMy)
	names := func(dir string) string {
		out, err := other("list", dir)
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
	read := func(op, path string) []byte {
		out, err := other(op, path)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	media := func() int {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		return fake.media
	}
	problems := func() string {
		m.mu.Lock()
		defer m.mu.Unlock()
		var out []string
		for _, a := range m.activity {
			if a.Status == "Falhou" {
				out = append(out, a.Action+" "+a.Name+": "+a.Detail)
			}
		}
		return strings.Join(out, "; ")
	}

	defer func() {
		if t.Failed() {
			t.Logf("problems recorded by the engine: %q", problems())
			m.plat.mu.Lock()
			t.Logf("root %q prefix %q dirty %v local %v", m.plat.root, m.plat.prefix, m.plat.dirty, m.plat.local)
			for rel, st := range m.plat.populated {
				t.Logf("listed folder %q: %+v", rel, *st)
			}
			m.plat.mu.Unlock()
			for _, dir := range []string{nameMy, filepath.Join(nameMy, "Projetos"), filepath.Join(nameMy, "Nova pasta")} {
				entries, err := os.ReadDir(filepath.Join(m.plat.root, dir))
				for _, e := range entries {
					info, _ := e.Info()
					state, serr := cfapi.Stat(filepath.Join(m.plat.root, dir, e.Name()))
					t.Logf("on disk in %q: %q size %d attributes 0x%X state %+v identity %q %v", dir, e.Name(), info.Size(), attributes(info), state, state.Identity, serr)
				}
				t.Logf("on disk in %q: error %v", dir, err)
			}
			for _, e := range m.meta.listing("D1") {
				t.Logf("in the map: %q %+v", e.Name, *e.It)
			}
			m.mu.Lock()
			for _, p := range m.pend {
				t.Logf("unsent: %+v", *p)
			}
			m.mu.Unlock()
		}
	}()

	if got := names(m.path); got != "Compartilhados comigo|Drives compartilhados|Meu Drive" {
		t.Fatalf("root listing: %q", got)
	}
	if got := names(root); got != "Planilha.url|Projetos" {
		t.Fatalf("my drive listing: %q", got)
	}
	if link := read("read", filepath.Join(root, "Planilha.url")); !strings.Contains(string(link), "URL=https://docs.google.com/spreadsheets/d/G1") {
		t.Fatalf("link file: %q", link)
	}
	if media() != 0 {
		t.Fatalf("listing downloaded content: %d requests", media())
	}

	// Reading downloads blocks once, a few per request.
	pdf := filepath.Join(root, "Projetos", "relatório.pdf")
	if head := read("head", pdf); !bytes.Equal(head, big[:4096]) {
		t.Fatal("first bytes differ")
	}
	t.Logf("range requests after the first 4 KiB: %d", media())
	if got := read("read", pdf); !bytes.Equal(got, big) {
		t.Fatal("content differs")
	}
	requests := media()
	t.Logf("range requests for a %d-block file: %d", len(big)/chunkSize+1, requests)
	if requests > 8 {
		t.Fatalf("a %d-block file took %d range requests", len(big)/chunkSize+1, requests)
	}
	// After the service restarts the content is still on this computer.
	m.stop()
	if err := m.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again := read("read", pdf); !bytes.Equal(again, big) {
		t.Fatal("content differs after restart")
	}
	if media() != requests {
		t.Fatalf("second read went to the network: %d → %d", requests, media())
	}
	note := filepath.Join(root, "Projetos", "nota.txt")
	if data := read("read", note); string(data) != "primeira versão" {
		t.Fatalf("small file: %q", data)
	}

	// What changes in the Drive is written into folders already shown.
	feed := func(id string, change func(f *apiFile)) {
		fake.mu.Lock()
		change(fake.files[id])
		copy := *fake.files[id]
		fake.mu.Unlock()
		m.meta.apply(&copy)
	}
	fake.mu.Lock()
	fake.add("F3", "chegou depois.txt", "D1", []byte("arquivo remoto novo"), "")
	fake.mu.Unlock()
	feed("F3", func(*apiFile) {})
	projects := filepath.Join(root, "Projetos")
	waitFor(t, "remote file to appear", func() bool { return strings.Contains(names(projects), "chegou depois.txt") })
	if data := read("read", filepath.Join(projects, "chegou depois.txt")); string(data) != "arquivo remoto novo" {
		t.Fatalf("remote new file: %q", data)
	}
	second := []byte("segunda versão, escrita em outro computador")
	feed("F2", func(f *apiFile) {
		sum := md5.Sum(second)
		f.MD5, f.Size, f.ModifiedTime = hex.EncodeToString(sum[:]), strconv.Itoa(len(second)), "2026-02-03T04:05:06Z"
		fake.content["F2"] = second
	})
	waitFor(t, "remote edit to arrive", func() bool {
		data, err := other("read", note)
		return err == nil && bytes.Equal(data, second)
	})
	feed("F3", func(f *apiFile) { f.Trashed = true })
	waitFor(t, "remote removal", func() bool { return !strings.Contains(names(projects), "chegou depois.txt") })
	if got := names(projects); got != "nota.txt|relatório.pdf" {
		t.Fatalf("folder after remote changes: %q", got)
	}
	if failed := problems(); failed != "" {
		t.Fatalf("problems recorded: %s", failed)
	}

	// From here on the folder is changed on this computer and the Drive follows.
	do := func(op, path string, data ...string) {
		t.Helper()
		if _, err := other(op, path, data...); err != nil {
			t.Fatal(err)
		}
	}
	remote := func(name string) (*apiFile, []byte) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		for id, f := range fake.files {
			if f.Name == name && !f.Trashed {
				copy := *f
				return &copy, fake.content[id]
			}
		}
		return nil, nil
	}
	synced := func(path string) bool {
		state, err := cfapi.Stat(path)
		return err == nil && state.Placeholder && state.InSync
	}

	// A new file reaches the Drive and becomes an entry in sync, with its content still here.
	created := filepath.Join(projects, "novo.txt")
	do("write", created, "conteúdo novo")
	waitFor(t, "upload", func() bool { _, data := remote("novo.txt"); return string(data) == "conteúdo novo" })
	waitFor(t, "new file in sync", func() bool { return synced(created) })
	if data := read("read", created); string(data) != "conteúdo novo" {
		t.Fatalf("new file read-back: %q", data)
	}

	// Saving through a temporary file and rename keeps the item and adds a revision.
	do("write", note+".novo", "terceira versão")
	do("rename", note+".novo", note)
	waitFor(t, "revision", func() bool {
		f, data := remote("nota.txt")
		return f != nil && f.ID == "F2" && string(data) == "terceira versão"
	})
	if f, _ := remote("nota.txt.novo"); f != nil {
		t.Fatal("temporary file reached the Drive")
	}
	waitFor(t, "saved file in sync", func() bool { return synced(note) })

	// Editing in place uploads a revision of the same item.
	do("patch", note, "QUARTA")
	waitFor(t, "in-place edit", func() bool {
		f, data := remote("nota.txt")
		return f != nil && f.ID == "F2" && strings.HasPrefix(string(data), "QUARTA")
	})
	waitFor(t, "edited file in sync", func() bool { return synced(note) })

	// Editor lock files stay on this computer.
	lock := filepath.Join(projects, ".~lock.nota.txt#")
	do("write", lock, "x")
	time.Sleep(1500 * time.Millisecond)
	if f, _ := remote(".~lock.nota.txt#"); f != nil {
		t.Fatal("lock file was uploaded")
	}
	do("remove", lock)

	// Folders, moves and removal (to the trash).
	folder := filepath.Join(root, "Nova pasta")
	do("mkdir", folder)
	waitFor(t, "folder in the Drive", func() bool { f, _ := remote("Nova pasta"); return f != nil && f.MimeType == mimeFolder })
	waitFor(t, "folder in sync", func() bool { return synced(folder) })
	made, _ := remote("Nova pasta")
	do("rename", created, filepath.Join(folder, "movido.txt"))
	waitFor(t, "move", func() bool {
		f, _ := remote("movido.txt")
		return f != nil && len(f.Parents) == 1 && f.Parents[0] == made.ID
	})
	if f, _ := remote("novo.txt"); f != nil {
		t.Fatal("the moved file kept a copy under the old name")
	}
	do("remove", filepath.Join(folder, "movido.txt"))
	waitFor(t, "removal", func() bool { f, _ := remote("movido.txt"); return f == nil })
	do("remove", folder)
	waitFor(t, "folder removal", func() bool { f, _ := remote("Nova pasta"); return f == nil })

	// A rename made in the Drive is not taken for one made here.
	feed("F1", func(f *apiFile) { f.Name = "relatório final.pdf" })
	waitFor(t, "remote rename", func() bool { return strings.Contains(names(projects), "relatório final.pdf") })
	time.Sleep(time.Second)
	if got := names(projects); got != "nota.txt|relatório final.pdf" {
		t.Fatalf("folder after local changes: %q", got)
	}
	if f, _ := remote("relatório final.pdf"); f == nil || f.ID != "F1" {
		t.Fatal("the remote rename was undone")
	}

	// The folder is registered with the Explorer, not only with the Cloud Files platform.
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager\`+m.shellID(), registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("sync root is not registered with the Explorer: %v", err)
	}
	name, _, _ := key.GetStringValue("DisplayNameResource")
	key.Close()
	if !strings.Contains(name, "teste@example.com") {
		t.Fatalf("name shown by the Explorer: %q", name)
	}

	// "Always keep on this device" downloads the whole file and counts as an offline selection;
	// once the content is in the file itself the cache gives up its copy. "Free up space" undoes it.
	kept := bytes.Repeat([]byte("manter neste dispositivo "), 3*chunkSize/25)
	fake.mu.Lock()
	fake.add("F4", "manter.bin", "D1", kept, "")
	fake.mu.Unlock()
	feed("F4", func(*apiFile) {})
	keptPath := filepath.Join(m.plat.root, nameMy, "Projetos", "manter.bin")
	waitFor(t, "file to keep", func() bool { _, err := os.Stat(keptPath); return err == nil })
	before := media()
	pin := func(keep bool) {
		t.Helper()
		if err := withHandle(keptPath, func(h windows.Handle) error { return cfapi.SetPin(h, keep) }); err != nil {
			t.Fatalf("pin %v: %v", keep, err)
		}
	}
	whole := func() bool {
		info, err := os.Stat(keptPath)
		return err == nil && attributes(info)&attributeRecallOnDataAccess == 0
	}
	selected := func() bool { m.mu.Lock(); defer m.mu.Unlock(); return m.pins["F4"] }
	pin(true)
	waitFor(t, "kept file to download", whole)
	waitFor(t, "offline selection", selected)
	if media() == before {
		t.Fatal("keeping the file did not download it")
	}
	waitFor(t, "cache to give up its copy", func() bool { return dirBytes(filepath.Join(m.cache.root, "F4")) == 0 })
	pin(false)
	if err := withHandle(keptPath, cfapi.Dehydrate); err != nil {
		t.Fatalf("free up space: %v", err)
	}
	waitFor(t, "selection to end", func() bool { return !selected() && !whole() })
	if data := read("read", keptPath); !bytes.Equal(data, kept) {
		t.Fatal("content differs after freeing its space")
	}

	// The panel answers only to who holds its token, and the notification icon comes and goes without harm.
	ctx, cancel := context.WithCancel(context.Background())
	daemon := &Daemon{set: set, sched: m.sched, mounts: map[string]*Mount{account.ID: m}, ctx: ctx, stop: cancel}
	closeDesktop := daemon.startDesktop()
	desk.mu.Lock()
	address := desk.panel
	desk.mu.Unlock()
	base, token, _ := strings.Cut(address, "/#")
	ask := func(token string) (int, string) {
		req, _ := http.NewRequest("POST", base+"/api/call", strings.NewReader(`{"Args":["status"]}`))
		req.Header.Set("X-GCP-Drive-Token", token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(body)
	}
	if code, body := ask(token); code != 200 || !strings.Contains(body, "teste@example.com") || !strings.Contains(body, `"Err":""`) {
		t.Fatalf("panel status: %d %s", code, body)
	}
	post := func(path, body string) string {
		req, _ := http.NewRequest("POST", base+path, strings.NewReader(body))
		req.Header.Set("X-GCP-Drive-Token", token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out, _ := io.ReadAll(res.Body)
		return strings.TrimSpace(string(out))
	}
	// The registration with Google is absent until the user hands its file over, and a wrong file is refused.
	if got := post("/api/registration", `{}`); got != `{"Out":false,"Err":""}` {
		t.Fatalf("registration before: %s", got)
	}
	if got := post("/api/registration", `{"ID":"{\"web\":{\"client_id\":\"x\"}}"}`); !strings.Contains(got, "App para computador") {
		t.Fatalf("wrong registration file: %s", got)
	}
	if got := post("/api/registration", `{"ID":"{\"installed\":{\"client_id\":\"teste\",\"client_secret\":\"teste\"}}"}`); got != `{"Out":true,"Err":""}` {
		t.Fatalf("registration after: %s", got)
	}
	if id, _, err := loadDesktopOAuth(); err != nil || id != "teste" {
		t.Fatalf("stored registration: %q %v", id, err)
	}
	if got := post("/api/browse", `{"ID":"https://example.com/"}`); !strings.Contains(got, "não permitido") {
		t.Fatalf("panel opened an address outside Google's console: %s", got)
	}
	if code, _ := ask("outro"); code != 403 {
		t.Fatalf("panel answered without its token: %d", code)
	}
	page, err := http.Get(base + "/")
	if err != nil || page.StatusCode != 200 {
		t.Fatalf("panel page: %v", err)
	}
	page.Body.Close()
	time.Sleep(time.Second)
	closeDesktop()
	cancel()

	if n, failed := m.unsent(); n != 0 || failed != "" {
		t.Fatalf("unsent after test: %d %s", n, failed)
	}
	if failed := problems(); failed != "" {
		t.Fatalf("problems recorded: %s", failed)
	}
	// Taking the account off this computer, as disconnecting and uninstalling do, removes the copies of
	// the Drive and leaves what exists only here as ordinary files, out of the Explorer's registration.
	own := filepath.Join(projects, "~$rascunho.docx")
	do("write", own, "só neste computador")
	m.stop()
	m.forget()
	var left []string
	filepath.WalkDir(m.path, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(m.path, path)
			left = append(left, rel)
		}
		return nil
	})
	if want := filepath.Join(nameMy, "Projetos", "~$rascunho.docx"); len(left) != 1 || left[0] != want {
		t.Fatalf("left in the folder: %q", left)
	}
	if data, err := os.ReadFile(filepath.Join(m.path, left[0])); err != nil || string(data) != "só neste computador" {
		t.Fatalf("file kept on this computer: %q %v", data, err)
	}
	if state, err := cfapi.Stat(filepath.Join(m.path, nameMy)); err != nil || state.Placeholder {
		t.Fatalf("folder kept on this computer is still a placeholder: %+v %v", state, err)
	}
	if key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager\`+m.shellID(), registry.QUERY_VALUE); err == nil {
		key.Close()
		t.Fatal("the folder is still registered with the Explorer")
	}
}
