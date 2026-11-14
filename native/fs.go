//go:build linux

package main

import (
	"context"
	"hash/fnv"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"
)

func inoOf(id string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(id))
	if v := h.Sum64(); v > 1 {
		return v
	}
	return 2
}

// node is one visible name: id is the listed item, cid the item whose bytes or children it shows.
type node struct {
	fs.Inode
	m       *Mount
	id      string
	content atomic.Pointer[string]
	kind    int
}

func newNode(m *Mount, id, cid string, kind int) *node {
	n := &node{m: m, id: id, kind: kind}
	n.content.Store(&cid)
	return n
}

// cid is the item whose bytes or children the node shows. A save-by-rename repoints it.
func (n *node) cid() string { return *n.content.Load() }

var (
	_ fs.NodeLookuper  = (*node)(nil)
	_ fs.NodeReaddirer = (*node)(nil)
	_ fs.NodeGetattrer = (*node)(nil)
	_ fs.NodeOpener    = (*node)(nil)
	_ fs.NodeCreater   = (*node)(nil)
	_ fs.NodeMkdirer   = (*node)(nil)
	_ fs.NodeUnlinker  = (*node)(nil)
	_ fs.NodeRmdirer   = (*node)(nil)
	_ fs.NodeRenamer   = (*node)(nil)
	_ fs.NodeSetattrer = (*node)(nil)
	_ fs.NodeStatfser  = (*node)(nil)
)

func linkContent(it *Item) []byte {
	icon := "x-office-document"
	switch {
	case strings.HasSuffix(it.Mime, "spreadsheet"):
		icon = "x-office-spreadsheet"
	case strings.HasSuffix(it.Mime, "presentation"):
		icon = "x-office-presentation"
	case strings.HasSuffix(it.Mime, "form"), strings.HasSuffix(it.Mime, "site"), strings.HasSuffix(it.Mime, "map"):
		icon = "text-html"
	}
	name := strings.NewReplacer("\n", " ", "\r", " ").Replace(it.Name)
	return []byte("[Desktop Entry]\nType=Link\nName=" + name + "\nURL=" + it.Link + "\nIcon=" + icon + "\n")
}

func (n *node) fill(out *fuse.Attr) syscall.Errno {
	out.Uid, out.Gid = n.m.plat.uid, n.m.plat.gid
	out.Ino = n.StableAttr().Ino
	out.Blksize = 1 << 20
	now := uint64(time.Now().Unix())
	if n.kind == kindDir {
		out.Mode, out.Nlink, out.Size = syscall.S_IFDIR|0o755, 2, 4096
		out.Mtime = now
		if it := n.m.meta.item(n.cid()); it != nil && it.MTime > 0 {
			out.Mtime = uint64(it.MTime)
		}
		out.Atime, out.Ctime = out.Mtime, out.Mtime
		return 0
	}
	out.Nlink = 1
	if p := n.m.pending(n.cid()); p != nil {
		info, err := os.Stat(p.data())
		if err != nil {
			return syscall.EIO
		}
		out.Mode, out.Size, out.Mtime = syscall.S_IFREG|0o644, uint64(info.Size()), uint64(info.ModTime().Unix())
	} else {
		it := n.m.meta.item(n.cid())
		if it == nil {
			return syscall.ENOENT
		}
		out.Mode, out.Size, out.Mtime = syscall.S_IFREG|0o644, uint64(it.Size), uint64(it.MTime)
		if n.kind == kindLink {
			out.Mode, out.Size = syscall.S_IFREG|0o444, uint64(len(linkContent(it)))
		} else if !it.CanEdit {
			out.Mode = syscall.S_IFREG | 0o444
		}
	}
	out.Blocks = (out.Size + 511) / 512
	out.Atime, out.Ctime = out.Mtime, out.Mtime
	return 0
}

func (n *node) child(ctx context.Context, e entry) *fs.Inode {
	mode := uint32(syscall.S_IFREG)
	if e.Kind == kindDir {
		mode = syscall.S_IFDIR
	}
	return n.NewInode(ctx, newNode(n.m, e.It.ID, e.Content.ID, e.Kind), fs.StableAttr{Mode: mode, Ino: inoOf(e.It.ID)})
}

func (n *node) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	if err := n.m.meta.ensure(ctx, n.m.drive, n.cid()); err != nil {
		return nil, errno(err)
	}
	e, ok := n.m.meta.find(n.cid(), name)
	if !ok {
		return nil, syscall.ENOENT
	}
	child := n.child(ctx, e)
	if eno := child.Operations().(*node).fill(&out.Attr); eno != 0 {
		return nil, eno
	}
	return child, 0
}

func (n *node) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	if err := n.m.meta.ensure(ctx, n.m.drive, n.cid()); err != nil {
		return nil, errno(err)
	}
	list := n.m.meta.listing(n.cid())
	out := make([]fuse.DirEntry, 0, len(list))
	for _, e := range list {
		mode := uint32(syscall.S_IFREG)
		if e.Kind == kindDir {
			mode = syscall.S_IFDIR
		}
		out = append(out, fuse.DirEntry{Name: e.Name, Mode: mode, Ino: inoOf(e.It.ID)})
	}
	return fs.NewListDirStream(out), 0
}

