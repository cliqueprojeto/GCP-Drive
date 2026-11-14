//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
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
	}
	os.Exit(0)
}

func other(op, path string) ([]byte, error) {
	cmd := exec.Command(os.Args[0])
	cmd.Env = append(os.Environ(), "GCP_DRIVE_TEST_HELPER="+op, "GCP_DRIVE_TEST_PATH="+path)
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
// It covers reading only; nothing here involves the Explorer or a Google account.
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
	apiBase, uploadBase, reconcileDelay = server.URL+"/drive", server.URL+"/upload", 200*time.Millisecond

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
}
