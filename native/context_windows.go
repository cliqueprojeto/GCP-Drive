//go:build windows

package main

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"gcpdrive/cfapi"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// The "GCP-Drive" submenu of the Explorer's right-click menu, with the same actions the Linux file
// managers show. It is a per-user registration under HKCU\Software\Classes, limited to items inside the
// GCP-Drive folder; nothing else in the user's file associations changes, and uninstall removes it.

type menuAction struct{ id, title string }

var fileMenu = []menuAction{
	{"gemini", "Pedir ao Gemini no Drive"},
	{"web", "Abrir na nuvem"},
	{"link", "Copiar link da nuvem"},
	{"share", "Compartilhar"},
	{"shortcut", "Adicionar atalho a Meu Drive"},
	{"pin", "Disponibilizar arquivo off-line"},
	{"offline-open", "Abrir pasta da cópia off-line"},
	{"unpin", "Remover cópia off-line"},
}

var folderMenu = []menuAction{
	{"web", "Abrir na nuvem"},
	{"link", "Copiar link da pasta"},
	{"share", "Compartilhar pasta"},
	{"shortcut", "Adicionar atalho a Meu Drive"},
	{"upload", "Enviar arquivo para esta pasta"},
	{"pin", "Manter esta pasta off-line"},
	{"unpin", "Deixar de manter off-line"},
}

// menuKeys are the classes that carry the submenu: every file, and folders.
var menuKeys = map[string][]menuAction{
	`Software\Classes\*\shell\GCPDrive`:         fileMenu,
	`Software\Classes\Directory\shell\GCPDrive`: folderMenu,
}

var (
	advapi32          = windows.NewLazySystemDLL("advapi32.dll")
	procRegDeleteTree = advapi32.NewProc("RegDeleteTreeW")
	procSHChangeNotif = shell32.NewProc("SHChangeNotify")
)

func deleteTree(path string) {
	name, _ := windows.UTF16PtrFromString(path)
	procRegDeleteTree.Call(uintptr(registry.CURRENT_USER), uintptr(unsafe.Pointer(name)))
}

