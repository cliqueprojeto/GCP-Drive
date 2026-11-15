//go:build windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"time"
)

// localCommand runs commands that do not go through the service.
func localCommand(args []string) (bool, error) {
	if args[0] == "context-ui" {
		if len(args) < 3 {
			return true, errors.New("Ação incompleta.")
		}
		return true, contextUI(args[1], args[2])
	}
	if args[0] != "uninstall" {
		return false, nil
	}
	accounts := len(args) > 1 && args[1] == "--accounts"
	return true, uninstall(accounts)
}

// uninstall is what the uninstaller runs before removing the program: it stops the service, takes every
// account's folder out of the Explorer and removes what the application stored on this computer.
// Files that did not reach the Drive stay in the GCP-Drive folder, and the upload queue stays in the
// application's data, so installing again resumes it. Sign-ins and settings go only when asked.
func uninstall(withAccounts bool) error {
	_, _ = call([]string{"quit"})
	var unlock func()
	// Without the folder of the lock nothing was ever stored for this user.
	if _, err := os.Stat(filepath.Dir(lockPath())); err == nil {
		for i := 0; unlock == nil; i++ {
			if free, held, err := lockFile(lockPath()); err == nil && !held {
				unlock = free
			} else if i > 150 {
				return errors.New("O serviço do GCP-Drive não encerrou.")
			} else {
				time.Sleep(100 * time.Millisecond)
			}
		}
	}
	unregisterShellMenu()
	set := loadSettings()
	list, _ := loadAccounts()
	for _, a := range list {
		if a.Provider == "" {
			newMount(a, set, newSched(set)).forget()
		}
	}
	if unlock != nil {
		unlock()
	}
	for _, path := range []string{cacheRoot(), filepath.Join(localDir(), "painel"), filepath.Join(dataDir(), "pastas"), filepath.Join(dataDir(), "mapa")} {
		_ = os.RemoveAll(path)
	}
	if withAccounts {
		_ = os.RemoveAll(configDir())
	}
	// Folders go only when nothing is left in them.
	for _, path := range []string{filepath.Join(localDir(), "gcp-drive.ico"), lockPath(), socketPath(), filepath.Join(dataDir(), "envios"), dataDir(), localDir(), mountRoot()} {
		_ = os.Remove(path)
	}
	return nil
}
