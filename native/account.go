package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

const version = "0.5.0"

var googleEndpoint = oauth2.Endpoint{
	AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
	TokenURL: "https://oauth2.googleapis.com/token",
}

var scopes = []string{"https://www.googleapis.com/auth/drive", "openid", "email", "profile"}

// Where each system keeps settings, data, cache and the control socket is in os_<system>.go.

// GCP_DRIVE_STATE isolates data, cache and the control socket for test runs.
func dataDir() string {
	if v := os.Getenv("GCP_DRIVE_STATE"); v != "" {
		return filepath.Join(v, "data")
	}
	return defaultDataDir()
}
func cacheRoot() string {
	if v := os.Getenv("GCP_DRIVE_STATE"); v != "" {
		return filepath.Join(v, "cache")
	}
	return defaultCacheDir()
}
func socketPath() string {
	if v := os.Getenv("GCP_DRIVE_SOCKET"); v != "" {
		return v
	}
	if v := os.Getenv("GCP_DRIVE_STATE"); v != "" {
		return filepath.Join(v, "control.sock")
	}
	return defaultSocketPath()
}
func mountRoot() string {
	if v := os.Getenv("GCP_DRIVE_MOUNT_ROOT"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "GCP-Drive")
}
func readOnly() bool { return os.Getenv("GCP_DRIVE_READONLY") == "1" }

func writePrivate(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	return writePrivate(path, data)
}

func readJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

type Account struct {
	ID           string        `json:"id"`
	Email        string        `json:"email"`
	Name         string        `json:"name"`
	ClientID     string        `json:"clientId"`
	ClientSecret string        `json:"clientSecret"`
	Token        *oauth2.Token `json:"token"`
	// Provider is set by earlier releases for services this release no longer mounts.
	Provider string `json:"provider,omitempty"`
}

func accountPath(id string) string { return filepath.Join(configDir(), "accounts", id+".json") }

func loadAccounts() ([]*Account, error) {
	entries, err := os.ReadDir(filepath.Join(configDir(), "accounts"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []*Account
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		a := &Account{}
		if readJSON(filepath.Join(configDir(), "accounts", e.Name()), a) != nil || a.ID == "" || a.Token == nil {
			continue
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Email < out[j].Email })
	return out, nil
}

func (a *Account) config() *oauth2.Config {
	return &oauth2.Config{ClientID: a.ClientID, ClientSecret: a.ClientSecret, Endpoint: googleEndpoint, Scopes: scopes}
}

// savingSource persists refreshed tokens so the next start does not need a new exchange.
type savingSource struct {
	mu   sync.Mutex
	a    *Account
	src  oauth2.TokenSource
	last string
}

func (s *savingSource) Token() (*oauth2.Token, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, err := s.src.Token()
	if err != nil {
		return nil, err
	}
	if t.AccessToken != s.last {
		s.last = t.AccessToken
		if t.RefreshToken == "" {
			t.RefreshToken = s.a.Token.RefreshToken
		}
		s.a.Token = t
		if !readOnly() {
			_ = writeJSON(accountPath(s.a.ID), s.a)
		}
	}
	return t, nil
}

func (a *Account) tokenSource() oauth2.TokenSource {
	return &savingSource{a: a, src: a.config().TokenSource(context.Background(), a.Token), last: a.Token.AccessToken}
}

type installedClient struct {
	Installed struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	} `json:"installed"`
}

func loadDesktopOAuth() (id, secret string, err error) {
	exe, _ := os.Executable()
	candidates := append([]string{os.Getenv("GCP_DRIVE_OAUTH")}, installedOAuthPaths...)
	for _, path := range append(candidates, filepath.Join(filepath.Dir(exe), "google-oauth.json")) {
		if path == "" {
			continue
		}
		var c installedClient
		if readJSON(path, &c) == nil && c.Installed.ClientID != "" {
			return c.Installed.ClientID, c.Installed.ClientSecret, nil
		}
	}
	return "", "", errors.New("O cadastro do aplicativo no Google não foi encontrado nesta instalação.")
}

