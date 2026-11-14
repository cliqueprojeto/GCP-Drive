//go:build windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func profileDir(env, fallback string) string {
	if v := os.Getenv(env); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, fallback)
}

// Accounts and settings roam with the profile; data and cache stay on this computer.
func configDir() string { return filepath.Join(profileDir("APPDATA", `AppData\Roaming`), "GCP-Drive") }

func localDir() string {
	return filepath.Join(profileDir("LOCALAPPDATA", `AppData\Local`), "GCP-Drive")
}

func defaultDataDir() string { return filepath.Join(localDir(), "data") }

func defaultCacheDir() string { return filepath.Join(localDir(), "cache") }

func defaultSocketPath() string { return filepath.Join(localDir(), "control.sock") }

var installedOAuthPaths []string

// Google editors documents appear as Internet shortcuts.
const linkSuffix = ".url"

var invalidName = strings.NewReplacer(`\`, "⧵", "/", "∕", ":", "꞉", "*", "＊", "?", "？", `"`, "＂", "<", "＜", ">", "＞", "|", "｜")

var reservedNames = map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true}

// localName replaces what NTFS and the Windows shell refuse: reserved characters, control characters,
// a trailing dot or space, and device names.
func localName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 0x20 {
			return -1
		}
		return r
	}, invalidName.Replace(name))
	if trimmed := strings.TrimRight(name, ". "); trimmed != name {
		name = trimmed + "_"
	}
	base := name
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	if reservedNames[strings.ToUpper(strings.TrimSpace(base))] {
		name = "_" + name
	}
	return name
}

// openExternal opens an address or a folder in the user's default program.
func openExternal(target string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}

// lockFile takes the lock that keeps one service per session. held reports that another process has it.
func lockFile(path string) (unlock func(), held bool, err error) {
	lock, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	var overlapped windows.Overlapped
	if windows.LockFileEx(windows.Handle(lock.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped) != nil {
		lock.Close()
		return nil, true, nil
	}
	return func() { lock.Close() }, false, nil
}

func launchPanel() error {
	return errors.New("O painel do GCP-Drive para Windows ainda não faz parte desta compilação.")
}

// diskFree reports the bytes available to the user on the disk that holds path.
func diskFree(path string) (int64, bool) {
	dir, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, false
	}
	var free uint64
	if windows.GetDiskFreeSpaceEx(dir, &free, nil, nil) != nil {
		return 0, false
	}
	return int64(free), true
}
