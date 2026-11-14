package cfapi

import (
	"fmt"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	cldapi                     = windows.NewLazySystemDLL("cldapi.dll")
	procGetPlatformInfo        = cldapi.NewProc("CfGetPlatformInfo")
	procRegisterSyncRoot       = cldapi.NewProc("CfRegisterSyncRoot")
	procUnregisterSyncRoot     = cldapi.NewProc("CfUnregisterSyncRoot")
	procConnectSyncRoot        = cldapi.NewProc("CfConnectSyncRoot")
	procDisconnectSyncRoot     = cldapi.NewProc("CfDisconnectSyncRoot")
	procCreatePlaceholders     = cldapi.NewProc("CfCreatePlaceholders")
	procExecute                = cldapi.NewProc("CfExecute")
	procReportProviderProgress = cldapi.NewProc("CfReportProviderProgress")
	procConvertToPlaceholder   = cldapi.NewProc("CfConvertToPlaceholder")
	procDehydratePlaceholder   = cldapi.NewProc("CfDehydratePlaceholder")
	procSetInSyncState         = cldapi.NewProc("CfSetInSyncState")
	procUpdatePlaceholder      = cldapi.NewProc("CfUpdatePlaceholder")
	procGetPlaceholderInfo     = cldapi.NewProc("CfGetPlaceholderInfo")
	procHydratePlaceholder     = cldapi.NewProc("CfHydratePlaceholder")
	procSetPinState            = cldapi.NewProc("CfSetPinState")
	procRevertPlaceholder      = cldapi.NewProc("CfRevertPlaceholder")
)

// Error is a failed HRESULT.
type Error uint32

func (e Error) Error() string {
	if e&0xFFFF0000 == 0x80070000 {
		return fmt.Sprintf("HRESULT 0x%08X (%s)", uint32(e), windows.Errno(e&0xFFFF).Error())
	}
	return fmt.Sprintf("HRESULT 0x%08X", uint32(e))
}

// ErrCanceled answers a transfer whose reader gave up; it is not a failure of the provider.
const ErrCanceled = Error(0x8007018E)

func check(r uintptr) error {
	if int32(r) >= 0 {
		return nil
	}
	return Error(uint32(r))
}

// Available reports whether this Windows has the Cloud Files API.
func Available() error { return procRegisterSyncRoot.Find() }

// PlatformInfo returns the build, revision and integration number of the Cloud Files platform.
func PlatformInfo() (build, revision, integration uint32, err error) {
	var info [3]uint32
	if err = procGetPlatformInfo.Find(); err != nil {
		return
	}
	r, _, _ := procGetPlatformInfo.Call(uintptr(unsafe.Pointer(&info)))
	return info[0], info[1], info[2], check(r)
}

// Hydration and population policies.
const (
	HydrationPartial     = 0
	HydrationProgressive = 1
	HydrationFull        = 2
	HydrationAlwaysFull  = 3

	HydrationModifierAutoDehydration = 4

	PopulationPartial    = 0
	PopulationFull       = 2
	PopulationAlwaysFull = 3

	RegisterUpdate = 1
)

type syncRegistration struct {
	StructSize         uint32
	ProviderName       *uint16
	ProviderVersion    *uint16
	SyncRootIdentity   unsafe.Pointer
	SyncRootIdentityLn uint32
	FileIdentity       unsafe.Pointer
	FileIdentityLn     uint32
	ProviderID         windows.GUID
}

type syncPolicies struct {
	StructSize            uint32
	HydrationPrimary      uint16
	HydrationModifier     uint16
	PopulationPrimary     uint16
	PopulationModifier    uint16
	InSync                uint32
	HardLink              uint32
	PlaceholderManagement uint32
}

// Root describes a sync root to register.
type Root struct {
	Path              string
	Provider, Version string
	Identity          []byte
	ProviderID        windows.GUID
	Hydration         uint16
	HydrationModifier uint16
	Population        uint16
	Flags             uint32
}

