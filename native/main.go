package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Daemon struct {
	mu     sync.Mutex
	set    *Settings
	sched  *Sched
	mounts map[string]*Mount
	ctx    context.Context
	down   int64
	up     int64
	stop   context.CancelFunc
}

type request struct{ Args []string }
type reply struct{ Out, Err string }

func (d *Daemon) saveSettings() error { return writeJSON(settingsPath(), d.set) }

// reload mounts accounts that were added since the last scan.
func (d *Daemon) reload() {
	accounts, _ := loadAccounts()
	for _, a := range accounts {
		d.mu.Lock()
		_, known := d.mounts[a.ID]
		d.mu.Unlock()
		if known || a.Provider != "" {
			continue
		}
		m := newMount(a, d.set, d.sched)
		if err := m.start(d.ctx); err != nil {
			m.mountErr = err.Error()
		}
		d.mu.Lock()
		d.mounts[a.ID] = m
		d.mu.Unlock()
	}
}

func (d *Daemon) list() []*Mount {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]*Mount, 0, len(d.mounts))
	for _, m := range d.mounts {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].a.Email < out[j].a.Email })
	return out
}

func (d *Daemon) mount(id string) (*Mount, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if m := d.mounts[id]; m != nil {
		return m, nil
	}
	return nil, errors.New("Conta não encontrada.")
}

func (d *Daemon) status() any {
	type transfer struct {
		Name        string
		Done, Total int64
	}
	type row struct {
		ID, Email, Name, Path, Problem, FileProblem, Provider string
		Mounted, Mirror, Paused                               bool
		MirrorPath                                            string
		MirrorStatus                                          map[string]any
		Activity                                              []Activity
		Items                                                 int
		Mapped                                                bool
		Pending                                               int
		Uploads                                               []transfer
		Downloads                                             int32
		CacheBytes, CacheLimit, Down, Up                      int64
		Offline                                               int
	}
	rows := []row{}
	for _, m := range d.list() {
		items, complete := m.meta.count()
		pending, failed := m.unsent()
		m.meta.mu.RLock()
		problem := m.meta.problem
		m.meta.mu.RUnlock()
		m.mu.Lock()
		if m.mountErr != "" {
			problem = m.mountErr
		}
		m.mu.Unlock()
		r := row{ID: m.a.ID, Email: m.a.Email, Name: m.a.Name, Path: m.path, Problem: problem, FileProblem: failed,
			Mounted: m.isMounted(), Paused: m.paused(), Items: items, Mapped: complete, Pending: pending,
			MirrorStatus: map[string]any{"Running": false, "Last": "0001-01-01T00:00:00Z", "Problem": "", "Conflicts": nil},
			Downloads:    m.cache.active.Load(), CacheBytes: m.cache.total.Load(), CacheLimit: int64(d.set.CacheGB) << 30, Down: d.down, Up: d.up}
		m.mu.Lock()
		r.Activity = append([]Activity{}, m.activity...)
		r.Offline = len(m.pins)
		for _, p := range m.pend {
			if p.sending {
				var size int64
				if info, err := os.Stat(p.data()); err == nil {
					size = info.Size()
				}
				r.Uploads = append(r.Uploads, transfer{p.Name, p.sent, size})
			}
		}
		m.mu.Unlock()
		rows = append(rows, r)
	}
	return rows
}

// locate maps a path inside a mounted account to its entry.
func (d *Daemon) locate(ctx context.Context, path string) (*Mount, entry, string, error) {
	path = filepath.Clean(path)
	for _, m := range d.list() {
		if rel, err := filepath.Rel(m.path, path); err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
			e, dir, ok := m.meta.walk(ctx, m.drive, rel)
			if !ok {
				return nil, entry{}, "", errors.New("O item não foi encontrado na unidade.")
			}
			return m, e, dir, nil
		}
	}
	return nil, entry{}, "", errors.New("Este caminho não pertence a uma unidade do GCP-Drive.")
}

func webLink(m *Mount, e entry) string {
	it := m.meta.item(e.Content.ID)
	if it == nil {
		it = e.It
	}
	switch it.ID {
	case vShared:
		return "https://drive.google.com/drive/shared-with-me"
	case vDrives:
		return "https://drive.google.com/drive/shared-drives"
	}
	if it.ID == m.meta.RootID {
		return "https://drive.google.com/drive/my-drive"
	}
	return linkOf(it)
}

