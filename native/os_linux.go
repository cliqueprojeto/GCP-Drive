//go:build linux

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func envDir(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, fallback)
}

// The account directory keeps the name used by earlier releases so upgrades keep their sign-ins.
func configDir() string { return filepath.Join(envDir("XDG_CONFIG_HOME", ".config"), "opengdrive") }

func defaultDataDir() string {
	return filepath.Join(envDir("XDG_DATA_HOME", ".local/share"), "opengdrive")
}

func defaultCacheDir() string { return filepath.Join(envDir("XDG_CACHE_HOME", ".cache"), "gcp-drive") }

func defaultSocketPath() string {
	if v := os.Getenv("XDG_RUNTIME_DIR"); v != "" {
		return filepath.Join(v, "gcp-drive.sock")
	}
	return filepath.Join(dataDir(), "control.sock")
}

var installedOAuthPaths = []string{"/usr/lib/opengdrive/google-oauth.json"}

// Google editors documents appear as desktop links.
const linkSuffix = ".desktop"

var invalidName = strings.NewReplacer("/", "∕", "\x00", "")

func localName(name string) string { return invalidName.Replace(name) }

// nameKey is what makes two names the same entry of a folder.
func nameKey(name string) string { return name }

// openExternal opens an address or a folder in the user's default program.
func openExternal(target string) error { return exec.Command("xdg-open", target).Start() }

// lockFile takes the lock that keeps one service per session. held reports that another process has it.
func lockFile(path string) (unlock func(), held bool, err error) {
	lock, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		lock.Close()
		return nil, true, nil
	}
	return func() { lock.Close() }, false, nil
}

// launchPanel replaces this process with the graphical panel.
func launchPanel() error {
	ui := "/usr/bin/gcp-drive-ui"
	if err := syscall.Exec(ui, []string{ui}, os.Environ()); err != nil {
		return errors.New("A interface do GCP-Drive não está instalada.")
	}
	return nil
}

// The panel is a program of its own here; the service has nothing to show on the desktop.
func (d *Daemon) startDesktop() func() { return func() {} }

func (d *Daemon) showPanel(string) error {
	return errors.New("Abra o painel pelo menu de aplicativos.")
}

// autostartState: the panel manages the session's autostart entry itself here.
func autostartState([]string) (any, error) {
	return nil, errors.New("Use as Preferências do painel.")
}

// desktopNotify: the panel and the file manager actions show their own messages here.
func desktopNotify(string, string) {}

// localCommand runs commands that do not go through the service; packages handle setup here.
func localCommand([]string) (bool, error) { return false, nil }

// diskFree reports the bytes available to the user on the disk that holds path.
func diskFree(path string) (int64, bool) {
	var st syscall.Statfs_t
	if syscall.Statfs(path, &st) != nil {
		return 0, false
	}
	return int64(st.Bavail) * int64(st.Bsize), true
}