func bytesPtr(b []byte) unsafe.Pointer {
	if len(b) == 0 {
		return nil
	}
	return unsafe.Pointer(&b[0])
}

// Register makes a folder a sync root of this provider.
func Register(root Root) error {
	path, err := windows.UTF16PtrFromString(root.Path)
	if err != nil {
		return err
	}
	name, _ := windows.UTF16PtrFromString(root.Provider)
	version, _ := windows.UTF16PtrFromString(root.Version)
	reg := syncRegistration{ProviderName: name, ProviderVersion: version, SyncRootIdentity: bytesPtr(root.Identity),
		SyncRootIdentityLn: uint32(len(root.Identity)), ProviderID: root.ProviderID}
	reg.StructSize = uint32(unsafe.Sizeof(reg))
	pol := syncPolicies{HydrationPrimary: root.Hydration, HydrationModifier: root.HydrationModifier, PopulationPrimary: root.Population}
	pol.StructSize = uint32(unsafe.Sizeof(pol))
	r, _, _ := procRegisterSyncRoot.Call(uintptr(unsafe.Pointer(path)), uintptr(unsafe.Pointer(&reg)), uintptr(unsafe.Pointer(&pol)), uintptr(root.Flags))
	runtime.KeepAlive(root)
	return check(r)
}

// Unregister removes the sync root registration; the files stay.
func Unregister(path string) error {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	r, _, _ := procUnregisterSyncRoot.Call(uintptr(unsafe.Pointer(p)))
	return check(r)
}

const (
	cbFetchData               = 0
	cbCancelFetchData         = 2
	cbFetchPlaceholders       = 3
	cbNone                    = 0xFFFFFFFF
	opTransferData            = 0
	opTransferPlaceholders    = 4
	connectRequireProcessInfo = 2
	connectRequireFullPath    = 4
)

type callbackInfo struct {
	StructSize         uint32
	ConnectionKey      int64
	CallbackContext    uintptr
	VolumeGuidName     *uint16
	VolumeDosName      *uint16
	VolumeSerialNumber uint32
	SyncRootFileID     int64
	SyncRootIdentity   unsafe.Pointer
	SyncRootIdentityLn uint32
	FileID             int64
	FileSize           int64
	FileIdentity       unsafe.Pointer
	FileIdentityLn     uint32
	NormalizedPath     *uint16
	TransferKey        int64
	PriorityHint       uint8
	CorrelationVector  unsafe.Pointer
	ProcessInfo        unsafe.Pointer
	RequestKey         int64
}

// callbackParams is the common head of CF_CALLBACK_PARAMETERS; the union starts at offset 8.
type callbackParams struct {
	ParamSize uint32
	_         uint32
	Flags     uint32
	_         uint32
}

type paramsFetchData struct {
	callbackParams
	RequiredOffset, RequiredLength int64
	OptionalOffset, OptionalLength int64
}

type paramsCancel struct {
	callbackParams
	Offset, Length int64
}

type paramsFetchPlaceholders struct {
	callbackParams
	Pattern *uint16
}

type callbackRegistration struct {
	Type     uint32
	Callback uintptr
}

type operationInfo struct {
	StructSize        uint32
	Type              uint32
	ConnectionKey     int64
	TransferKey       int64
	CorrelationVector unsafe.Pointer
	SyncStatus        unsafe.Pointer
	RequestKey        int64
}

type opParamsTransferData struct {
	ParamSize uint32
	_         uint32
	Flags     uint32
	Status    int32
	Buffer    unsafe.Pointer
	Offset    int64
	Length    int64
}

type opParamsTransferPlaceholders struct {
	ParamSize uint32
	_         uint32
	Flags     uint32
	Status    int32
	Total     int64
	Array     unsafe.Pointer
	Count     uint32
	Processed uint32
}

type placeholderCreateInfo struct {
	RelativeFileName *uint16
	CreationTime     int64
	LastAccessTime   int64
	LastWriteTime    int64
	ChangeTime       int64
	FileAttributes   uint32
	FileSize         int64
	FileIdentity     unsafe.Pointer
	FileIdentityLn   uint32
	Flags            uint32
	Result           int32
	CreateUsn        int64
}

