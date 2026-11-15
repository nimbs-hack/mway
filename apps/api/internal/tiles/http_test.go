package tiles

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFetchBoundsBody(t *testing.T) {
	for _, chunked := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if chunked {
				w.(http.Flusher).Flush()
			}
			_, _ = w.Write([]byte("12345"))
		}))
		_, _, err := Fetch(context.Background(), server.Client(), server.URL, 4)
		server.Close()
		if err == nil {
			t.Fatalf("accepted oversize body, chunked=%v", chunked)
		}
	}
}

func TestParseCoordinate(t *testing.T) {
	for _, s := range []string{"", "-1", "+1", "01", "1.0", " 1", "4", "999999999999999999999999"} {
		if _, err := ParseCoordinate(s, 3); err == nil {
			t.Errorf("accepted %q", s)
		}
	}
	for _, s := range []string{"0", "1", "3"} {
		if _, err := ParseCoordinate(s, 3); err != nil {
			t.Errorf("rejected %q", s)
		}
	}
}

func TestTileClientReusesConnectionsBetweenBursts(t *testing.T) {
	const count = 16
	arrived := make(chan struct{}, count)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		arrived <- struct{}{}
		select {
		case <-release:
			_, _ = w.Write([]byte("tile"))
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	client := NewClient()
	defer client.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for burst := 0; burst < 2; burst++ {
		var reused atomic.Int32
		var group sync.WaitGroup
		for i := 0; i < count; i++ {
			group.Add(1)
			go func() {
				defer group.Done()
				trace := &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
					if info.Reused {
						reused.Add(1)
					}
				}}
				ctx := httptrace.WithClientTrace(ctx, trace)
				if _, _, err := Fetch(ctx, client, server.URL, 1024); err != nil {
					t.Errorf("tile fetch: %v", err)
				}
			}()
		}
		for i := 0; i < count; i++ {
			select {
			case <-arrived:
			case <-ctx.Done():
				t.Fatal("tile burst did not arrive before timeout")
			}
		}
		for i := 0; i < count; i++ {
			select {
			case release <- struct{}{}:
			case <-ctx.Done():
				t.Fatal("tile burst did not finish before timeout")
			}
		}
		group.Wait()
		if burst == 1 && reused.Load() != count {
			t.Fatalf("second burst reused %d of %d connections", reused.Load(), count)
		}
	}
}
