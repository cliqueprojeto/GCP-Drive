package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/oauth2"
)

// Variables so tests can point the engine at a local server.
var (
	apiBase    = "https://www.googleapis.com/drive/v3"
	uploadBase = "https://www.googleapis.com/upload/drive/v3"
)

const (
	itemFields = "id,name,mimeType,parents,size,modifiedTime,md5Checksum,trashed,webViewLink,driveId,ownedByMe,sharedWithMeTime,capabilities(canEdit,canShare),shortcutDetails(targetId,targetMimeType)"
)

const (
	prioInteractive = iota // a program is waiting on this request
	prioUpload
	prioBackground // pre-mapping, offline copies, read-ahead
)

// Sched gives interactive requests the line first and applies the user's rate limits.
type Sched struct {
	set         *Settings
	mu          sync.Mutex
	next        [2]time.Time
	interactive atomic.Int32
	lastActive  atomic.Int64
	Down, Up    atomic.Int64
}

func newSched(set *Settings) *Sched { return &Sched{set: set} }

func (s *Sched) begin(prio int) func() {
	if prio != prioInteractive {
		return func() {}
	}
	s.interactive.Add(1)
	return func() { s.interactive.Add(-1); s.lastActive.Store(time.Now().UnixNano()) }
}

// yield holds background work while someone is waiting, bounded so it never starves.
func (s *Sched) yield(ctx context.Context, prio int) {
	if prio != prioBackground {
		return
	}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) && ctx.Err() == nil {
		if s.interactive.Load() == 0 && time.Since(time.Unix(0, s.lastActive.Load())) > 400*time.Millisecond {
			return
		}
		time.Sleep(60 * time.Millisecond)
	}
}

func (s *Sched) take(ctx context.Context, up bool, n int) {
	dir, rate := 0, s.set.DownKBps
	if up {
		dir, rate = 1, s.set.UpKBps
		s.Up.Add(int64(n))
	} else {
		s.Down.Add(int64(n))
	}
	if rate <= 0 {
		return
	}
	s.mu.Lock()
	now := time.Now()
	if s.next[dir].Before(now) {
		s.next[dir] = now
	}
	wait := s.next[dir].Sub(now)
	s.next[dir] = s.next[dir].Add(time.Duration(float64(n) / float64(rate*1024) * float64(time.Second)))
	s.mu.Unlock()
	if wait > 0 {
		select {
		case <-time.After(wait):
		case <-ctx.Done():
		}
	}
}

type meteredBody struct {
	io.ReadCloser
	ctx  context.Context
	s    *Sched
	prio int
	done func()
}

func (m *meteredBody) Read(p []byte) (int, error) {
	if len(p) > 256<<10 {
		p = p[:256<<10]
	}
	m.s.yield(m.ctx, m.prio)
	n, err := m.ReadCloser.Read(p)
	if n > 0 {
		m.s.take(m.ctx, false, n)
	}
	return n, err
}
func (m *meteredBody) Close() error { m.done(); return m.ReadCloser.Close() }

type statusError struct {
	Code   int
	Reason string
}

func (e *statusError) Error() string {
	switch {
	case e.Code == 401:
		return "A autorização desta conta expirou. Conecte a conta novamente."
	case e.Code == 404:
		return "O item não existe mais no Google Drive."
	case e.Code == 403 && strings.Contains(e.Reason, "storageQuota"):
		return "O armazenamento desta conta do Google está cheio."
	case e.Code == 403:
		return "Esta conta não tem permissão para essa operação."
	case e.Code == 429 || e.Code >= 500:
		return "O Google Drive está limitando ou indisponível no momento. A operação será repetida."
	}
	return fmt.Sprintf("O Google Drive recusou a operação (código %d).", e.Code)
}

type Drive struct {
	a  *Account
	hc *http.Client
	s  *Sched
}