func (d *Daemon) addFile(ctx context.Context, m *Mount, parent, source string) error {
	if readOnly() {
		return errors.New("A unidade está em modo somente leitura.")
	}
	info, err := os.Stat(source)
	if err != nil || info.IsDir() {
		return errors.New("Escolha um arquivo deste computador.")
	}
	_ = m.meta.ensure(ctx, m.drive, parent)
	name := filepath.Base(source)
	if _, exists := m.meta.find(parent, name); exists {
		return errors.New("Já existe um item com esse nome na pasta de destino.")
	}
	it, err := m.newLocal(ctx, parent, name)
	if err != nil {
		return err
	}
	p := m.pending(it.ID)
	in, err := os.Open(source)
	if err == nil {
		var out *os.File
		if out, err = os.OpenFile(p.data(), os.O_WRONLY|os.O_TRUNC, 0o600); err == nil {
			_, err = io.Copy(out, in)
			if cerr := out.Close(); err == nil {
				err = cerr
			}
		}
		in.Close()
	}
	if err != nil {
		m.discard(ctx, it.ID)
		m.meta.remove(it.ID)
		return errors.New("Não foi possível copiar o arquivo para a fila de envio.")
	}
	m.mu.Lock()
	p.dirty, p.closed = true, time.Now().Add(-writeBack)
	m.mu.Unlock()
	return nil
}

func (d *Daemon) contextAction(ctx context.Context, args []string) (any, error) {
	if len(args) < 2 {
		return nil, errors.New("Ação incompleta.")
	}
	action := args[0]
	m, e, _, err := d.locate(ctx, args[1])
	if err != nil {
		return nil, err
	}
	real := m.meta.item(e.Content.ID)
	needReal := func() error {
		if real == nil || real.Local {
			return errors.New("Escolha um item que já esteja no Google Drive.")
		}
		return nil
	}
	switch action {
	case "describe":
		m.mu.Lock()
		pinned := m.pins[e.Content.ID]
		m.mu.Unlock()
		return map[string]any{"Name": e.It.Name, "IsDir": e.Kind == kindDir, "Provider": "", "Offline": pinned, "Link": webLink(m, e)}, nil
	case "web", "gemini":
		return nil, openExternal(webLink(m, e))
	case "link":
		return webLink(m, e), nil
	case "offline-open":
		return nil, openExternal(filepath.Dir(filepath.Clean(args[1])))
	case "pin", "unpin":
		if err := needReal(); err != nil {
			return nil, err
		}
		return nil, m.setPin(real.ID, action == "pin")
	case "sharing":
		if err := needReal(); err != nil {
			return nil, err
		}
		var out struct {
			Permissions []struct {
				Type               string `json:"type"`
				Role               string `json:"role"`
				EmailAddress       string `json:"emailAddress"`
				DisplayName        string `json:"displayName"`
				Domain             string `json:"domain"`
				Deleted            bool   `json:"deleted"`
				AllowFileDiscovery bool   `json:"allowFileDiscovery"`
			} `json:"permissions"`
		}
		target := apiBase + "/files/" + url.PathEscape(real.ID) + "/permissions?supportsAllDrives=true&pageSize=100&fields=" +
			url.QueryEscape("permissions(type,role,emailAddress,displayName,domain,deleted,allowFileDiscovery)")
		if err := m.drive.json(ctx, prioInteractive, "GET", target, nil, &out); err != nil {
			return nil, err
		}
		list := []map[string]any{}
		for _, p := range out.Permissions {
			list = append(list, map[string]any{"Type": p.Type, "Role": p.Role, "EmailAddress": p.EmailAddress, "DisplayName": p.DisplayName,
				"Domain": p.Domain, "Deleted": p.Deleted, "AllowFileDiscovery": p.AllowFileDiscovery})
		}
		return map[string]any{"CanShare": real.CanShare, "Permissions": list}, nil
	case "share":
		if err := needReal(); err != nil {
			return nil, err
		}
		if len(args) < 5 || !strings.Contains(args[2], "@") {
			return nil, errors.New("Informe um e-mail válido.")
		}
		if !map[string]bool{"reader": true, "commenter": true, "writer": true}[args[3]] || !map[string]bool{"user": true, "group": true}[args[4]] {
			return nil, errors.New("Permissão inválida.")
		}
		return nil, m.drive.json(ctx, prioInteractive, "POST", apiBase+"/files/"+url.PathEscape(real.ID)+"/permissions?supportsAllDrives=true&sendNotificationEmail=true",
			map[string]any{"type": args[4], "role": args[3], "emailAddress": args[2]}, nil)
	case "shortcut":
		if err := needReal(); err != nil {
			return nil, err
		}
		f, err := m.drive.create(ctx, map[string]any{"name": real.Name, "mimeType": mimeLink, "parents": []string{m.meta.RootID},
			"shortcutDetails": map[string]any{"targetId": real.ID}})
		if err == nil {
			m.meta.apply(f)
		}
		return nil, err
	case "upload":
		if e.Kind != kindDir || len(args) < 3 {
			return nil, errors.New("Escolha uma pasta da unidade e um arquivo do computador.")
		}
		return nil, d.addFile(ctx, m, e.Content.ID, args[2])
	}
	return nil, errors.New("Ação desconhecida.")
}

