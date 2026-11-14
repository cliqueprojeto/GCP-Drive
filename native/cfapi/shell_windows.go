package cfapi

import (
	"errors"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The Explorer shows a sync root in its navigation pane, with state icons and the "always keep on this
// device" and "free up space" commands, only when the root is registered through the Windows Runtime
// class StorageProviderSyncRootManager. That class also registers the root with the Cloud Files platform.

var (
	combase                    = windows.NewLazySystemDLL("combase.dll")
	procRoInitialize           = combase.NewProc("RoInitialize")
	procRoGetActivationFactory = combase.NewProc("RoGetActivationFactory")
	procRoActivateInstance     = combase.NewProc("RoActivateInstance")
	procWindowsCreateString    = combase.NewProc("WindowsCreateString")
	procWindowsDeleteString    = combase.NewProc("WindowsDeleteString")
)

var (
	iidSyncRootInfo          = windows.GUID{Data1: 0x7c1305c4, Data2: 0x99f9, Data3: 0x41ac, Data4: [8]byte{0x89, 0x04, 0xab, 0x05, 0x5d, 0x65, 0x49, 0x26}}
	iidSyncRootManager       = windows.GUID{Data1: 0x3e99fbbf, Data2: 0x8fe3, Data3: 0x4b40, Data4: [8]byte{0xab, 0xc7, 0xf6, 0xfc, 0x3d, 0x74, 0xc9, 0x8e}}
	iidStorageFolderStatics  = windows.GUID{Data1: 0x08f327ff, Data2: 0x85d5, Data3: 0x48b9, Data4: [8]byte{0xae, 0xe9, 0x28, 0x51, 0x1e, 0x33, 0x9f, 0x9f}}
	iidCryptographicBuffer   = windows.GUID{Data1: 0x320b7e22, Data2: 0x3cb0, Data3: 0x4cdf, Data4: [8]byte{0x86, 0x63, 0x1d, 0x28, 0x91, 0x00, 0x65, 0xeb}}
	iidAsyncInfo             = windows.GUID{Data1: 0x00000036, Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	classSyncRootInfo        = "Windows.Storage.Provider.StorageProviderSyncRootInfo"
	classSyncRootManager     = "Windows.Storage.Provider.StorageProviderSyncRootManager"
	classStorageFolder       = "Windows.Storage.StorageFolder"
	classCryptographicBuffer = "Windows.Security.Cryptography.CryptographicBuffer"
)

// Method slots after the six of IInspectable, in the order of the interface definitions.
const (
	slotQueryInterface = 0
	slotRelease        = 2

	slotInfoSetID          = 7
	slotInfoSetContext     = 9
	slotInfoSetPath        = 11
	slotInfoSetDisplayName = 13
	slotInfoSetIcon        = 15
	slotInfoSetHydration   = 17
	slotInfoSetHydrationMo = 19
	slotInfoSetPopulation  = 21
	slotInfoSetInSync      = 23
	slotInfoSetHardlink    = 25
	slotInfoSetSiblings    = 27
	slotInfoSetVersion     = 29
	slotInfoSetAllowPin    = 33

	slotManagerRegister   = 6
	slotManagerUnregister = 7

	slotFolderFromPath     = 6
	slotBufferFromBytes    = 9
	slotAsyncStatus        = 7
	slotAsyncErrorCode     = 8
	slotOperationGetResult = 8
)

// invoke calls a method of a COM object by its slot in the method table.
func invoke(obj unsafe.Pointer, slot int, args ...uintptr) error {
	table := (*[64]uintptr)(*(*unsafe.Pointer)(obj))
	r, _, _ := syscall.SyscallN(table[slot], append([]uintptr{uintptr(obj)}, args...)...)
	return check(r)
}

func release(obj unsafe.Pointer) {
	if obj != nil {
		_ = invoke(obj, slotRelease)
	}
}

type hstring struct{ h uintptr }

func newHString(s string) (hstring, error) {
	text, err := windows.UTF16FromString(s)
	if err != nil {
		return hstring{}, err
	}
	var out hstring
	r, _, _ := procWindowsCreateString.Call(uintptr(unsafe.Pointer(&text[0])), uintptr(len(text)-1), uintptr(unsafe.Pointer(&out.h)))
	runtime.KeepAlive(text)
	return out, check(r)
}

func (s hstring) free() { procWindowsDeleteString.Call(s.h) }

func factory(class string, iid *windows.GUID) (unsafe.Pointer, error) {
	name, err := newHString(class)
	if err != nil {
		return nil, err
	}
	defer name.free()
	var out unsafe.Pointer
	r, _, _ := procRoGetActivationFactory.Call(name.h, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&out)))
	return out, check(r)
}

// onRuntimeThread runs do on a thread that entered the Windows Runtime.
func onRuntimeThread(do func() error) error {
	if err := procRoInitialize.Find(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		const multithreaded, changedMode = 1, 0x80010106
		if r, _, _ := procRoInitialize.Call(multithreaded); int32(r) < 0 && uint32(r) != changedMode {
			done <- Error(uint32(r))
			return
		}
		done <- do()
	}()
	return <-done
}

