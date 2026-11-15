//go:build windows

package main

import (
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The service's presence on the desktop: an icon in the notification area and the panel window.

var desk struct {
	mu     sync.Mutex
	panel  string // address that opens the panel
	window uintptr
}

var (
	user32                    = windows.NewLazySystemDLL("user32.dll")
	shell32                   = windows.NewLazySystemDLL("shell32.dll")
	kernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procGetModuleHandle       = kernel32.NewProc("GetModuleHandleW")
	procRegisterClassEx       = user32.NewProc("RegisterClassExW")
	procCreateWindowEx        = user32.NewProc("CreateWindowExW")
	procDefWindowProc         = user32.NewProc("DefWindowProcW")
	procGetMessage            = user32.NewProc("GetMessageW")
	procTranslateMessage      = user32.NewProc("TranslateMessage")
	procDispatchMessage       = user32.NewProc("DispatchMessageW")
	procPostMessage           = user32.NewProc("PostMessageW")
	procPostQuitMessage       = user32.NewProc("PostQuitMessage")
	procLoadImage             = user32.NewProc("LoadImageW")
	procCreatePopupMenu       = user32.NewProc("CreatePopupMenu")
	procAppendMenu            = user32.NewProc("AppendMenuW")
	procTrackPopupMenu        = user32.NewProc("TrackPopupMenu")
	procDestroyMenu           = user32.NewProc("DestroyMenu")
	procSetForegroundWindow   = user32.NewProc("SetForegroundWindow")
	procGetCursorPos          = user32.NewProc("GetCursorPos")
	procRegisterWindowMessage = user32.NewProc("RegisterWindowMessageW")
	procShellNotifyIcon       = shell32.NewProc("Shell_NotifyIconW")
)

type windowClass struct {
	Size, Style                        uint32
	WndProc                            uintptr
	ClsExtra, WndExtra                 int32
	Instance, Icon, Cursor, Background uintptr
	MenuName, ClassName                *uint16
	IconSm                             uintptr
}

type notifyIcon struct {
	Size            uint32
	Window          uintptr
	ID, Flags       uint32
	CallbackMessage uint32
	Icon            uintptr
	Tip             [128]uint16
	State, Mask     uint32
	Info            [256]uint16
	Version         uint32
	InfoTitle       [64]uint16
	InfoFlags       uint32
	GUID            windows.GUID
	BalloonIcon     uintptr
}

type message struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	X, Y           int32
	Private        uint32
}

// The layouts must match the Windows headers on 64-bit systems.
var (
	_ [80]byte  = [unsafe.Sizeof(windowClass{})]byte{}
	_ [976]byte = [unsafe.Sizeof(notifyIcon{})]byte{}
	_ [48]byte  = [unsafe.Sizeof(message{})]byte{}
)

// desktopNotify shows a short message from the icon next to the clock.
func desktopNotify(title, text string) {
	desk.mu.Lock()
	window := desk.window
	desk.mu.Unlock()
	if window == 0 {
		return
	}
	const nimModify, nifInfo, niifInfo = 1, 0x10, 1
	data := notifyIcon{Window: window, ID: trayIconID, Flags: nifInfo, InfoFlags: niifInfo}
	data.Size = uint32(unsafe.Sizeof(data))
	fill := func(dst []uint16, text string) {
		n := copy(dst[:len(dst)-1], windows.StringToUTF16(text))
		dst[n] = 0
	}
	fill(data.InfoTitle[:], title)
	fill(data.Info[:], text)
	procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&data)))
}

const (
	wmDestroy    = 0x0002
	wmClose      = 0x0010
	wmLeftUp     = 0x0202
	wmRightUp    = 0x0205
	wmTrayEvent  = 0x8001 // WM_APP + 1
	wmTrayRetry  = 0x8002
	cmdPanel     = 1
	cmdFolder    = 2
	cmdQuit      = 3
	trayIconID   = 1
	nimAdd       = 0
	nimDelete    = 2
	nifMessage   = 1
	nifIcon      = 2
	nifTip       = 4
	menuString   = 0
	menuSeparate = 0x800
)

// startDesktop serves the panel and shows the icon next to the clock. The returned function removes both.
func (d *Daemon) startDesktop() func() {
	address, stop, err := d.servePanel()
	if err != nil {
		return func() {}
	}
	desk.mu.Lock()
	desk.panel = address
	desk.mu.Unlock()
	go d.tray()
	if err := registerShellMenu(); err != nil {
		// The folders work without the submenu; the activity list tells why it is missing.
		for _, m := range d.list() {
			m.log("Menu do Explorador", "GCP-Drive", "Falhou", err.Error())
			break
		}
	}
	return func() {
		stop()
		desk.mu.Lock()
		window := desk.window
		desk.mu.Unlock()
		if window != 0 {
			procPostMessage.Call(window, wmClose, 0, 0)
		}
	}
}

