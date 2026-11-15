package main

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// The state a file manager shows next to each name, as the Explorer does on Windows.
const (
	stateCloud   = "cloud"   // only in the Drive; opening downloads it
	stateLocal   = "local"   // the whole content is on this computer
	stateOffline = "offline" // kept on this computer, alone or through a folder kept off-line
	stateSync    = "sync"    // has changes that did not reach the Drive yet
)

// stored reports how many bytes of a file's current version are on disk, without opening it in the cache.
func (c *Cache) stored(it *Item) int64 {
	c.mu.Lock()
	f := c.files[it.ID+"/"+versionKey(it)]
	c.mu.Unlock()
	if f != nil {
		return f.cached()
	}
	entries, err := os.ReadDir(filepath.Join(c.root, safeID(it.ID), versionKey(it)))
	if err != nil {
		return 0
	}
	probe := cfile{size: it.Size}
	var total int64
	for _, e := range entries {
		if n, err := strconv.Atoi(e.Name()); err == nil && n >= 0 && n < probe.chunks() {
			total += probe.chunkLen(n)
		}
	}
	return total
}

// states maps each name of a folder inside an account to its state. Folders the map has not loaded yet
// and the account's own folder answer with no names: unknown is shown as no mark, never as a state.
func (d *Daemon) states(ctx context.Context, path string) map[string]string {
	out := map[string]string{}
	path = filepath.Clean(path)
	for _, m := range d.list() {
		rel, err := filepath.Rel(m.path, path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if rel == "." {
			return out
		}
		// Walking from the account's folder also tells whether a folder above is kept off-line.
		m.mu.Lock()
		pins := make(map[string]bool, len(m.pins))
		for id := range m.pins {
			pins[id] = true
		}
		sending := map[string]bool{}
		for id, p := range m.pend {
			if p.dirty || p.sending || p.failed != "" {
				sending[id] = true
			}
		}
		m.mu.Unlock()
		dir := vRoot
		kept := false
		for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
			e, ok := m.meta.find(dir, part)
			if !ok || e.Kind != kindDir {
				return out
			}
			dir = e.Content.ID
			kept = kept || pins[e.Content.ID] || pins[e.It.ID]
		}
		for _, e := range m.meta.listing(dir) {
			switch {
			case e.Kind == kindLink:
				out[e.Name] = stateCloud
			case sending[e.It.ID] || sending[e.Content.ID] || e.Content.Local:
				out[e.Name] = stateSync
			case kept || pins[e.It.ID] || pins[e.Content.ID]:
				out[e.Name] = stateOffline
			case e.Kind == kindFile && e.Content.Size > 0 && m.cache.stored(e.Content) >= e.Content.Size:
				out[e.Name] = stateLocal
			default:
				out[e.Name] = stateCloud
			}
		}
		return out
	}
	return out
}