// ShellRoot describes a sync root as the Explorer shows it.
type ShellRoot struct {
	// ID has the form provider!user-SID!account.
	ID, Path          string
	DisplayName, Icon string
	Version           string
	Context           []byte
	Hydration         int32
	HydrationModifier uint32
}

// RegisterShell registers or updates a sync root with the Explorer and the Cloud Files platform.
// Folders are filled on demand and files can be pinned.
func RegisterShell(root ShellRoot) error {
	return onRuntimeThread(func() error {
		folder, err := folderOf(root.Path)
		if err != nil {
			return err
		}
		defer release(folder)
		context, err := bufferOf(root.Context)
		if err != nil {
			return err
		}
		defer release(context)

		class, err := newHString(classSyncRootInfo)
		if err != nil {
			return err
		}
		defer class.free()
		var object, info unsafe.Pointer
		if r, _, _ := procRoActivateInstance.Call(class.h, uintptr(unsafe.Pointer(&object))); int32(r) < 0 {
			return Error(uint32(r))
		}
		defer release(object)
		if err := invoke(object, slotQueryInterface, uintptr(unsafe.Pointer(&iidSyncRootInfo)), uintptr(unsafe.Pointer(&info))); err != nil {
			return err
		}
		defer release(info)

		for _, text := range []struct {
			slot  int
			value string
		}{{slotInfoSetID, root.ID}, {slotInfoSetDisplayName, root.DisplayName}, {slotInfoSetIcon, root.Icon}, {slotInfoSetVersion, root.Version}} {
			value, err := newHString(text.value)
			if err != nil {
				return err
			}
			err = invoke(info, text.slot, value.h)
			value.free()
			if err != nil {
				return err
			}
		}
		const populationFull, allow = 1, 1
		for _, set := range []struct {
			slot  int
			value uintptr
		}{{slotInfoSetContext, uintptr(context)}, {slotInfoSetPath, uintptr(folder)}, {slotInfoSetHydration, uintptr(root.Hydration)},
			{slotInfoSetHydrationMo, uintptr(root.HydrationModifier)}, {slotInfoSetPopulation, populationFull}, {slotInfoSetInSync, 0},
			{slotInfoSetHardlink, 0}, {slotInfoSetSiblings, 0}, {slotInfoSetAllowPin, allow}} {
			if err := invoke(info, set.slot, set.value); err != nil {
				return err
			}
		}
		manager, err := factory(classSyncRootManager, &iidSyncRootManager)
		if err != nil {
			return err
		}
		defer release(manager)
		return invoke(manager, slotManagerRegister, uintptr(info))
	})
}

// UnregisterShell removes a sync root from the Explorer and the platform; the files stay.
func UnregisterShell(id string) error {
	return onRuntimeThread(func() error {
		manager, err := factory(classSyncRootManager, &iidSyncRootManager)
		if err != nil {
			return err
		}
		defer release(manager)
		name, err := newHString(id)
		if err != nil {
			return err
		}
		defer name.free()
		return invoke(manager, slotManagerUnregister, name.h)
	})
}

// folderOf returns the StorageFolder of an existing folder.
func folderOf(path string) (unsafe.Pointer, error) {
	statics, err := factory(classStorageFolder, &iidStorageFolderStatics)
	if err != nil {
		return nil, err
	}
	defer release(statics)
	name, err := newHString(path)
	if err != nil {
		return nil, err
	}
	defer name.free()
	var operation, async, folder unsafe.Pointer
	if err := invoke(statics, slotFolderFromPath, name.h, uintptr(unsafe.Pointer(&operation))); err != nil {
		return nil, err
	}
	defer release(operation)
	if err := invoke(operation, slotQueryInterface, uintptr(unsafe.Pointer(&iidAsyncInfo)), uintptr(unsafe.Pointer(&async))); err != nil {
		return nil, err
	}
	defer release(async)
	const started, completed = 0, 1
	for waited := 0; ; waited++ {
		var status int32
		if err := invoke(async, slotAsyncStatus, uintptr(unsafe.Pointer(&status))); err != nil {
			return nil, err
		}
		if status == completed {
			break
		}
		if status != started {
			var code uint32
			_ = invoke(async, slotAsyncErrorCode, uintptr(unsafe.Pointer(&code)))
			return nil, Error(code)
		}
		if waited > 3000 {
			return nil, errors.New("o Windows não respondeu ao pedido da pasta")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := invoke(operation, slotOperationGetResult, uintptr(unsafe.Pointer(&folder))); err != nil {
		return nil, err
	}
	return folder, nil
}

// bufferOf wraps bytes in a Windows Runtime buffer.
func bufferOf(data []byte) (unsafe.Pointer, error) {
	statics, err := factory(classCryptographicBuffer, &iidCryptographicBuffer)
	if err != nil {
		return nil, err
	}
	defer release(statics)
	var buffer unsafe.Pointer
	err = invoke(statics, slotBufferFromBytes, uintptr(len(data)), uintptr(bytesPtr(data)), uintptr(unsafe.Pointer(&buffer)))
	runtime.KeepAlive(data)
	return buffer, err
}