// Request identifies one callback from the platform; it stays valid after the callback returns.
type Request struct {
	connection, transfer, request int64
	// Path is the file or folder, relative to its volume.
	Path     string
	Identity []byte
	FileSize int64
}

// Transfer identifies the open file a request belongs to; a cancellation carries the same value.
func (r *Request) Transfer() int64 { return r.transfer }

// Callbacks receive the platform's requests. They run on a system thread and must return quickly.
type Callbacks struct {
	FetchData         func(r *Request, offset, length int64)
	CancelFetchData   func(r *Request, offset, length int64)
	FetchPlaceholders func(r *Request, pattern string)
}

// Connection is a connected sync root.
type Connection struct {
	key int64
	id  uintptr
	cb  Callbacks
}

var (
	connMu      sync.Mutex
	connections = map[uintptr]*Connection{}
	nextConn    uintptr
	tableOnce   sync.Once
	table       []callbackRegistration
)

func dispatch(kind uint32) uintptr {
	return windows.NewCallback(func(info *callbackInfo, params *callbackParams) uintptr {
		connMu.Lock()
		c := connections[info.CallbackContext]
		connMu.Unlock()
		if c == nil {
			return 0
		}
		r := &Request{connection: info.ConnectionKey, transfer: info.TransferKey, request: info.RequestKey,
			Path: windows.UTF16PtrToString(info.NormalizedPath), FileSize: info.FileSize}
		if info.FileIdentityLn > 0 && info.FileIdentity != nil {
			r.Identity = append([]byte(nil), unsafe.Slice((*byte)(info.FileIdentity), info.FileIdentityLn)...)
		}
		switch kind {
		case cbFetchData:
			p := (*paramsFetchData)(unsafe.Pointer(params))
			if c.cb.FetchData != nil {
				c.cb.FetchData(r, p.RequiredOffset, p.RequiredLength)
			}
		case cbCancelFetchData:
			p := (*paramsCancel)(unsafe.Pointer(params))
			if c.cb.CancelFetchData != nil {
				c.cb.CancelFetchData(r, p.Offset, p.Length)
			}
		case cbFetchPlaceholders:
			p := (*paramsFetchPlaceholders)(unsafe.Pointer(params))
			if c.cb.FetchPlaceholders != nil {
				c.cb.FetchPlaceholders(r, windows.UTF16PtrToString(p.Pattern))
			}
		}
		return 0
	})
}

// Connect starts receiving the callbacks of a registered sync root.
func Connect(path string, cb Callbacks) (*Connection, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	// Callback thunks cannot be released, so one set serves every connection.
	tableOnce.Do(func() {
		table = []callbackRegistration{{cbFetchData, dispatch(cbFetchData)}, {cbCancelFetchData, dispatch(cbCancelFetchData)},
			{cbFetchPlaceholders, dispatch(cbFetchPlaceholders)}, {cbNone, 0}}
	})
	c := &Connection{cb: cb}
	connMu.Lock()
	nextConn++
	c.id = nextConn
	connections[c.id] = c
	connMu.Unlock()
	r, _, _ := procConnectSyncRoot.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&table[0])), c.id,
		connectRequireProcessInfo|connectRequireFullPath, uintptr(unsafe.Pointer(&c.key)))
	if err := check(r); err != nil {
		connMu.Lock()
		delete(connections, c.id)
		connMu.Unlock()
		return nil, err
	}
	return c, nil
}

// Close stops the callbacks.
func (c *Connection) Close() error {
	r, _, _ := procDisconnectSyncRoot.Call(uintptr(c.key))
	connMu.Lock()
	delete(connections, c.id)
	connMu.Unlock()
	return check(r)
}