func (d *Daemon) handle(ctx context.Context, args []string) (any, error) {
	if len(args) == 0 {
		return nil, errors.New("Comando vazio.")
	}
	account := func() (*Mount, error) {
		if len(args) < 2 {
			return nil, errors.New("Informe a conta.")
		}
		return d.mount(args[1])
	}
	switch args[0] {
	case "status":
		return d.status(), nil
	case "reload":
		d.reload()
		return nil, nil
	case "quit":
		d.stop()
		return nil, nil
	case "panel":
		return nil, d.showPanel()
	case "context":
		return d.contextAction(ctx, args[1:])
	case "settings":
		if len(args) > 1 {
			var in struct {
				DownKBps, UpKBps, CacheGB *int
				Premap                    *bool
			}
			if json.Unmarshal([]byte(args[1]), &in) != nil {
				return nil, errors.New("Configuração inválida.")
			}
			set := func(dst *int, src *int, low, high int) {
				if src != nil {
					*dst = min(max(*src, low), high)
				}
			}
			set(&d.set.DownKBps, in.DownKBps, 0, 10_000_000)
			set(&d.set.UpKBps, in.UpKBps, 0, 10_000_000)
			set(&d.set.CacheGB, in.CacheGB, 1, 2000)
			if in.Premap != nil {
				d.set.Premap = *in.Premap
			}
			if err := d.saveSettings(); err != nil {
				return nil, errors.New("Não foi possível salvar as configurações.")
			}
		}
		return map[string]any{"DownKBps": d.set.DownKBps, "UpKBps": d.set.UpKBps, "CacheGB": d.set.CacheGB, "Premap": d.set.Premap, "Version": version}, nil
	case "pause":
		m, err := account()
		if err != nil {
			return nil, err
		}
		d.mu.Lock()
		d.set.Paused[m.a.ID] = len(args) > 2 && args[2] == "on"
		d.mu.Unlock()
		return nil, d.saveSettings()
	case "quota":
		m, err := account()
		if err != nil {
			return nil, err
		}
		usage, limit := m.quota(ctx)
		return map[string]int64{"Usage": usage, "Limit": limit}, nil
	case "storage":
		m, err := account()
		if err != nil {
			return nil, err
		}
		var offline int64
		files := m.pinnedFiles(ctx)
		for _, it := range files {
			offline += m.cache.file(it).cached()
		}
		items, complete := m.meta.count()
		return map[string]any{
			"cache":   map[string]any{"Bytes": m.cache.total.Load(), "Limit": int64(d.set.CacheGB) << 30},
			"offline": map[string]any{"Bytes": offline, "Files": len(files)},
			"pending": map[string]any{"Bytes": dirBytes(m.pendDir()), "Path": m.pendDir()},
			"map":     map[string]any{"Items": items, "Complete": complete}}, nil
	case "clear-cache":
		m, err := account()
		if err != nil {
			return nil, err
		}
		m.cache.evict(true)
		return nil, nil
	case "search":
		m, err := account()
		if err != nil || len(args) < 3 {
			return nil, errors.New("Informe a conta e o texto da pesquisa.")
		}
		query := strings.ToLower(strings.TrimSpace(args[2]))
		rows := []map[string]string{}
		if _, complete := m.meta.count(); complete {
			m.meta.mu.RLock()
			for _, it := range m.meta.Items {
				if len(rows) < 200 && strings.Contains(strings.ToLower(it.Name), query) {
					rows = append(rows, map[string]string{"Name": it.Name, "Link": linkOf(it)})
				}
			}
			m.meta.mu.RUnlock()
			sort.Slice(rows, func(i, j int) bool { return rows[i]["Name"] < rows[j]["Name"] })
			return rows, nil
		}
		q := url.Values{"q": {"name contains '" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(args[2]) + "' and trashed=false"}}
		err = m.drive.list(ctx, prioInteractive, q, func(files []apiFile) {
			for _, f := range files {
				if len(rows) < 200 {
					rows = append(rows, map[string]string{"Name": f.Name, "Link": f.WebViewLink})
				}
			}
		})
		return rows, err
	case "upload":
		m, err := account()
		if err != nil || len(args) < 3 {
			return nil, errors.New("Informe a conta e o arquivo.")
		}
		return nil, d.addFile(ctx, m, m.meta.RootID, args[2])
	case "disconnect":
		m, err := account()
		if err != nil {
			return nil, err
		}
		if n, _ := m.unsent(); n > 0 {
			return nil, fmt.Errorf("Há %d arquivo(s) aguardando envio nesta conta. Aguarde o envio antes de desconectar.", n)
		}
		m.stop()
		d.mu.Lock()
		delete(d.mounts, m.a.ID)
		d.mu.Unlock()
		os.Remove(accountPath(m.a.ID))
		os.Remove(m.meta.path)
		os.Remove(m.pinsPath())
		os.RemoveAll(m.cache.root)
		m.forget()
		return nil, nil
	}
	return nil, errors.New("Comando desconhecido.")
}

