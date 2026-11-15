//go:build linux

package main

import (
	"bytes"
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

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
	if requests > 6 {
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

	// The marks the file managers show: read in full, only in the cloud, kept off-line, unknown.
	d := &Daemon{mounts: map[string]*Mount{m.a.ID: m}, ctx: context.Background()}
	projects := filepath.Join(root, "Projetos")
	if got := d.states(context.Background(), projects); got["relatório.pdf"] != stateLocal || got["nota.txt"] != stateCloud {
		t.Fatalf("states after a full read: %v", got)
	}
	if got := d.states(context.Background(), root)["Planilha.desktop"]; got != stateCloud {
		t.Fatalf("state of a Google document: %q", got)
	}
	if got := d.states(context.Background(), m.path); len(got) != 0 {
		t.Fatalf("the account's own folder has no marks: %v", got)
	}
	if err := m.setPin("D1", true); err != nil {
		t.Fatal(err)
	}
	if got := d.states(context.Background(), projects); got["nota.txt"] != stateOffline || got["relatório.pdf"] != stateOffline {
		t.Fatalf("states inside a folder kept off-line: %v", got)
	}
	if got := d.states(context.Background(), root)["Projetos"]; got != stateOffline {
		t.Fatalf("state of the folder kept off-line: %q", got)
	}
	if err := m.setPin("D1", false); err != nil {
		t.Fatal(err)
	}

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
