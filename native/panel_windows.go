//go:build windows

package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed panel
var panelFiles embed.FS

// The application's icon and the support QR codes, shared with the Linux interface.
var (
	//go:embed files/icons/gcp-drive.svg
	panelIcon []byte
	//go:embed ui/support-pix.png
	supportPix []byte
	//go:embed ui/support-stripe.png
	supportStripe []byte
)

// panelCommands are the service commands the panel may send.
var panelCommands = map[string]bool{"status": true, "settings": true, "pause": true, "quota": true, "storage": true, "clear-cache": true,
	"disconnect": true, "search": true, "autostart": true, "context": true}

// panelContext are the item actions of the sharing window.
var panelContext = map[string]bool{"describe": true, "sharing": true, "share": true, "link": true, "web": true}

// panelLinks are the addresses the panel may open in the browser: the Drive, its documents and the project's support pages.
var panelLinks = []string{"https://drive.google.com/", "https://docs.google.com/", "https://console.cloud.google.com/",
	"https://gestaoculturalpro.com.br/", "https://donate.stripe.com/", "https://github.com/cliqueprojeto/GCP-Drive"}

// panelHandler serves the graphical panel to a window on this computer. The page itself is public;
// everything it asks carries a token that only the window received, and must name this server as host.
func (d *Daemon) panelHandler(host, token string) http.Handler {
	pages, _ := fs.Sub(panelFiles, "panel")
	static := http.FileServer(http.FS(pages))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host {
			http.Error(w, "", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Method != http.MethodGet {
				http.Error(w, "", http.StatusMethodNotAllowed)
				return
			}
			assets := map[string]struct {
				kind string
				data []byte
			}{"/gcp-drive.svg": {"image/svg+xml", panelIcon}, "/support-pix.png": {"image/png", supportPix}, "/support-stripe.png": {"image/png", supportStripe}}
			if asset, ok := assets[r.URL.Path]; ok {
				w.Header().Set("Content-Type", asset.kind)
				_, _ = w.Write(asset.data)
				return
			}
			static.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-GCP-Drive-Token")), []byte(token)) != 1 {
			http.Error(w, "", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/api/upload" {
			// The file's bytes are the body; it goes into the account's Meu Drive like any new file there.
			res := struct {
				Out any
				Err string
			}{}
			if err := d.panelUpload(r); err != nil {
				res.Err = err.Error()
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(res)
			return
		}
		var in struct {
			Args []string
			ID   string
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in)
		var out any
		var err error
		switch r.URL.Path {
		case "/api/call":
			if len(in.Args) == 0 || !panelCommands[in.Args[0]] || (in.Args[0] == "context" && (len(in.Args) < 2 || !panelContext[in.Args[1]])) {
				err = errors.New("Comando desconhecido.")
				break
			}
			ctx, cancel := context.WithTimeout(d.ctx, 2*time.Minute)
			out, err = d.handle(ctx, in.Args)
			cancel()
		case "/api/login":
			if _, err = login(d.ctx); err == nil {
				d.reload()
			}
		case "/api/open":
			path := mountRoot()
			if in.ID != "" {
				var m *Mount
				if m, err = d.mount(in.ID); err != nil {
					break
				}
				path = m.path
			}
			err = openExternal(path)
		case "/api/registration":
			// With content, stores the application's registration with Google; always answers whether there is one.
			if in.ID != "" {
				if err = storeRegistration([]byte(in.ID)); err != nil {
					break
				}
			}
			_, _, missing := loadDesktopOAuth()
			out = missing == nil
		case "/api/browse":
			allowed := false
			for _, prefix := range panelLinks {
				allowed = allowed || strings.HasPrefix(in.ID, prefix)
			}
			if !allowed {
				err = errors.New("Endereço não permitido.")
				break
			}
			err = openExternal(in.ID)
		case "/api/web":
			// The account's Meu Drive in the browser, signed in as that account.
			var m *Mount
			if m, err = d.mount(in.ID); err == nil {
				err = openExternal("https://drive.google.com/drive/my-drive?" + url.Values{"authuser": {m.a.Email}}.Encode())
			}
		default:
			http.NotFound(w, r)
			return
		}
		res := struct {
			Out any
			Err string
		}{Out: out}
		if err != nil {
			res.Err = err.Error()
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
}

// panelUpload writes a file sent by the panel into the account's Meu Drive folder, under a name that
// must not exist yet; the folder's watcher sends it to the Drive.
func (d *Daemon) panelUpload(r *http.Request) error {
	m, err := d.mount(r.Header.Get("X-GCP-Drive-Account"))
	if err != nil {
		return err
	}
	name, err := url.PathUnescape(r.Header.Get("X-GCP-Drive-Name"))
	if err != nil || name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `\/:*?"<>|`) {
		return errors.New("Nome de arquivo inválido.")
	}
	target := filepath.Join(m.path, nameMy, name)
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, os.ErrExist) {
		return errors.New("Já existe um item com esse nome em Meu Drive.")
	}
	if err != nil {
		return errors.New("Não foi possível criar o arquivo em Meu Drive.")
	}
	_, err = io.Copy(out, r.Body)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(target)
		return errors.New("O envio do arquivo não terminou.")
	}
	return nil
}

// servePanel starts the panel's server on a free local port and returns the address that opens it.
func (d *Daemon) servePanel() (address string, stop func(), err error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", nil, err
	}
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		listener.Close()
		return "", nil, err
	}
	token := hex.EncodeToString(secret)
	host := listener.Addr().String()
	server := &http.Server{Handler: d.panelHandler(host, token), ReadHeaderTimeout: 10 * time.Second}
	go server.Serve(listener)
	// The token travels after the #, which the window never sends to any server.
	return "http://" + host + "/#" + token, func() { server.Close() }, nil
}
