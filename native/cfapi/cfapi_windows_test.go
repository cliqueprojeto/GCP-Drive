package cfapi

import (
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

type span struct{ off, n int64 }

// The platform does not ask a provider to fill folders for the provider's own process, so the test
// reads the sync root the way the Explorer would: from another process, which is this binary again.
func TestMain(m *testing.M) {
	path := os.Getenv("GCP_DRIVE_CF_PATH")
	switch os.Getenv("GCP_DRIVE_CF_HELPER") {
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
			if os.Getenv("GCP_DRIVE_CF_HELPER") == "head" {
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

func other(t *testing.T, op, path string) []byte {
	t.Helper()
	cmd := exec.Command(os.Args[0])
	cmd.Env = append(os.Environ(), "GCP_DRIVE_CF_HELPER="+op, "GCP_DRIVE_CF_PATH="+path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("%s %s from another process: %v %s", op, path, err, stderr.String())
	}
	return out
}

// TestSyncRoot registers a sync root in a temporary folder and serves it from memory:
// on-demand folder listing, on-demand content, and a second read that asks for nothing.
func TestSyncRoot(t *testing.T) {
	build, revision, integration, err := PlatformInfo()
	if err != nil {
		t.Fatalf("Cloud Files API is not available here: %v", err)
	}
	t.Logf("Cloud Files platform: build %d revision %d integration %d", build, revision, integration)

	base, err := os.MkdirTemp("", "gcp-drive-cf")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(base); err != nil {
			t.Logf("leftover test folder: %v", err)
		}
	}()
	root := filepath.Join(base, "conta@example.com")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	big := bytes.Repeat([]byte("0123456789abcdef"), 5*(256<<10)/16+7)
	note := []byte("primeira versão")
	content := map[string][]byte{"F1": big, "F2": note}
	tree := map[string][]Placeholder{
		"": {{Name: "Projetos", Identity: []byte("D1"), Dir: true, InSync: true},
			{Name: "relatório.pdf", Identity: []byte("F1"), Size: int64(len(big)), Modified: time.Unix(1767323045, 0), InSync: true}},
		"D1": {{Name: "nota.txt", Identity: []byte("F2"), Size: int64(len(note)), InSync: true}},
	}

	err = Register(Root{Path: root, Provider: "GCP-Drive", Version: "0.5.0", Identity: []byte("acct"),
		ProviderID: windows.GUID{Data1: 0x6f2a7c11, Data2: 0x3d5e, Data3: 0x4b8a, Data4: [8]byte{0x9c, 0x41, 0x2e, 0x77, 0x51, 0xa0, 0xd3, 0x08}},
		Hydration:  HydrationPartial, Population: PopulationPartial})
	if err != nil {
		t.Fatalf("CfRegisterSyncRoot: %v", err)
	}
	defer func() {
		if err := Unregister(root); err != nil {
			t.Errorf("CfUnregisterSyncRoot: %v", err)
		}
	}()

	var mu sync.Mutex
	var fetched []span
	var listed []string
	var failures []string
	canceled := 0
	fail := func(what string, err error) {
		if err != nil {
			mu.Lock()
			failures = append(failures, what+": "+err.Error())
			mu.Unlock()
		}
	}
	conn, err := Connect(root, Callbacks{
		FetchPlaceholders: func(r *Request, pattern string) {
			mu.Lock()
			listed = append(listed, string(r.Identity)+"|"+pattern+"|"+r.Path)
			mu.Unlock()
			go func() {
				list := append([]Placeholder(nil), tree[string(r.Identity)]...)
				fail("TransferPlaceholders", r.TransferPlaceholders(list, true))
				for _, p := range list {
					fail("placeholder "+p.Name, p.Err)
				}
			}()
		},
		FetchData: func(r *Request, offset, length int64) {
			mu.Lock()
			fetched = append(fetched, span{offset, length})
			mu.Unlock()
			go func() {
				data := content[string(r.Identity)]
				end := min(offset+length, int64(len(data)))
				for off := offset; off < end; {
					n := min(int64(64<<10), end-off)
					err := r.TransferData(data[off:off+n], off)
					if err == ErrCanceled {
						// The reader closed the file before the answer arrived.
						mu.Lock()
						canceled++
						mu.Unlock()
						return
					}
					if err != nil {
						fail("TransferData", err)
						_ = r.FailData(off, end-off, StatusUnsuccessful)
						return
					}
					off += n
					fail("Progress", r.Progress(end-offset, off-offset))
				}
			}()
		},
	})
	if err != nil {
		t.Fatalf("CfConnectSyncRoot: %v", err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			t.Errorf("CfDisconnectSyncRoot: %v", err)
		}
	}()
	snapshot := func() (int, int) {
		mu.Lock()
		defer mu.Unlock()
		if len(failures) > 0 {
			t.Fatalf("callback failures: %s", strings.Join(failures, "; "))
		}
		return len(fetched), len(listed)
	}
	names := func(dir string) string { return string(other(t, "list", dir)) }
	attrs := func(path string) uint32 {
		p, _ := windows.UTF16PtrFromString(path)
		a, err := windows.GetFileAttributes(p)
		if err != nil {
			t.Fatalf("attributes of %s: %v", path, err)
		}
		return a
	}

	// Folders are filled when first opened.
	if got := names(root); got != "Projetos|relatório.pdf" {
		t.Fatalf("root listing: %q", got)
	}
	if got := names(filepath.Join(root, "Projetos")); got != "nota.txt" {
		t.Fatalf("folder listing: %q", got)
	}
	_, lists := snapshot()
	mu.Lock()
	t.Logf("FETCH_PLACEHOLDERS calls: %d %q", lists, listed)
	mu.Unlock()
	names(root)
	if _, again := snapshot(); again != lists {
		t.Errorf("a populated folder was requested again: %d → %d", lists, again)
	}

	pdf := filepath.Join(root, "relatório.pdf")
	info, err := os.Stat(pdf)
	if err != nil || info.Size() != int64(len(big)) {
		t.Fatalf("placeholder size: %v %v", info, err)
	}
	t.Logf("attributes before reading: 0x%X", attrs(pdf))
	if n, _ := snapshot(); n != 0 {
		t.Fatalf("listing and stat hydrated data: %d requests", n)
	}

	// Reading the first bytes asks for a part of the file, not all of it.
	if head := other(t, "head", pdf); !bytes.Equal(head, big[:4096]) {
		t.Fatal("first bytes differ")
	}
	mu.Lock()
	t.Logf("FETCH_DATA after reading 4 KiB of %d bytes: %+v", len(big), fetched)
	mu.Unlock()

	if got := other(t, "read", pdf); !bytes.Equal(got, big) {
		t.Fatal("content differs")
	}
	requests, _ := snapshot()
	mu.Lock()
	t.Logf("FETCH_DATA after the full read: %+v", fetched)
	mu.Unlock()
	t.Logf("attributes after reading: 0x%X", attrs(pdf))

	// The second read is served by the disk.
	if again := other(t, "read", pdf); !bytes.Equal(again, big) {
		t.Fatal("second read differs")
	}
	if n, _ := snapshot(); n != requests {
		t.Fatalf("second read asked for data again: %d → %d", requests, n)
	}
	if data := other(t, "read", filepath.Join(root, "Projetos", "nota.txt")); !bytes.Equal(data, note) {
		t.Fatalf("small file: %q", data)
	}
	// The provider's own process can read too.
	own, err := os.ReadFile(pdf)
	t.Logf("read by the provider process: equal=%v err=%v; requests canceled by readers so far: %d", bytes.Equal(own, big), err, canceled)
	requests, _ = snapshot()

	// What follows informs the next phases; it is reported, not required.
	open := func(path string, access uint32) (windows.Handle, error) {
		p, _ := windows.UTF16PtrFromString(path)
		return windows.CreateFile(p, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
			windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	}
	if h, err := open(pdf, windows.FILE_READ_ATTRIBUTES|windows.FILE_WRITE_DATA); err != nil {
		t.Logf("open for dehydration: %v", err)
	} else {
		err := Dehydrate(h)
		windows.CloseHandle(h)
		t.Logf("CfDehydratePlaceholder: %v; attributes 0x%X", err, attrs(pdf))
		if err == nil {
			if again := other(t, "read", pdf); !bytes.Equal(again, big) {
				t.Error("read after dehydration differs")
			}
			n, _ := snapshot()
			t.Logf("FETCH_DATA calls after dehydration and a new read: %d → %d", requests, n)
		}
	}
	created := filepath.Join(root, "Projetos", "novo.txt")
	if err := os.WriteFile(created, []byte("conteúdo novo"), 0o644); err != nil {
		t.Logf("creating a file inside the sync root: %v", err)
	} else {
		t.Logf("attributes of a new local file: 0x%X", attrs(created))
		if h, err := open(created, windows.FILE_READ_ATTRIBUTES|windows.FILE_WRITE_DATA); err != nil {
			t.Logf("open for conversion: %v", err)
		} else {
			t.Logf("CfConvertToPlaceholder: %v", ConvertToPlaceholder(h, []byte("N1"), true))
			t.Logf("CfSetInSyncState(false): %v", SetInSync(h, false))
			t.Logf("CfSetInSyncState(true): %v", SetInSync(h, true))
			windows.CloseHandle(h)
			t.Logf("attributes after conversion: 0x%X", attrs(created))
		}
	}
	snapshot()
}
