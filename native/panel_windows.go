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
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"
)

//go:embed panel
var panelFiles embed.FS

// panelCommands are the service commands the panel may send.
var panelCommands = map[string]bool{"status": true, "settings": true, "pause": true, "quota": true, "storage": true, "clear-cache": true, "disconnect": true}

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
			static.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-GCP-Drive-Token")), []byte(token)) != 1 {
			http.Error(w, "", http.StatusForbidden)
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
			if len(in.Args) == 0 || !panelCommands[in.Args[0]] {
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
			// Only Google's console, which the guide points to.
			if !strings.HasPrefix(in.ID, "https://console.cloud.google.com/") {
				err = errors.New("Endereço não permitido.")
				break
			}
			err = openExternal(in.ID)
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
