package tiles

import (
	"context"
	"slices"
	"sync"
	"testing"
)

func TestAroundListsChildrenAndEdgeNeighbours(t *testing.T) {
	got := around(tile{9, 5, 3}, 12)
	want := []tile{{9, 6, 3}, {9, 4, 3}, {9, 5, 4}, {9, 5, 2}, {10, 10, 6}, {10, 11, 6}, {10, 10, 7}, {10, 11, 7}}
	if !slices.Equal(got, want) {
		t.Fatalf("around: got %v, want %v", got, want)
	}
}

func TestAroundWrapsColumnsAndStopsAtThePolesAndTheLastLevel(t *testing.T) {
	// Level 8 has 512 columns and 256 rows. This is the last column of the top row.
	got := around(tile{8, 511, 0}, 8)
	want := []tile{{8, 0, 0}, {8, 510, 0}, {8, 511, 1}}
	if !slices.Equal(got, want) {
		t.Fatalf("at the edge: got %v, want %v", got, want)
	}
	if got := around(tile{readAheadFrom - 1, 0, 0}, 12); got != nil {
		t.Fatalf("a wide view must not read ahead, got %v", got)
	}
}

func TestReadAheadRunsEachKeyOnceAndDropsWhatDoesNotFit(t *testing.T) {
	ahead := NewReadAhead(1, 1)
	var mu sync.Mutex
	ran := map[string]int{}
	count := func(key string) {
		mu.Lock()
		ran[key]++
		mu.Unlock()
	}
	started, gate := make(chan struct{}), make(chan struct{})
	bDone, cDone := make(chan struct{}), make(chan struct{})

	ahead.offer("a", func(context.Context) {
		close(started)
		<-gate
		count("a")
	})
	<-started
	// The worker is busy with "a". One more fits in the backlog and the next is dropped.
	ahead.offer("b", func(context.Context) { count("b"); close(bDone) })
	ahead.offer("c", func(context.Context) { t.Error("the backlog was full, so this must not run") })
	ahead.offer("a", func(context.Context) { t.Error("a was offered before") })
	close(gate)
	<-bDone
	// A dropped key may be offered again. A key that ran may not.
	ahead.offer("c", func(context.Context) { count("c"); close(cDone) })
	<-cDone
	ahead.offer("b", func(context.Context) { t.Error("b ran before") })
	ahead.Close()

	mu.Lock()
	defer mu.Unlock()
	if ran["a"] != 1 || ran["b"] != 1 || ran["c"] != 1 {
		t.Fatalf("each key runs once: %v", ran)
	}
}

func TestANilReadAheadDoesNothing(t *testing.T) {
	var ahead *ReadAhead
	ahead.offer("a", func(context.Context) { t.Fatal("must not run") })
	ahead.Close()
}