// login runs the loopback browser flow and stores the account. It returns the account ID.
func login(ctx context.Context) (string, error) {
	id, secret, err := loadDesktopOAuth()
	if err != nil {
		return "", err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", errors.New("Não foi possível abrir a porta local de autorização.")
	}
	defer listener.Close()
	cfg := &oauth2.Config{ClientID: id, ClientSecret: secret, Endpoint: googleEndpoint, Scopes: scopes,
		RedirectURL: "http://" + listener.Addr().String() + "/"}
	stateBytes := make([]byte, 16)
	_, _ = rand.Read(stateBytes)
	state := hex.EncodeToString(stateBytes)
	verifier := oauth2.GenerateVerifier()
	type result struct {
		code string
		err  error
	}
	done := make(chan result, 1)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		q := r.URL.Query()
		if q.Get("state") != state || q.Get("code") == "" {
			fmt.Fprint(w, "<h2>GCP-Drive</h2><p>A autorização não foi concluída. Feche esta aba e tente de novo no aplicativo.</p>")
			select {
			case done <- result{err: errors.New("A autorização foi cancelada ou recusada no navegador.")}:
			default:
			}
			return
		}
		fmt.Fprint(w, "<h2>GCP-Drive</h2><p>Conta conectada. Você já pode fechar esta aba e voltar ao aplicativo.</p>")
		select {
		case done <- result{code: q.Get("code")}:
		default:
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	url := cfg.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent select_account"), oauth2.S256ChallengeOption(verifier))
	if err := openExternal(url); err != nil {
		return "", errors.New("Não foi possível abrir o navegador para a autorização.")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	var res result
	select {
	case res = <-done:
	case <-ctx.Done():
		return "", errors.New("A autorização no navegador não foi concluída a tempo.")
	}
	if res.err != nil {
		return "", res.err
	}
	token, err := cfg.Exchange(ctx, res.code, oauth2.VerifierOption(verifier))
	if err != nil {
		return "", errors.New("O Google não confirmou a autorização. Tente novamente.")
	}
	if token.RefreshToken == "" {
		return "", errors.New("O Google não entregou a permissão permanente. Remova o acesso do GCP-Drive na sua Conta do Google e conecte de novo.")
	}
	a := &Account{ClientID: id, ClientSecret: secret, Token: token}
	var about struct {
		User struct {
			EmailAddress string `json:"emailAddress"`
			DisplayName  string `json:"displayName"`
		} `json:"user"`
	}
	client := newDrive(a, newSched(&Settings{}))
	if err := client.json(ctx, prioInteractive, "GET", apiBase+"/about?fields=user(emailAddress,displayName)", nil, &about); err != nil {
		return "", err
	}
	if about.User.EmailAddress == "" {
		return "", errors.New("O Google não informou o e-mail da conta.")
	}
	sum := sha256.Sum256([]byte("google:" + strings.ToLower(about.User.EmailAddress)))
	a.ID, a.Email, a.Name = hex.EncodeToString(sum[:16]), about.User.EmailAddress, about.User.DisplayName
	// A reconnected account keeps the ID earlier releases gave it.
	existing, _ := loadAccounts()
	for _, old := range existing {
		if strings.EqualFold(old.Email, a.Email) && old.Provider == "" {
			a.ID = old.ID
		}
	}
	return a.ID, writeJSON(accountPath(a.ID), a)
}

type Settings struct {
	DownKBps int             `json:"downKBps"`
	UpKBps   int             `json:"upKBps"`
	CacheGB  int             `json:"cacheGB"`
	Premap   bool            `json:"premap"`
	Paused   map[string]bool `json:"paused,omitempty"`
}

func settingsPath() string { return filepath.Join(configDir(), "settings.json") }

func loadSettings() *Settings {
	s := &Settings{CacheGB: 10, Premap: true}
	_ = readJSON(settingsPath(), s)
	if s.CacheGB < 1 {
		s.CacheGB = 1
	}
	if s.Paused == nil {
		s.Paused = map[string]bool{}
	}
	return s
}
