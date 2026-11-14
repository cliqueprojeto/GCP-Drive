package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// Small blocks let a program that only inspects the start of a file get it after 256 KiB.
	chunkSize = 256 << 10
	maxWindow = 64
)

type fetch struct {
	done chan struct{}
	err  error
}

// cfile is the on-disk block store of one version of one file.
type cfile struct {
	c        *Cache
	id, dir  string
	size     int64
	mu       sync.Mutex
	have     map[int]bool
	inflight map[int]*fetch
	touched  time.Time
}

// reader carries one open handle's read pattern, which sizes the next download.
type reader struct{ next, win int }

type Cache struct {
	root   string
	d      *Drive
	set    *Settings
	mu     sync.Mutex
	files  map[string]*cfile
	pinned func(id string) bool
	total  atomic.Int64
	active atomic.Int32
}

func newCache(root string, d *Drive, set *Settings, pinned func(string) bool) *Cache {
	c := &Cache{root: root, d: d, set: set, files: map[string]*cfile{}, pinned: pinned}
	go func() { c.total.Store(dirBytes(root)) }()
	return c
}

func dirBytes(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, e os.DirEntry, err error) error {
		if err == nil && !e.IsDir() {
			if info, err := e.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

func versionKey(it *Item) string {
	if it.MD5 != "" {
		return it.MD5 + "-b256"
	}
	return fmt.Sprintf("t%d-%d-b256", it.MTime, it.Size)
}

func safeID(id string) string { return strings.NewReplacer("/", "_", ".", "_").Replace(id) }

func (c *Cache) file(it *Item) *cfile {
	key := it.ID + "/" + versionKey(it)
	c.mu.Lock()
	defer c.mu.Unlock()
	if f := c.files[key]; f != nil {
		return f
	}
	base := filepath.Join(c.root, safeID(it.ID))
	f := &cfile{c: c, id: it.ID, dir: filepath.Join(base, versionKey(it)), size: it.Size, have: map[int]bool{}, inflight: map[int]*fetch{}}
	if entries, err := os.ReadDir(f.dir); err == nil {
		for _, e := range entries {
			if n, err := strconv.Atoi(e.Name()); err == nil {
				f.have[n] = true
			}
		}
	}
	c.files[key] = f
	// Older versions of the same file are no longer readable through the mount.
	go func() {
		entries, _ := os.ReadDir(base)
		for _, e := range entries {
			if e.Name() != filepath.Base(f.dir) {
				old := filepath.Join(base, e.Name())
				c.total.Add(-dirBytes(old))
				_ = os.RemoveAll(old)
			}
		}
	}()
	return f
}

func (f *cfile) chunks() int { return int((f.size + chunkSize - 1) / chunkSize) }

func (f *cfile) chunkLen(idx int) int64 {
	return min(int64(chunkSize), f.size-int64(idx)*chunkSize)
}

// start downloads a run of missing blocks in one request. Caller holds f.mu.
func (f *cfile) start(idx, count, prio int) {
	last := idx
	for last < idx+count && last < f.chunks() && !f.have[last] && f.inflight[last] == nil {
		last++
	}
	if last == idx {
		return
	}
	job := &fetch{done: make(chan struct{})}
	for i := idx; i < last; i++ {
		f.inflight[i] = job
	}
	f.c.active.Add(1)
	go func() {
		defer f.c.active.Add(-1)
		// A cancelled reader does not cancel the download: the blocks stay useful for the next open.
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		err := f.download(ctx, idx, last, prio)
		f.mu.Lock()
		job.err = err
		for i := idx; i < last; i++ {
			if f.inflight[i] == job {
				delete(f.inflight, i)
			}
		}
		f.mu.Unlock()
		close(job.done)
	}()
}

func (f *cfile) download(ctx context.Context, first, last, prio int) error {
	off := int64(first) * chunkSize
	length := min(int64(last)*chunkSize, f.size) - off
	body, err := f.c.d.media(ctx, prio, f.id, off, length)
	if err != nil {
		return err
	}
	defer body.Close()
	if err := os.MkdirAll(f.dir, 0o700); err != nil {
		return err
	}
	buf := make([]byte, chunkSize)
	for i := first; i < last; i++ {
		n := f.chunkLen(i)
		if _, err := io.ReadFull(body, buf[:n]); err != nil {
			return errors.New("A leitura do arquivo no Google Drive foi interrompida.")
		}
		path := filepath.Join(f.dir, strconv.Itoa(i))
		if err := os.WriteFile(path+".part", buf[:n], 0o600); err != nil {
			return err
		}
		if err := os.Rename(path+".part", path); err != nil {
			return err
		}
		f.c.total.Add(n)
		f.mu.Lock()
		f.have[i] = true
		f.mu.Unlock()
	}
	return nil
}

func (f *cfile) touch() {
	if time.Since(f.touched) > time.Minute {
		f.touched = time.Now()
		_ = os.Chtimes(f.dir, f.touched, f.touched)
	}
}

// ReadAt serves from disk and downloads what is missing, growing the request while reads stay sequential.
func (f *cfile) ReadAt(ctx context.Context, p []byte, off int64, r *reader, prio int) (int, error) {
	if off >= f.size {
		return 0, nil
	}
	if int64(len(p)) > f.size-off {
		p = p[:f.size-off]
	}
	done := 0
	for done < len(p) {
		pos := off + int64(done)
		idx := int(pos / chunkSize)
		f.mu.Lock()
		if !f.have[idx] {
			job := f.inflight[idx]
			if job == nil {
				if idx == r.next && r.win > 0 {
					r.win = min(r.win*2, maxWindow)
				} else {
					r.win = 1
				}
				r.next = idx + r.win
				f.start(idx, r.win, prio)
				job = f.inflight[idx]
			}
			f.mu.Unlock()
			if job == nil {
				continue
			}
			select {
			case <-job.done:
			case <-ctx.Done():
				return done, ctx.Err()
			}
			f.mu.Lock()
			ok := f.have[idx]
			f.mu.Unlock()
			if !ok {
				if job.err != nil {
					return done, job.err
				}
				return done, errors.New("O bloco do arquivo não ficou disponível.")
			}
			continue
		}
		f.touch()
		// Sequential readers get the following blocks before they ask.
		if idx+1 == r.next && r.win >= 2 && !f.have[idx+1] && f.inflight[idx+1] == nil && idx+1 < f.chunks() {
			r.win = min(r.win*2, maxWindow)
			r.next = idx + 1 + r.win
			f.start(idx+1, r.win, prio)
		}
		f.mu.Unlock()
		file, err := os.Open(filepath.Join(f.dir, strconv.Itoa(idx)))
		if err != nil {
			f.mu.Lock()
			delete(f.have, idx)
			f.mu.Unlock()
			continue
		}
		n, err := file.ReadAt(p[done:min(len(p), done+int(int64(idx+1)*chunkSize-pos))], pos-int64(idx)*chunkSize)
		file.Close()
		done += n
		if err != nil && err != io.EOF {
			return done, err
		}
		if n == 0 {
			break
		}
	}
	return done, nil
}

// complete reports how many bytes of the file are on disk.
func (f *cfile) cached() int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	var total int64
	for i := range f.have {
		total += f.chunkLen(i)
	}
	return total
}

// fill downloads every missing block, for offline copies.
func (f *cfile) fill(ctx context.Context) error {
	r := &reader{}
	buf := make([]byte, 64<<10)
	for idx := 0; idx < f.chunks(); idx++ {
		f.mu.Lock()
		ok := f.have[idx]
		f.mu.Unlock()
		if ok {
			continue
		}
		r.next, r.win = idx, 16
		if _, err := f.ReadAt(ctx, buf[:1], int64(idx)*chunkSize, r, prioBackground); err != nil {
			return err
		}
	}
	return nil
}

func (c *Cache) limit() int64 {
	limit := int64(c.set.CacheGB) << 30
	if free, ok := diskFree(c.root); ok {
		// Keep 1 GiB of the disk free regardless of the configured size.
		limit = min(limit, max(c.total.Load()+free-1<<30, 64<<20))
	}
	return limit
}

// evict removes the least recently used files until the cache fits. Offline copies stay.
func (c *Cache) evict(all bool) {
	limit := c.limit()
	if !all && c.total.Load() <= limit {
		return
	}
	type victim struct {
		path string
		id   string
		when time.Time
	}
	var list []victim
	ids, _ := os.ReadDir(c.root)
	for _, id := range ids {
		versions, _ := os.ReadDir(filepath.Join(c.root, id.Name()))
		for _, v := range versions {
			if info, err := v.Info(); err == nil {
				list = append(list, victim{filepath.Join(c.root, id.Name(), v.Name()), id.Name(), info.ModTime()})
			}
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].when.Before(list[j].when) })
	target := limit * 9 / 10
	for _, v := range list {
		if !all && c.total.Load() <= target {
			break
		}
		if c.pinned(v.id) {
			continue
		}
		c.mu.Lock()
		busy := false
		for key, f := range c.files {
			if f.dir == v.path {
				f.mu.Lock()
				busy = len(f.inflight) > 0
				if !busy {
					f.have = map[int]bool{}
					delete(c.files, key)
				}
				f.mu.Unlock()
			}
		}
		c.mu.Unlock()
		if busy {
			continue
		}
		c.total.Add(-dirBytes(v.path))
		_ = os.RemoveAll(v.path)
	}
}