func (d *Daemon) serve(listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			var req request
			if json.NewDecoder(bufio.NewReader(conn)).Decode(&req) != nil {
				return
			}
			ctx, cancel := context.WithTimeout(d.ctx, 2*time.Minute)
			defer cancel()
			out, err := d.handle(ctx, req.Args)
			var res reply
			if err != nil {
				res.Err = err.Error()
			} else if text, ok := out.(string); ok {
				res.Out = text
			} else if out != nil {
				data, _ := json.Marshal(out)
				res.Out = string(data)
			}
			_ = json.NewEncoder(conn).Encode(res)
		}()
	}
}

// lockPath is the file whose lock keeps one service per session.
func lockPath() string { return filepath.Join(filepath.Dir(socketPath()), "gcp-drive.lock") }

func runDaemon() error {
	_ = os.MkdirAll(filepath.Dir(lockPath()), 0o700)
	unlock, held, err := lockFile(lockPath())
	if err != nil {
		return err
	}
	if held {
		return nil // another daemon already serves this session
	}
	defer unlock()
	ctx, cancel := context.WithCancel(context.Background())
	set := loadSettings()
	d := &Daemon{set: set, sched: newSched(set), mounts: map[string]*Mount{}, ctx: ctx, stop: cancel}
	_ = os.Remove(socketPath())
	listener, err := net.Listen("unix", socketPath())
	if err != nil {
		return err
	}
	_ = os.Chmod(socketPath(), 0o600)
	go d.serve(listener)
	defer d.startDesktop()()
	d.reload()
	go func() {
		var lastDown, lastUp int64
		for tick := 1; ; tick++ {
			time.Sleep(time.Second)
			// A folder still held by a previous service is tried again until it is free.
			if tick%10 == 0 {
				for _, m := range d.list() {
					if !m.isMounted() {
						err := m.start(d.ctx)
						m.mu.Lock()
						m.mountErr = ""
						if err != nil {
							m.mountErr = err.Error()
						}
						m.mu.Unlock()
					}
				}
			}
			down, up := d.sched.Down.Load(), d.sched.Up.Load()
			d.mu.Lock()
			d.down, d.up = down-lastDown, up-lastUp
			d.mu.Unlock()
			lastDown, lastUp = down, up
		}
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	select {
	case <-signals:
	case <-ctx.Done():
	}
	cancel()
	listener.Close()
	os.Remove(socketPath())
	for _, m := range d.list() {
		m.stop()
	}
	return nil
}

func call(args []string) (string, error) {
	conn, err := net.DialTimeout("unix", socketPath(), 3*time.Second)
	if err != nil {
		return "", errors.New("O serviço do GCP-Drive não está em execução. Abra o GCP-Drive pelo menu de aplicativos.")
	}
	defer conn.Close()
	if err := json.NewEncoder(conn).Encode(request{Args: args}); err != nil {
		return "", err
	}
	var res reply
	if err := json.NewDecoder(conn).Decode(&res); err != nil {
		return "", errors.New("O serviço do GCP-Drive não respondeu.")
	}
	if res.Err != "" {
		return "", errors.New(res.Err)
	}
	return res.Out, nil
}

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		// Opening the application entry starts the graphical panel.
		if err := launchPanel(); err != nil {
			fmt.Fprintln(os.Stderr, err.Error())
			os.Exit(1)
		}
		return
	}
	var out string
	var err error
	switch args[0] {
	case "version", "--version":
		out = "GCP-Drive " + version
	case "daemon":
		err = runDaemon()
	case "login":
		if _, err = login(context.Background()); err == nil {
			_, err = call([]string{"reload"})
		}
	default:
		if strings.HasPrefix(args[0], "gcp-drive:") {
			return
		}
		if handled, failed := localCommand(args); handled {
			err = failed
		} else {
			out, err = call(args)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	if out != "" {
		fmt.Println(out)
	}
}
