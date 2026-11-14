//go:build linux

package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"
)

// platform is the FUSE mount of one account.
type platform struct {
	server   *fuse.Server
	uid, gid uint32
}

func mounted(path string) bool {
	data, _ := os.ReadFile("/proc/self/mountinfo")
	escaped := strings.NewReplacer(" ", `\040`, "\t", `\011`, "\n", `\012`, `\`, `\134`).Replace(path)
	for _, line := range strings.Split(string(data), "\n") {
		if fields := strings.Fields(line); len(fields) > 4 && fields[4] == escaped {
			return true
		}
	}
	return false
}

// attach mounts the account at m.path.
func (m *Mount) attach() error {
	if mounted(m.path) {
		// A mount left behind by a process that ended without unmounting.
		if _, err := os.Stat(m.path); err == nil {
			return errors.New("A pasta desta conta ainda está em uso pela versão anterior. O GCP-Drive tentará de novo em instantes.")
		}
		_ = exec.Command("fusermount3", "-u", "-z", m.path).Run()
	}
	if err := os.MkdirAll(m.path, 0o700); err != nil {
		return err
	}
	if entries, err := os.ReadDir(m.path); err == nil && len(entries) > 0 {
		return errors.New("A pasta de montagem desta conta contém arquivos. Mova-os para outro lugar e reinicie o GCP-Drive.")
	}
	m.mu.Lock()
	m.plat.uid, m.plat.gid = uint32(os.Getuid()), uint32(os.Getgid())
	uid, gid := m.plat.uid, m.plat.gid
	m.mu.Unlock()
	root := newNode(m, vRoot, vRoot, kindDir)
	entry, attr := 2*time.Second, 2*time.Second
	server, err := fs.Mount(m.path, root, &fs.Options{
		EntryTimeout: &entry, AttrTimeout: &attr, UID: uid, GID: gid,
		MountOptions: fuse.MountOptions{FsName: "OpenGdrive:" + m.a.ID, Name: "opengdrive", MaxReadAhead: 1 << 20, MaxWrite: 1 << 20,
			MaxBackground: 64, DisableXAttrs: true, IgnoreSecurityLabels: true, Options: []string{"default_permissions"}},
	})
	if err != nil {
		return errors.New("Não foi possível montar a unidade. Verifique se o FUSE 3 está instalado.")
	}
	m.mu.Lock()
	m.plat.server = server
	m.mu.Unlock()
	return nil
}

// detach unmounts the account's folder.
func (m *Mount) detach() {
	m.mu.Lock()
	server := m.plat.server
	m.plat.server = nil
	m.mu.Unlock()
	if server != nil {
		if err := server.Unmount(); err != nil {
			_ = exec.Command("fusermount3", "-u", "-z", m.path).Run()
		}
	}
}

// forget removes the folder of a disconnected account.
func (m *Mount) forget() { os.Remove(m.path) }
