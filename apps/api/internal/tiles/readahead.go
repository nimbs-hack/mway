package tiles

import (
	"context"
	"sync"
)

// readAheadFrom is the first level that reads ahead. Below it a view covers
// so much ground that its neighbours and children are most of the planet.
const readAheadFrom = 8

// readAheadTried bounds the record of tiles already asked for.
const readAheadTried = 1 << 16

// ReadAhead downloads tiles a viewer is likely to ask for next, in the
// background, so that they come from the cache when it does. A browser opens
// only six connections to this server, and an upstream tile takes a few
// tenths of a second, so fetching ahead here is what makes a zoom or a pan
// land on ground that is already loaded.
//
// Each tile is tried once for the life of the server, found or not, so a
// tile that does not exist upstream is not asked for again and again.
type ReadAhead struct {
	jobs  chan func(context.Context)
	stop  context.CancelFunc
	done  sync.WaitGroup
	mu    sync.Mutex
	tried map[string]struct{}
}

// NewReadAhead starts workers that run at most `workers` downloads at once
// and hold at most `backlog` more.
func NewReadAhead(workers, backlog int) *ReadAhead {
	ctx, stop := context.WithCancel(context.Background())
	r := &ReadAhead{
		jobs:  make(chan func(context.Context), backlog),
		stop:  stop,
		tried: make(map[string]struct{}),
	}
	for range workers {
		r.done.Add(1)
		go func() {
			defer r.done.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case job := <-r.jobs:
					job(ctx)
				}
			}
		}()
	}
	return r
}

// offer queues a download unless that key was offered before. When the
// backlog is full the job is dropped: reading ahead never holds up a request.
// A nil ReadAhead does nothing, which is how reading ahead is switched off.
func (r *ReadAhead) offer(key string, job func(context.Context)) {
	if r == nil {
		return
	}
	r.mu.Lock()
	if _, seen := r.tried[key]; seen {
		r.mu.Unlock()
		return
	}
	if len(r.tried) >= readAheadTried {
		clear(r.tried)
	}
	r.tried[key] = struct{}{}
	r.mu.Unlock()
	select {
	case r.jobs <- job:
	default:
		r.mu.Lock()
		delete(r.tried, key)
		r.mu.Unlock()
	}
}

// Close stops the workers and waits for downloads in flight. Run it before
// flushing the caches they write to.
func (r *ReadAhead) Close() {
	if r == nil {
		return
	}
	r.stop()
	r.done.Wait()
}

// tile is a position in a geographic grid with 2^(z+1) columns and 2^z rows.
type tile struct{ z, col, row int }

// around lists the tiles a viewer of t is likely to want next: its four
// children, for zooming in, and its four edge neighbours, for panning.
// Columns wrap around the planet. Rows stop at the poles. Children are left
// out past maxZ, and nothing is listed below readAheadFrom.
func around(t tile, maxZ int) []tile {
	return aroundFrom(t, readAheadFrom, maxZ)
}

// aroundFrom is around with its own first level, for a coarse layer whose
// deepest level is below readAheadFrom.
func aroundFrom(t tile, minZ, maxZ int) []tile {
	if t.z < minZ {
		return nil
	}
	cols, rows := 2<<t.z, 1<<t.z
	next := []tile{
		{t.z, (t.col + 1) % cols, t.row},
		{t.z, (t.col + cols - 1) % cols, t.row},
	}
	if t.row+1 < rows {
		next = append(next, tile{t.z, t.col, t.row + 1})
	}
	if t.row > 0 {
		next = append(next, tile{t.z, t.col, t.row - 1})
	}
	if t.z < maxZ {
		for quadrant := range 4 {
			next = append(next, tile{t.z + 1, t.col*2 + quadrant%2, t.row*2 + quadrant/2})
		}
	}
	return next
}