// showPanel opens the panel in a window of its own; with an item, it opens the sharing window of that
// item. Microsoft Edge, part of Windows, draws it without tabs or address bar and with a profile of its
// own; without Edge the default browser opens it.
func (d *Daemon) showPanel(item string) error {
	desk.mu.Lock()
	address := desk.panel
	desk.mu.Unlock()
	if address == "" {
		return errors.New("O painel do GCP-Drive não está disponível.")
	}
	size := "--window-size=1080,760"
	if item != "" {
		if _, _, _, err := d.locate(d.ctx, item); err != nil {
			return err
		}
		// The path travels after the #, with the token: the window never sends it to any server.
		address = strings.Replace(address, "/#", "/share.html#", 1) + "|" + url.PathEscape(item)
		size = "--window-size=640,660"
	}
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		edge := filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe")
		if base == "" {
			continue
		}
		if _, err := os.Stat(edge); err == nil {
			cmd := exec.Command(edge, "--app="+address, size, "--no-first-run", "--no-default-browser-check",
				"--user-data-dir="+filepath.Join(localDir(), "painel"))
			if cmd.Start() == nil {
				go cmd.Wait()
				return nil
			}
		}
	}
	return openExternal(address)
}

// tray owns the notification icon: a click opens the panel, the right button shows a short menu.
func (d *Daemon) tray() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	instance, _, _ := procGetModuleHandle.Call(0)
	className, _ := windows.UTF16PtrFromString("GCPDriveTray")
	title, _ := windows.UTF16PtrFromString("GCP-Drive")
	iconFile, _ := windows.UTF16PtrFromString(iconPath())
	const imageIcon, loadFromFile, defaultSize = 1, 0x10, 0x40
	icon, _, _ := procLoadImage.Call(0, uintptr(unsafe.Pointer(iconFile)), imageIcon, 0, 0, loadFromFile|defaultSize)
	created, _ := windows.UTF16PtrFromString("TaskbarCreated")
	taskbarCreated, _, _ := procRegisterWindowMessage.Call(uintptr(unsafe.Pointer(created)))

	add := func(window uintptr) bool {
		data := notifyIcon{Window: window, ID: trayIconID, Flags: nifMessage | nifIcon | nifTip, CallbackMessage: wmTrayEvent, Icon: icon}
		data.Size = uint32(unsafe.Sizeof(data))
		copy(data.Tip[:], windows.StringToUTF16("GCP-Drive"))
		ok, _, _ := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
		return ok != 0
	}
	menu := func(window uintptr) {
		popup, _, _ := procCreatePopupMenu.Call()
		if popup == 0 {
			return
		}
		defer procDestroyMenu.Call(popup)
		for _, item := range []struct {
			id   uintptr
			text string
		}{{cmdPanel, "Abrir o painel"}, {cmdFolder, "Abrir a pasta GCP-Drive"}, {0, ""}, {cmdQuit, "Sair do GCP-Drive"}} {
			if item.id == 0 {
				procAppendMenu.Call(popup, menuSeparate, 0, 0)
				continue
			}
			text, _ := windows.UTF16PtrFromString(item.text)
			procAppendMenu.Call(popup, menuString, item.id, uintptr(unsafe.Pointer(text)))
		}
		var at struct{ X, Y int32 }
		procGetCursorPos.Call(uintptr(unsafe.Pointer(&at)))
		// The menu closes when the user clicks elsewhere only if its window is in front.
		procSetForegroundWindow.Call(window)
		const returnCommand, rightButton = 0x100, 0x2
		chosen, _, _ := procTrackPopupMenu.Call(popup, returnCommand|rightButton, uintptr(at.X), uintptr(at.Y), 0, window, 0)
		switch chosen {
		case cmdPanel:
			go d.showPanel("")
		case cmdFolder:
			go openExternal(mountRoot())
		case cmdQuit:
			d.stop()
		}
	}
	proc := windows.NewCallback(func(window, msg, wparam, lparam uintptr) uintptr {
		switch {
		case msg == wmTrayEvent && lparam&0xFFFF == wmLeftUp:
			go d.showPanel("")
		case msg == wmTrayEvent && lparam&0xFFFF == wmRightUp:
			menu(window)
		case msg == wmTrayRetry || (taskbarCreated != 0 && msg == taskbarCreated):
			// The Explorer was not ready yet, or restarted and lost its icons.
			if !add(window) {
				go func() {
					time.Sleep(5 * time.Second)
					procPostMessage.Call(window, wmTrayRetry, 0, 0)
				}()
			}
		case msg == wmDestroy:
			data := notifyIcon{Window: window, ID: trayIconID}
			data.Size = uint32(unsafe.Sizeof(data))
			procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
			procPostQuitMessage.Call(0)
		default:
			result, _, _ := procDefWindowProc.Call(window, msg, wparam, lparam)
			return result
		}
		return 0
	})
	class := windowClass{WndProc: proc, Instance: instance, ClassName: className}
	class.Size = uint32(unsafe.Sizeof(class))
	procRegisterClassEx.Call(uintptr(unsafe.Pointer(&class)))
	window, _, _ := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(title)), 0, 0, 0, 0, 0, 0, 0, instance, 0)
	if window == 0 {
		return
	}
	desk.mu.Lock()
	desk.window = window
	desk.mu.Unlock()
	procPostMessage.Call(window, wmTrayRetry, 0, 0)
	var msg message
	for {
		got, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(got) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
	desk.mu.Lock()
	desk.window = 0
	desk.mu.Unlock()
}