func (r *Request) execute(kind uint32, params unsafe.Pointer) error {
	info := operationInfo{Type: kind, ConnectionKey: r.connection, TransferKey: r.transfer, RequestKey: r.request}
	info.StructSize = uint32(unsafe.Sizeof(info))
	res, _, _ := procExecute.Call(uintptr(unsafe.Pointer(&info)), uintptr(params))
	return check(res)
}

// TransferData delivers bytes of the file. offset and len(data) must be multiples of 4096 unless the data ends the file.
func (r *Request) TransferData(data []byte, offset int64) error {
	p := opParamsTransferData{Buffer: bytesPtr(data), Offset: offset, Length: int64(len(data))}
	p.ParamSize = uint32(unsafe.Sizeof(p))
	err := r.execute(opTransferData, unsafe.Pointer(&p))
	runtime.KeepAlive(data)
	return err
}

// StatusUnsuccessful is the generic NTSTATUS failure.
const StatusUnsuccessful = int32(-1073741823) // 0xC0000001

// FailData tells the platform the range cannot be delivered.
func (r *Request) FailData(offset, length int64, status int32) error {
	p := opParamsTransferData{Status: status, Offset: offset, Length: length}
	p.ParamSize = uint32(unsafe.Sizeof(p))
	return r.execute(opTransferData, unsafe.Pointer(&p))
}

// Progress reports how much of a hydration is done, for the Explorer's progress display.
func (r *Request) Progress(total, completed int64) error {
	res, _, _ := procReportProviderProgress.Call(uintptr(r.connection), uintptr(r.transfer), uintptr(total), uintptr(completed))
	return check(res)
}

// Placeholder is one file or folder to show without its content.
type Placeholder struct {
	Name     string
	Identity []byte
	Dir      bool
	Size     int64
	Modified time.Time
	// InSync marks the item as identical to the cloud.
	InSync bool
	// Err is the per-item result after a call.
	Err error
}

const (
	placeholderMarkInSync         = 2
	transferDisableOnDemand       = 2
	fileAttributeDirectory        = 0x10
	fileAttributeNormal           = 0x80
	epochDifference100ns    int64 = 116444736000000000
)

func filetime(t time.Time) int64 {
	if t.IsZero() {
		t = time.Now()
	}
	return t.UnixNano()/100 + epochDifference100ns
}

func buildPlaceholders(list []Placeholder) ([]placeholderCreateInfo, []*uint16) {
	out := make([]placeholderCreateInfo, len(list))
	names := make([]*uint16, len(list))
	for i := range list {
		p := &list[i]
		names[i], _ = windows.UTF16PtrFromString(p.Name)
		t := filetime(p.Modified)
		out[i] = placeholderCreateInfo{RelativeFileName: names[i], CreationTime: t, LastAccessTime: t, LastWriteTime: t, ChangeTime: t,
			FileAttributes: fileAttributeNormal, FileSize: p.Size, FileIdentity: bytesPtr(p.Identity), FileIdentityLn: uint32(len(p.Identity))}
		if p.Dir {
			out[i].FileAttributes, out[i].FileSize = fileAttributeDirectory, 0
		}
		if p.InSync {
			out[i].Flags |= placeholderMarkInSync
		}
	}
	return out, names
}

func collect(list []Placeholder, infos []placeholderCreateInfo) {
	for i := range list {
		list[i].Err = check(uintptr(uint32(infos[i].Result)))
	}
}

// FailPlaceholders tells the platform the folder cannot be listed now.
func (r *Request) FailPlaceholders(status int32) error {
	p := opParamsTransferPlaceholders{Status: status}
	p.ParamSize = uint32(unsafe.Sizeof(p))
	return r.execute(opTransferPlaceholders, unsafe.Pointer(&p))
}

