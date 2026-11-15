package tiles

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

func TestCacheCoalescesAndPersists(t *testing.T) {
	dir := t.TempDir()
	cache := NewCache(dir, 2, 4, nil)
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	load := func(context.Context) ([]byte, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return []byte("tile"), nil
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, err := cache.Get(context.Background(), "one", load)
			if err != nil || string(data) != "tile" {
				t.Errorf("Get = %q, %v", data, err)
			}
		}()
	}
	<-started
	close(release)
	wg.Wait()
	cache.Flush()
	restarted := NewCache(dir, 2, 4, nil)
	data, err := restarted.Get(context.Background(), "one", load)
	if err != nil || string(data) != "tile" || calls.Load() != 1 {
		t.Fatalf("restart = %q, %v, calls %d", data, err, calls.Load())
	}
}

func TestCacheEvictsAndRepairsDisk(t *testing.T) {
	dir := t.TempDir()
	validate := func(b []byte) error {
		if bytes.Equal(b, []byte("bad")) {
			return errors.New("corrupt")
		}
		return nil
	}
	cache := NewCache(dir, 2, 4, validate)
	for _, key := range []string{"one", "two", "three"} {
		if _, err := cache.Get(context.Background(), key, func(context.Context) ([]byte, error) { return []byte("good"), nil }); err != nil {
			t.Fatal(err)
		}
	}
	cache.Flush()
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[0].Name() != "three" || files[1].Name() != "two" {
		t.Fatalf("unexpected cache files: %v", files)
	}
	if err := os.WriteFile(filepath.Join(dir, "two"), []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	var calls int
	// 'two' has left memory, so its damaged disk entry must be replaced.
	data, err := cache.Get(context.Background(), "two", func(context.Context) ([]byte, error) { calls++; return []byte("good"), nil })
	cache.Flush()
	if err != nil || string(data) != "good" || calls != 1 {
		t.Fatalf("repair = %q, %v, calls %d", data, err, calls)
	}
}

func TestCacheFailureCanRetryAndWaiterCanCancel(t *testing.T) {
	cache := NewCache(t.TempDir(), 2, 4, nil)
	defer cache.Flush()
	_, err := cache.Get(context.Background(), "one", func(context.Context) ([]byte, error) { return nil, errors.New("offline") })
	if err == nil {
		t.Fatal("expected download failure")
	}
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		_, _ = cache.Get(context.Background(), "one", func(context.Context) ([]byte, error) { close(started); <-release; return []byte("good"), nil })
	}()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = cache.Get(ctx, "one", func(context.Context) ([]byte, error) { t.Error("duplicate fetch"); return nil, nil })
	close(release)
	<-done
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("waiter error = %v", err)
	}
}

func TestDiskFailureDoesNotFailRequest(t *testing.T) {
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	cache := NewCache(file, 2, 4, nil)
	data, err := cache.Get(context.Background(), "one", func(context.Context) ([]byte, error) { return []byte("good"), nil })
	cache.Flush()
	if err != nil || string(data) != "good" {
		t.Fatalf("Get = %q, %v", data, err)
	}
}