func (n *node) Getattr(ctx context.Context, _ fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	return n.fill(&out.Attr)
}

func (n *node) Statfs(ctx context.Context, out *fuse.StatfsOut) syscall.Errno {
	usage, limit := n.m.quota(ctx)
	if limit <= 0 {
		limit = usage + 1<<50
	}
	out.Bsize, out.Frsize, out.NameLen = 4096, 4096, 255
	out.Blocks = uint64(limit) / 4096
	out.Bfree = uint64(max(limit-usage, 0)) / 4096
	out.Bavail = out.Bfree
	return 0
}

// writable reports whether new entries may be created inside this folder.
func (n *node) writable() syscall.Errno {
	if n.kind != kindDir {
		return syscall.EPERM
	}
	return n.m.writableDir(n.cid())
}

type handle struct {
	n  *node
	mu sync.Mutex
	r  reader
	p  *Pending
	f  *os.File
	rw bool
}

var (
	_ fs.FileReader   = (*handle)(nil)
	_ fs.FileWriter   = (*handle)(nil)
	_ fs.FileReleaser = (*handle)(nil)
	_ fs.FileFlusher  = (*handle)(nil)
	_ fs.FileFsyncer  = (*handle)(nil)
)

func (n *node) Open(ctx context.Context, flags uint32) (fs.FileHandle, uint32, syscall.Errno) {
	h := &handle{n: n}
	if flags&(syscall.O_WRONLY|syscall.O_RDWR|syscall.O_TRUNC|syscall.O_APPEND) != 0 {
		if readOnly() {
			return nil, 0, syscall.EROFS
		}
		if n.kind != kindFile {
			return nil, 0, syscall.EACCES
		}
		h.rw = true
		if flags&syscall.O_TRUNC != 0 {
			if eno := h.attach(ctx, 0); eno != 0 {
				return nil, 0, eno
			}
		}
	}
	if h.p == nil {
		// A file with unsent changes is read from the local copy.
		if p := n.m.pending(n.cid()); p != nil {
			if eno := h.adopt(p); eno != 0 {
				return nil, 0, eno
			}
		}
	}
	if n.kind == kindLink || h.p != nil {
		return h, fuse.FOPEN_DIRECT_IO, 0
	}
	return h, fuse.FOPEN_KEEP_CACHE, 0
}

func (h *handle) adopt(p *Pending) syscall.Errno {
	f, err := os.OpenFile(p.data(), os.O_RDWR, 0o600)
	if err != nil {
		return syscall.EIO
	}
	h.p, h.f = p, f
	h.n.m.retain(p)
	return 0
}

// attach makes the handle write to a local copy, creating it on the first change. keep < 0 keeps the whole content.
func (h *handle) attach(ctx context.Context, keep int64) syscall.Errno {
	if h.p != nil {
		return 0
	}
	p, err := h.n.m.materialize(ctx, h.n.cid(), keep)
	if err != nil {
		return errno(err)
	}
	return h.adopt(p)
}

func (h *handle) Read(ctx context.Context, dest []byte, off int64) (fuse.ReadResult, syscall.Errno) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.f != nil {
		n, err := h.f.ReadAt(dest, off)
		if err != nil && err != io.EOF {
			return nil, syscall.EIO
		}
		return fuse.ReadResultData(dest[:n]), 0
	}
	it := h.n.m.meta.item(h.n.cid())
	if it == nil {
		return nil, syscall.ENOENT
	}
	if h.n.kind == kindLink {
		data := linkContent(it)
		if off >= int64(len(data)) {
			return fuse.ReadResultData(nil), 0
		}
		return fuse.ReadResultData(data[off:min(int64(len(data)), off+int64(len(dest)))]), 0
	}
	n, err := h.n.m.cache.file(it).ReadAt(ctx, dest, off, &h.r, prioInteractive)
	if err != nil && n == 0 {
		h.n.m.problem("Ler do Drive", it.Name, err)
		return nil, errno(err)
	}
	return fuse.ReadResultData(dest[:n]), 0
}

func (h *handle) Write(ctx context.Context, data []byte, off int64) (uint32, syscall.Errno) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.rw {
		return 0, syscall.EBADF
	}
	if eno := h.attach(ctx, -1); eno != 0 {
		return 0, eno
	}
	n, err := h.f.WriteAt(data, off)
	if err != nil {
		return uint32(n), syscall.EIO
	}
	h.n.m.touch(h.p)
	return uint32(n), 0
}

func (h *handle) Flush(ctx context.Context) syscall.Errno { return 0 }

func (h *handle) Fsync(ctx context.Context, flags uint32) syscall.Errno {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.f != nil && h.f.Sync() != nil {
		return syscall.EIO
	}
	return 0
}

func (h *handle) Release(ctx context.Context) syscall.Errno {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.f != nil {
		h.f.Close()
		h.n.m.release(h.p)
		h.f, h.p = nil, nil
	}
	return 0
}