// TransferPlaceholders answers FetchPlaceholders with entries of the folder, in one or more calls.
// total is the size of the whole listing; done marks the folder as complete.
func (r *Request) TransferPlaceholders(list []Placeholder, total int, done bool) error {
	infos, names := buildPlaceholders(list)
	p := opParamsTransferPlaceholders{Total: int64(total), Count: uint32(len(list))}
	if len(infos) > 0 {
		p.Array = unsafe.Pointer(&infos[0])
	}
	if done {
		p.Flags = transferDisableOnDemand
	}
	p.ParamSize = uint32(unsafe.Sizeof(p))
	err := r.execute(opTransferPlaceholders, unsafe.Pointer(&p))
	runtime.KeepAlive(names)
	runtime.KeepAlive(list)
	collect(list, infos)
	return err
}

// CreatePlaceholders creates entries inside dir, a folder of a sync root.
func CreatePlaceholders(dir string, list []Placeholder) error {
	if len(list) == 0 {
		return nil
	}
	base, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return err
	}
	infos, names := buildPlaceholders(list)
	var processed uint32
	res, _, _ := procCreatePlaceholders.Call(uintptr(unsafe.Pointer(base)), uintptr(unsafe.Pointer(&infos[0])), uintptr(len(infos)), 0, uintptr(unsafe.Pointer(&processed)))
	runtime.KeepAlive(names)
	runtime.KeepAlive(list)
	collect(list, infos)
	return check(res)
}

// ConvertToPlaceholder turns an ordinary file or folder of a sync root into a placeholder with its content present.
func ConvertToPlaceholder(handle windows.Handle, identity []byte, inSync bool) error {
	flags := uintptr(0)
	if inSync {
		flags = 1
	}
	res, _, _ := procConvertToPlaceholder.Call(uintptr(handle), uintptr(bytesPtr(identity)), uintptr(len(identity)), flags, 0, 0)
	runtime.KeepAlive(identity)
	return check(res)
}

// Dehydrate releases the local content of an in-sync placeholder.
func Dehydrate(handle windows.Handle) error {
	res, _, _ := procDehydratePlaceholder.Call(uintptr(handle), 0, ^uintptr(0), 0, 0)
	return check(res)
}

// Hydrate downloads the whole content of a placeholder through the provider's own callbacks and returns when it is on disk.
func Hydrate(handle windows.Handle) error {
	res, _, _ := procHydratePlaceholder.Call(uintptr(handle), 0, ^uintptr(0), 0, 0)
	return check(res)
}

// SetPin does what the Explorer's "always keep on this device" (keep) and "free up space" commands do to
// the pin state of a file or folder; the content follows through Hydrate and Dehydrate.
func SetPin(handle windows.Handle, keep bool) error {
	state := uintptr(2)
	if keep {
		state = 1
	}
	res, _, _ := procSetPinState.Call(uintptr(handle), state, 0, 0)
	return check(res)
}

// Revert turns a placeholder whose content is on disk back into an ordinary file or folder.
func Revert(handle windows.Handle) error {
	res, _, _ := procRevertPlaceholder.Call(uintptr(handle), 0, 0)
	return check(res)
}

// SetInSync marks a placeholder as identical to the cloud, or as having changes to send.
func SetInSync(handle windows.Handle, inSync bool) error {
	state := uintptr(0)
	if inSync {
		state = 1
	}
	res, _, _ := procSetInSyncState.Call(uintptr(handle), state, 0, 0)
	return check(res)
}

// The layouts above must match cfapi.h on 64-bit Windows; a mismatch stops the build.
var (
	_ [72]byte  = [unsafe.Sizeof(syncRegistration{})]byte{}
	_ [24]byte  = [unsafe.Sizeof(syncPolicies{})]byte{}
	_ [152]byte = [unsafe.Sizeof(callbackInfo{})]byte{}
	_ [144]byte = [unsafe.Offsetof(callbackInfo{}.RequestKey)]byte{}
	_ [112]byte = [unsafe.Offsetof(callbackInfo{}.TransferKey)]byte{}
	_ [16]byte  = [unsafe.Offsetof(paramsFetchData{}.RequiredOffset)]byte{}
	_ [16]byte  = [unsafe.Offsetof(paramsFetchPlaceholders{}.Pattern)]byte{}
	_ [16]byte  = [unsafe.Sizeof(callbackRegistration{})]byte{}
	_ [48]byte  = [unsafe.Sizeof(operationInfo{})]byte{}
	_ [40]byte  = [unsafe.Sizeof(opParamsTransferData{})]byte{}
	_ [40]byte  = [unsafe.Sizeof(opParamsTransferPlaceholders{})]byte{}
	_ [88]byte  = [unsafe.Sizeof(placeholderCreateInfo{})]byte{}
	_ [56]byte  = [unsafe.Offsetof(placeholderCreateInfo{}.FileIdentity)]byte{}
)