func newDrive(a *Account, s *Sched) *Drive {
	base := &http.Transport{Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true, MaxIdleConns: 64,
		MaxIdleConnsPerHost: 24, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 15 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second}
	return &Drive{a: a, s: s, hc: &http.Client{Transport: &oauth2.Transport{Source: a.tokenSource(), Base: base}}}
}

func retryable(code int, reason string) bool {
	return code == 429 || code >= 500 || (code == 403 && (strings.Contains(reason, "ateLimitExceeded") || strings.Contains(reason, "backendError")))
}

// request retries throttling and transient failures. body must be replayable.
func (d *Drive) request(ctx context.Context, prio int, method, target string, body []byte, header map[string]string) (*http.Response, error) {
	var last error
	for attempt := 0; attempt < 7; attempt++ {
		if attempt > 0 {
			pause := time.Duration(400<<attempt)*time.Millisecond + time.Duration(rand.IntN(400))*time.Millisecond
			select {
			case <-time.After(min(pause, 20*time.Second)):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		d.s.yield(ctx, prio)
		done := d.s.begin(prio)
		var reader io.Reader
		if body != nil {
			reader = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, target, reader)
		if err != nil {
			done()
			return nil, err
		}
		for k, v := range header {
			req.Header.Set(k, v)
		}
		if body != nil {
			d.s.take(ctx, true, len(body))
		}
		res, err := d.hc.Do(req)
		if err != nil {
			done()
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			last = errors.New("Sem conexão com o Google Drive. Verifique a internet.")
			if attempt >= 3 {
				return nil, last
			}
			continue
		}
		if res.StatusCode < 300 || res.StatusCode == 308 {
			res.Body = &meteredBody{ReadCloser: res.Body, ctx: ctx, s: d.s, prio: prio, done: done}
			return res, nil
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
		res.Body.Close()
		done()
		var detail struct {
			Error struct {
				Errors []struct{ Reason string } `json:"errors"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &detail)
		reason := ""
		if len(detail.Error.Errors) > 0 {
			reason = detail.Error.Errors[0].Reason
		}
		last = &statusError{Code: res.StatusCode, Reason: reason}
		if !retryable(res.StatusCode, reason) {
			return nil, last
		}
	}
	return nil, last
}

func (d *Drive) json(ctx context.Context, prio int, method, target string, in, out any) error {
	var body []byte
	header := map[string]string{}
	if in != nil {
		body, _ = json.Marshal(in)
		header["Content-Type"] = "application/json"
	}
	res, err := d.request(ctx, prio, method, target, body, header)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if out == nil {
		_, _ = io.Copy(io.Discard, res.Body)
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

type apiFile struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	MimeType     string   `json:"mimeType"`
	Parents      []string `json:"parents"`
	Size         string   `json:"size"`
	ModifiedTime string   `json:"modifiedTime"`
	MD5          string   `json:"md5Checksum"`
	Trashed      bool     `json:"trashed"`
	WebViewLink  string   `json:"webViewLink"`
	DriveID      string   `json:"driveId"`
	OwnedByMe    bool     `json:"ownedByMe"`
	SharedTime   string   `json:"sharedWithMeTime"`
	Capabilities struct {
		CanEdit  bool `json:"canEdit"`
		CanShare bool `json:"canShare"`
	} `json:"capabilities"`
	Shortcut struct {
		TargetID   string `json:"targetId"`
		TargetMime string `json:"targetMimeType"`
	} `json:"shortcutDetails"`
}

func listURL(q url.Values) string {
	q.Set("supportsAllDrives", "true")
	q.Set("includeItemsFromAllDrives", "true")
	q.Set("pageSize", "1000")
	q.Set("fields", "nextPageToken,files("+itemFields+")")
	return apiBase + "/files?" + q.Encode()
}

// list pages through a query and hands each page to visit.
func (d *Drive) list(ctx context.Context, prio int, q url.Values, visit func([]apiFile)) error {
	for {
		var page struct {
			Next  string    `json:"nextPageToken"`
			Files []apiFile `json:"files"`
		}
		if err := d.json(ctx, prio, "GET", listURL(q), nil, &page); err != nil {
			return err
		}
		visit(page.Files)
		if page.Next == "" {
			return nil
		}
		q.Set("pageToken", page.Next)
	}
}

func (d *Drive) get(ctx context.Context, prio int, id string) (*apiFile, error) {
	var f apiFile
	err := d.json(ctx, prio, "GET", apiBase+"/files/"+url.PathEscape(id)+"?supportsAllDrives=true&fields="+url.QueryEscape(itemFields), nil, &f)
	return &f, err
}

func (d *Drive) patch(ctx context.Context, id string, body any, extra url.Values) (*apiFile, error) {
	if extra == nil {
		extra = url.Values{}
	}
	extra.Set("supportsAllDrives", "true")
	extra.Set("fields", itemFields)
	var f apiFile
	err := d.json(ctx, prioInteractive, "PATCH", apiBase+"/files/"+url.PathEscape(id)+"?"+extra.Encode(), body, &f)
	return &f, err
}

func (d *Drive) create(ctx context.Context, body any) (*apiFile, error) {
	var f apiFile
	err := d.json(ctx, prioInteractive, "POST", apiBase+"/files?supportsAllDrives=true&fields="+url.QueryEscape(itemFields), body, &f)
	return &f, err
}

// media opens a byte range of a file's content.
func (d *Drive) media(ctx context.Context, prio int, id string, off, n int64) (io.ReadCloser, error) {
	res, err := d.request(ctx, prio, "GET", apiBase+"/files/"+url.PathEscape(id)+"?alt=media&supportsAllDrives=true", nil,
		map[string]string{"Range": fmt.Sprintf("bytes=%d-%d", off, off+n-1)})
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

const uploadChunk = 8 << 20

// upload sends a local file as a new item (id == "") or as a new revision of id.
func (d *Drive) upload(ctx context.Context, id string, meta map[string]any, path string, progress func(int64)) (*apiFile, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	method, target := "POST", uploadBase+"/files?uploadType=resumable&supportsAllDrives=true&fields="+url.QueryEscape(itemFields)
	if id != "" {
		method, target = "PATCH", uploadBase+"/files/"+url.PathEscape(id)+"?uploadType=resumable&supportsAllDrives=true&fields="+url.QueryEscape(itemFields)
	}
	body, _ := json.Marshal(meta)
	res, err := d.request(ctx, prioUpload, method, target, body, map[string]string{
		"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": fmt.Sprint(size)})
	if err != nil {
		return nil, err
	}
	res.Body.Close()
	session := res.Header.Get("Location")
	if session == "" {
		return nil, errors.New("O Google Drive não abriu a sessão de envio.")
	}
	buf := make([]byte, uploadChunk)
	var sent int64
	for {
		n, rerr := io.ReadFull(file, buf)
		if rerr != nil && rerr != io.EOF && rerr != io.ErrUnexpectedEOF {
			return nil, rerr
		}
		rng := fmt.Sprintf("bytes %d-%d/%d", sent, sent+int64(n)-1, size)
		if size == 0 {
			rng = "bytes */0"
		}
		res, err := d.request(ctx, prioUpload, "PUT", session, buf[:n], map[string]string{"Content-Range": rng})
		if err != nil {
			return nil, err
		}
		if res.StatusCode == 308 {
			res.Body.Close()
			sent += int64(n)
			if progress != nil {
				progress(sent)
			}
			if _, err := file.Seek(sent, io.SeekStart); err != nil {
				return nil, err
			}
			continue
		}
		var f apiFile
		err = json.NewDecoder(res.Body).Decode(&f)
		res.Body.Close()
		if err != nil || f.ID == "" {
			return nil, errors.New("O Google Drive não confirmou o envio do arquivo.")
		}
		if progress != nil {
			progress(size)
		}
		return &f, nil
	}
}