// registerShellMenu writes the submenu for the running executable and the current GCP-Drive folder.
// It runs at every start, so a moved installation or another folder is followed.
func registerShellMenu() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root := strings.TrimRight(mountRoot(), `\`) + `\`
	icon := iconPath()
	for base, actions := range menuKeys {
		// The tree is rewritten from scratch so items removed in an update do not stay behind.
		deleteTree(base)
		key, _, err := registry.CreateKey(registry.CURRENT_USER, base, registry.SET_VALUE)
		if err != nil {
			return err
		}
		for name, value := range map[string]string{
			"MUIVerb":          "GCP-Drive",
			"Icon":             icon,
			"SubCommands":      "",
			"MultiSelectModel": "Single",
			// Only items whose path starts with the GCP-Drive folder show the submenu. The parsing path is
			// the real one; the display path translates folder names ("C:\Usuários" for "C:\Users").
			"AppliesTo": `System.ParsingPath:~<"` + root + `"`,
		} {
			if err = key.SetStringValue(name, value); err != nil {
				break
			}
		}
		key.Close()
		if err != nil {
			return err
		}
		for i, action := range actions {
			// The Explorer orders the items by key name.
			item := base + `\shell\` + string(rune('a'+i)) + "-" + action.id
			key, _, err := registry.CreateKey(registry.CURRENT_USER, item, registry.SET_VALUE)
			if err != nil {
				return err
			}
			err = key.SetStringValue("MUIVerb", action.title)
			if err == nil {
				err = key.SetStringValue("Icon", icon)
			}
			key.Close()
			if err != nil {
				return err
			}
			command, _, err := registry.CreateKey(registry.CURRENT_USER, item+`\command`, registry.SET_VALUE)
			if err != nil {
				return err
			}
			err = command.SetStringValue("", `"`+exe+`" context-ui `+action.id+` "%1"`)
			command.Close()
			if err != nil {
				return err
			}
		}
	}
	shellChanged()
	return nil
}

// unregisterShellMenu removes the submenu; uninstall runs it.
func unregisterShellMenu() {
	for base := range menuKeys {
		deleteTree(base)
	}
	shellChanged()
}

// shellChanged asks the Explorer to read the menus again.
func shellChanged() {
	const assocChanged, idList = 0x08000000, 0
	procSHChangeNotif.Call(assocChanged, idList, 0, 0)
}

// contextUI runs one action of the submenu. It is a short process of its own: the service does the
// work, and this one shows the outcome, since there is no terminal to print to.
func contextUI(action, path string) error {
	err := runContext(action, filepath.Clean(path))
	if err != nil {
		showError(err.Error())
	}
	return nil
}

func runContext(action, path string) error {
	switch action {
	case "web", "gemini":
		if _, err := call([]string{"context", "web", path}); err != nil {
			return err
		}
		if action == "gemini" {
			_, _ = call([]string{"notify", "Gemini no Google Drive", "Abra o painel do Gemini no Drive para Web, se a sua conta tiver acesso."})
		}
		return nil
	case "link":
		link, err := call([]string{"context", "link", path})
		if err != nil {
			return err
		}
		if err := copyText(strings.TrimSpace(link)); err != nil {
			return errors.New("Não foi possível copiar o link: " + err.Error())
		}
		_, _ = call([]string{"notify", "Link copiado", "Cole o link no aplicativo de destino."})
		return nil
	case "share":
		_, err := call([]string{"panel", path})
		return err
	case "shortcut":
		if _, err := call([]string{"context", "shortcut", path}); err != nil {
			return err
		}
		_, _ = call([]string{"notify", "Atalho adicionado", "“" + filepath.Base(path) + "” agora tem um atalho em Meu Drive."})
		return nil
	case "pin", "unpin":
		return pinPath(path, action == "pin")
	case "offline-open":
		// The file stays where it is; the folder opens with it selected.
		cmd := exec.Command(filepath.Join(os.Getenv("WINDIR"), "explorer.exe"))
		cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
		return cmd.Start()
	case "upload":
		return uploadInto(path)
	}
	return errors.New("Ação desconhecida.")
}

// pinPath does what the Explorer's "Always keep on this device" and "Free up space" do; the service
// sees the change, downloads what is kept and counts the selection.
func pinPath(path string, keep bool) error {
	if _, err := call([]string{"context", "describe", path}); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return errors.New("O item não foi encontrado na pasta.")
	}
	err = withHandle(path, func(h windows.Handle) error {
		if err := cfapi.SetPinTree(h, keep, info.IsDir()); err != nil {
			return err
		}
		if !keep && !info.IsDir() {
			// A file whose changes did not reach the Drive keeps its content; the error is expected then.
			_ = cfapi.Dehydrate(h)
		}
		return nil
	})
	if err != nil {
		return errors.New("O Windows não aceitou a alteração: " + err.Error())
	}
	title, text := "Será mantido off-line", "“"+filepath.Base(path)+"” será baixado e ficará disponível sem internet."
	if !keep {
		title, text = "Cópia off-line liberada", "“"+filepath.Base(path)+"” continua no Google Drive e volta a ser baixado quando for aberto."
	}
	_, _ = call([]string{"notify", title, text})
	return nil
}

// uploadInto copies a file chosen by the user into a folder of the account; the service sends it as it
// sends any new file in the folder.
func uploadInto(folder string) error {
	describe, err := call([]string{"context", "describe", folder})
	if err != nil {
		return err
	}
	if !strings.Contains(describe, `"IsDir":true`) {
		return errors.New("Escolha uma pasta da conta.")
	}
	source, ok := chooseFile("Enviar arquivo para esta pasta")
	if !ok {
		return nil
	}
	if err := copyNew(source, filepath.Join(folder, filepath.Base(source))); err != nil {
		return err
	}
	_, _ = call([]string{"notify", "Arquivo na fila de envio", "“" + filepath.Base(source) + "” vai para o Google Drive em alguns segundos."})
	return nil
}

// copyNew copies a file to a name that must not exist yet.
func copyNew(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return errors.New("Não foi possível ler o arquivo escolhido.")
	}
	defer in.Close()
	if info, err := in.Stat(); err != nil || info.IsDir() {
		return errors.New("Escolha um arquivo deste computador.")
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, os.ErrExist) {
		return errors.New("Já existe um item com esse nome na pasta de destino.")
	}
	if err != nil {
		return errors.New("Não foi possível criar o arquivo na pasta.")
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(target)
		return errors.New("A cópia do arquivo não terminou.")
	}
	return nil
}

func showError(text string) {
	message, _ := windows.UTF16PtrFromString(text)
	title, _ := windows.UTF16PtrFromString("GCP-Drive")
	_, _ = windows.MessageBox(0, message, title, windows.MB_OK|windows.MB_ICONWARNING|windows.MB_SETFOREGROUND)
}

var (
	procOpenClipboard    = user32.NewProc("OpenClipboard")
	procCloseClipboard   = user32.NewProc("CloseClipboard")
	procEmptyClipboard   = user32.NewProc("EmptyClipboard")
	procSetClipboardData = user32.NewProc("SetClipboardData")
	procGlobalAlloc      = kernel32.NewProc("GlobalAlloc")
	procGlobalFree       = kernel32.NewProc("GlobalFree")
	procGlobalLock       = kernel32.NewProc("GlobalLock")
	procGlobalUnlock     = kernel32.NewProc("GlobalUnlock")
	comdlg32             = windows.NewLazySystemDLL("comdlg32.dll")
	procGetOpenFileName  = comdlg32.NewProc("GetOpenFileNameW")
)

// copyText puts text on the clipboard.
func copyText(text string) error {
	data, err := windows.UTF16FromString(text)
	if err != nil {
		return err
	}
	if ok, _, err := procOpenClipboard.Call(0); ok == 0 {
		return err
	}
	defer procCloseClipboard.Call()
	procEmptyClipboard.Call()
	const movable, unicodeText = 0x0002, 13
	size := uintptr(len(data) * 2)
	memory, _, err := procGlobalAlloc.Call(movable, size)
	if memory == 0 {
		return err
	}
	target, _, err := procGlobalLock.Call(memory)
	if target == 0 {
		procGlobalFree.Call(memory)
		return err
	}
	// The address comes from GlobalLock, outside Go's heap.
	copy(unsafe.Slice((*uint16)(*(*unsafe.Pointer)(unsafe.Pointer(&target))), len(data)), data)
	procGlobalUnlock.Call(memory)
	if ok, _, err := procSetClipboardData.Call(unicodeText, memory); ok == 0 {
		procGlobalFree.Call(memory)
		return err
	}
	// The clipboard owns the memory now.
	return nil
}

type openFileName struct {
	StructSize      uint32
	Owner           uintptr
	Instance        uintptr
	Filter          *uint16
	CustomFilter    *uint16
	MaxCustomFilter uint32
	FilterIndex     uint32
	File            *uint16
	MaxFile         uint32
	FileTitle       *uint16
	MaxFileTitle    uint32
	InitialDir      *uint16
	Title           *uint16
	Flags           uint32
	FileOffset      uint16
	FileExtension   uint16
	DefExt          *uint16
	CustData        uintptr
	Hook            uintptr
	TemplateName    *uint16
	ReservedPointer uintptr
	Reserved        uint32
	FlagsEx         uint32
}

// The layout must match OPENFILENAMEW on 64-bit systems.
var _ [152]byte = [unsafe.Sizeof(openFileName{})]byte{}

// chooseFile asks for one existing file in the Windows dialog.
func chooseFile(title string) (string, bool) {
	buffer := make([]uint16, 32768)
	caption, _ := windows.UTF16PtrFromString(title)
	filter, _ := windows.UTF16FromString("Todos os arquivos\x00*.*\x00")
	const fileMustExist, pathMustExist, explorer, noChangeDir = 0x1000, 0x800, 0x80000, 0x8
	dialog := openFileName{File: &buffer[0], MaxFile: uint32(len(buffer)), Title: caption, Filter: &filter[0], FilterIndex: 1,
		Flags: fileMustExist | pathMustExist | explorer | noChangeDir}
	dialog.StructSize = uint32(unsafe.Sizeof(dialog))
	if ok, _, _ := procGetOpenFileName.Call(uintptr(unsafe.Pointer(&dialog))); ok == 0 {
		return "", false
	}
	return windows.UTF16ToString(buffer), true
}

// autostartState reads, and with "on" or "off" changes, whether the service starts with Windows. The
// installer writes the same value.
func autostartState(args []string) (any, error) {
	const runKey, name = `Software\Microsoft\Windows\CurrentVersion\Run`, "GCP-Drive"
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return nil, errors.New("Não foi possível ler a inicialização do Windows.")
	}
	defer key.Close()
	if len(args) > 0 {
		switch args[0] {
		case "on":
			exe, err := os.Executable()
			if err == nil {
				err = key.SetStringValue(name, `"`+exe+`" daemon`)
			}
			if err != nil {
				return nil, errors.New("Não foi possível ativar a inicialização com o Windows.")
			}
		case "off":
			if err := key.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
				return nil, errors.New("Não foi possível desativar a inicialização com o Windows.")
			}
		}
	}
	_, _, err = key.GetStringValue(name)
	return err == nil, nil
}
