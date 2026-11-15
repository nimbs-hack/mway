package tiles

import (
	"container/list"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

type cacheEntry struct {
	key  string
	data []byte
}
type pendingTile struct {
	done chan struct{}
	data []byte
	err  error
}

// Cache coalesces downloads and keeps a byte-bounded LRU in front of the disk cache.
// Callers must treat returned bytes as immutable. Flush drains downloads and writes.
type Cache struct {
	dir                              string
	maxTiles, memoryBytes, usedBytes int
	validate                         func([]byte) error
	mu                               sync.Mutex
	idle                             *sync.Cond
	memory                           map[string]*list.Element
	lru                              *list.List
	pending                          map[string]*pendingTile
	writes                           []cacheEntry
	writing                          bool
	files                            []string
	filesLoaded                      bool
}

func NewCache(dir string, maxTiles int, memoryBytes int, validate func([]byte) error) *Cache {
	c := &Cache{dir: dir, maxTiles: maxTiles, memoryBytes: memoryBytes, validate: validate,
		memory: make(map[string]*list.Element), lru: list.New(), pending: make(map[string]*pendingTile)}
	c.idle = sync.NewCond(&c.mu)
	return c
}

func (c *Cache) Get(ctx context.Context, key string, load func(context.Context) ([]byte, error)) ([]byte, error) {
	if key == "." || key == ".." || filepath.Base(key) != key {
		return nil, fmt.Errorf("invalid cache key")
	}
	c.mu.Lock()
	if entry := c.memory[key]; entry != nil {
		c.lru.MoveToBack(entry)
		data := entry.Value.(cacheEntry).data
		c.mu.Unlock()
		return data, nil
	}
	if pending := c.pending[key]; pending != nil {
		c.mu.Unlock()
		select {
		case <-pending.done:
			return pending.data, pending.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	pending := &pendingTile{done: make(chan struct{})}
	c.pending[key] = pending
	c.mu.Unlock()

	data, err := c.read(key)
	downloaded := false
	if err != nil {
		data, err = load(ctx)
		if err == nil && c.validate != nil {
			err = c.validate(data)
		}
		downloaded = err == nil
	}
	c.mu.Lock()
	if err == nil {
		if len(data) <= c.memoryBytes {
			c.memory[key] = c.lru.PushBack(cacheEntry{key, data})
			c.usedBytes += len(data)
			for c.usedBytes > c.memoryBytes {
				old := c.lru.Front()
				entry := old.Value.(cacheEntry)
				delete(c.memory, entry.key)
				c.usedBytes -= len(entry.data)
				c.lru.Remove(old)
			}
		}
		if downloaded {
			c.writes = append(c.writes, cacheEntry{key, data})
			if !c.writing {
				c.writing = true
				go c.drain()
			}
		}
	}
	pending.data, pending.err = data, err
	delete(c.pending, key)
	close(pending.done)
	c.idle.Broadcast()
	c.mu.Unlock()
	return data, err
}

func (c *Cache) read(key string) ([]byte, error) {
	file := filepath.Join(c.dir, key)
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	// Metadata is larger than a tile. Bound even old cache files before decoding.
	const maxStoredBytes = 16 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(f, maxStoredBytes+1))
	f.Close()
	if err == nil && len(data) > maxStoredBytes {
		err = fmt.Errorf("cached tile too large")
	}
	if err == nil && c.validate != nil {
		err = c.validate(data)
	}
	if err != nil {
		_ = os.Remove(file)
	}
	return data, err
}

func (c *Cache) drain() {
	for {
		c.mu.Lock()
		if len(c.writes) == 0 {
			c.writing = false
			c.idle.Broadcast()
			c.mu.Unlock()
			return
		}
		entry := c.writes[0]
		c.writes[0] = cacheEntry{}
		c.writes = c.writes[1:]
		c.mu.Unlock()
		if err := c.store(entry); err != nil {
			log.Printf("Tile disk cache unavailable: %v", err)
		}
	}
}

func (c *Cache) store(entry cacheEntry) error {
	if err := os.MkdirAll(c.dir, 0755); err != nil {
		return err
	}
	if !c.filesLoaded {
		entries, err := os.ReadDir(c.dir)
		if err != nil {
			return err
		}
		var infos []os.FileInfo
		for _, entry := range entries {
			if entry.Type().IsRegular() && filepath.Ext(entry.Name()) != ".tmp" {
				info, err := entry.Info()
				if err != nil {
					return err
				}
				infos = append(infos, info)
			}
		}
		sort.Slice(infos, func(i, j int) bool { return infos[i].ModTime().Before(infos[j].ModTime()) })
		for _, info := range infos {
			c.files = append(c.files, info.Name())
		}
		c.filesLoaded = true
	}
	temp, err := os.CreateTemp(c.dir, "*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	_, writeErr := temp.Write(entry.data)
	closeErr := temp.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(temp.Name(), filepath.Join(c.dir, entry.key)); err != nil {
		return err
	}
	for i, key := range c.files {
		if key == entry.key {
			c.files = append(c.files[:i], c.files[i+1:]...)
			break
		}
	}
	c.files = append(c.files, entry.key)
	for len(c.files) > c.maxTiles {
		if err := os.Remove(filepath.Join(c.dir, c.files[0])); err != nil && !os.IsNotExist(err) {
			return err
		}
		c.files = c.files[1:]
	}
	return nil
}

// Flush should run after the server has stopped accepting requests.
func (c *Cache) Flush() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for len(c.pending) > 0 || c.writing {
		c.idle.Wait()
	}
}