func (n *node) Setattr(ctx context.Context, fh fs.FileHandle, in *fuse.SetAttrIn, out *fuse.AttrOut) syscall.Errno {
	if size, ok := in.GetSize(); ok {
		if readOnly() {
			return syscall.EROFS
		}
		if n.kind != kindFile {
			return syscall.EACCES
		}
		if h, ok := fh.(*handle); ok && h != nil {
			h.mu.Lock()
			eno := h.attach(ctx, int64(size))
			if eno == 0 && h.f.Truncate(int64(size)) != nil {
				eno = syscall.EIO
			}
			if eno == 0 {
				n.m.touch(h.p)
			}
			h.mu.Unlock()
			if eno != 0 {
				return eno
			}
		} else {
			p, err := n.m.materialize(ctx, n.cid(), int64(size))
			if err != nil {
				return errno(err)
			}
			n.m.retain(p)
			err = os.Truncate(p.data(), int64(size))
			n.m.touch(p)
			n.m.release(p)
			if err != nil {
				return syscall.EIO
			}
		}
	}
	if mtime, ok := in.GetMTime(); ok {
		if p := n.m.pending(n.cid()); p != nil {
			_ = os.Chtimes(p.data(), mtime, mtime)
		}
	}
	return n.fill(&out.Attr)
}

func (n *node) Create(ctx context.Context, name string, flags uint32, mode uint32, out *fuse.EntryOut) (*fs.Inode, fs.FileHandle, uint32, syscall.Errno) {
	if eno := n.writable(); eno != 0 {
		return nil, nil, 0, eno
	}
	if err := n.m.meta.ensure(ctx, n.m.drive, n.cid()); err != nil {
		return nil, nil, 0, errno(err)
	}
	e, ok := n.m.meta.find(n.cid(), name)
	if ok && flags&syscall.O_EXCL != 0 {
		return nil, nil, 0, syscall.EEXIST
	}
	if !ok {
		if len(name) > 250 || strings.ContainsAny(name, "∕") {
			return nil, nil, 0, syscall.ENAMETOOLONG
		}
		it, err := n.m.newLocal(ctx, n.cid(), name)
		if err != nil {
			return nil, nil, 0, errno(err)
		}
		e = entry{Name: name, It: it, Content: it, Kind: kindFile}
	} else if e.Kind != kindFile {
		return nil, nil, 0, syscall.EACCES
	}
	child := n.child(ctx, e)
	cn := child.Operations().(*node)
	h := &handle{n: cn, rw: true}
	keep := int64(-1)
	if ok && flags&syscall.O_TRUNC != 0 {
		keep = 0
	}
	if ok && keep < 0 {
		if p := n.m.pending(cn.cid()); p != nil {
			if eno := h.adopt(p); eno != 0 {
				return nil, nil, 0, eno
			}
		}
	} else if eno := h.attach(ctx, keep); eno != 0 {
		return nil, nil, 0, eno
	}
	if eno := cn.fill(&out.Attr); eno != 0 {
		return nil, nil, 0, eno
	}
	if h.p != nil {
		return child, h, fuse.FOPEN_DIRECT_IO, 0
	}
	return child, h, fuse.FOPEN_KEEP_CACHE, 0
}

func (n *node) Mkdir(ctx context.Context, name string, mode uint32, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	if eno := n.writable(); eno != 0 {
		return nil, eno
	}
	_ = n.m.meta.ensure(ctx, n.m.drive, n.cid())
	if _, ok := n.m.meta.find(n.cid(), name); ok {
		return nil, syscall.EEXIST
	}
	it, eno := n.m.makeDir(ctx, n.cid(), name)
	if eno != 0 {
		return nil, eno
	}
	child := n.child(ctx, entry{Name: name, It: it, Content: it, Kind: kindDir})
	child.Operations().(*node).fill(&out.Attr)
	return child, 0
}

func (n *node) Unlink(ctx context.Context, name string) syscall.Errno {
	return n.m.removeEntry(ctx, n.cid(), name, false)
}
func (n *node) Rmdir(ctx context.Context, name string) syscall.Errno {
	return n.m.removeEntry(ctx, n.cid(), name, true)
}

func (n *node) Rename(ctx context.Context, name string, newParent fs.InodeEmbedder, newName string, flags uint32) syscall.Errno {
	target, ok := newParent.(*node)
	if !ok {
		return syscall.EXDEV
	}
	if flags != 0 {
		return syscall.EINVAL
	}
	if eno := n.writable(); eno != 0 {
		return eno
	}
	if eno := target.writable(); eno != 0 {
		return eno
	}
	adopted, eno := n.m.rename(ctx, n.cid(), name, target.cid(), newName)
	if adopted != "" {
		// The kernel keeps the temporary file's inode under the final name; point it at the item.
		if child := n.GetChild(name); child != nil {
			if moved, ok := child.Operations().(*node); ok {
				moved.content.Store(&adopted)
			}
		}
	}
	return eno
}