type fsMetadata struct {
	CreationTime   int64
	LastAccessTime int64
	LastWriteTime  int64
	ChangeTime     int64
	FileAttributes uint32
	FileSize       int64
}

var _ [48]byte = [unsafe.Sizeof(fsMetadata{})]byte{}

// Update gives an in-sync file placeholder a new size, time and identity and releases its old content.
// It fails when the placeholder has local changes, unless discard is set: then those changes are dropped.
func Update(handle windows.Handle, size int64, modified time.Time, identity []byte, discard bool) error {
	t := filetime(modified)
	meta := fsMetadata{CreationTime: t, LastAccessTime: t, LastWriteTime: t, ChangeTime: t, FileAttributes: fileAttributeNormal, FileSize: size}
	const verifyInSync, markInSync, dehydrate = 1, 2, 4
	flags := uintptr(verifyInSync | markInSync | dehydrate)
	if discard {
		flags = markInSync | dehydrate
	}
	res, _, _ := procUpdatePlaceholder.Call(uintptr(handle), uintptr(unsafe.Pointer(&meta)), uintptr(bytesPtr(identity)), uintptr(len(identity)),
		0, 0, flags, 0, 0)
	runtime.KeepAlive(identity)
	return check(res)
}

// SetIdentity replaces the identity of a placeholder and keeps its content; inSync marks it as identical to the cloud.
func SetIdentity(handle windows.Handle, identity []byte, inSync bool) error {
	flags := uintptr(0)
	if inSync {
		flags = 2
	}
	res, _, _ := procUpdatePlaceholder.Call(uintptr(handle), 0, uintptr(bytesPtr(identity)), uintptr(len(identity)), 0, 0, flags, 0, 0)
	runtime.KeepAlive(identity)
	return check(res)
}

// State is what the platform knows about a file or folder of a sync root.
type State struct {
	Placeholder bool
	// InSync is cleared by the platform when the content or the name changes on this computer.
	InSync   bool
	Identity []byte
}

const errNotACloudFile = Error(0x80070178)

// Stat reads the placeholder state of a path without opening its content.
func Stat(path string) (State, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return State{}, err
	}
	handle, err := windows.CreateFile(p, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return State{}, err
	}
	defer windows.CloseHandle(handle)
	// CF_PLACEHOLDER_BASIC_INFO: pin state, in-sync state, two file IDs, identity length, identity.
	const inSyncAt, lengthAt, identityAt = 4, 24, 28
	buf := make([]byte, identityAt+4096+4)
	var n uint32
	res, _, _ := procGetPlaceholderInfo.Call(uintptr(handle), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), uintptr(unsafe.Pointer(&n)))
	if err := check(res); err != nil {
		if err == errNotACloudFile {
			return State{}, nil
		}
		return State{}, err
	}
	state := State{Placeholder: true, InSync: *(*uint32)(unsafe.Pointer(&buf[inSyncAt])) == 1}
	if length := *(*uint32)(unsafe.Pointer(&buf[lengthAt])); length > 0 && identityAt+int(length) <= len(buf) {
		state.Identity = append([]byte(nil), buf[identityAt:identityAt+int(length)]...)
	}
	return state, nil
}

// Open returns a handle suited to Update, Dehydrate, SetInSync and ConvertToPlaceholder.
func Open(path string) (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	return windows.CreateFile(p, windows.FILE_READ_ATTRIBUTES|windows.FILE_WRITE_DATA, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
}
