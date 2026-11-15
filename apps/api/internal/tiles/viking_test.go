package tiles

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

type vikingTestTransport struct {
	origin *url.URL
	base   http.RoundTripper
}

func (transport vikingTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != "https" || r.URL.Host != "trek.nasa.gov" {
		return nil, fmt.Errorf("unexpected upstream %s", r.URL)
	}
	request := r.Clone(r.Context())
	request.URL.Scheme = transport.origin.Scheme
	request.URL.Host = transport.origin.Host
	return transport.base.RoundTrip(request)
}

func vikingJPEG(t *testing.T) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := jpeg.Encode(&out, image.NewRGBA(image.Rect(0, 0, vikingTileSize, vikingTileSize)), nil); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestVikingCachesTiles(t *testing.T) {
	tile := vikingJPEG(t)
	var hits atomic.Int32
	var lastPath atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		lastPath.Store(r.URL.Path)
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(tile)
	}))
	t.Cleanup(server.Close)
	origin, _ := url.Parse(server.URL)
	client := server.Client()
	client.Transport = vikingTestTransport{origin, client.Transport}

	mux := http.NewServeMux()
	flush := RegisterViking(mux, t.TempDir(), client)
	t.Cleanup(flush)
	for range 2 {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, VikingPath+"/5/10/40.jpg", nil))
		if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/jpeg" || !bytes.Equal(w.Body.Bytes(), tile) {
			t.Fatalf("status %d type %q", w.Code, w.Header().Get("Content-Type"))
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("upstream hit %d times, want 1", hits.Load())
	}
	want := "/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/5/10/40.jpg"
	if got := lastPath.Load(); got != want {
		t.Fatalf("upstream path %q, want %q", got, want)
	}
}

func TestVikingRejectsBadCoordinates(t *testing.T) {
	mux := http.NewServeMux()
	t.Cleanup(RegisterViking(mux, t.TempDir(), http.DefaultClient))
	for _, path := range []string{"8/0/0.jpg", "5/32/0.jpg", "5/0/64.jpg", "5/0/0.png"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, VikingPath+"/"+path, nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", path, w.Code)
		}
	}
}

func TestAroundFromReachesVikingLevels(t *testing.T) {
	if got := around(tile{5, 0, 0}, 7); got != nil {
		t.Fatalf("around below readAheadFrom = %v", got)
	}
	if got := aroundFrom(tile{5, 0, 0}, vikingReadAheadFrom, vikingMaxLevel); len(got) != 7 {
		t.Fatalf("aroundFrom at a pole corner gave %d tiles, want 7", len(got))
	}
}
