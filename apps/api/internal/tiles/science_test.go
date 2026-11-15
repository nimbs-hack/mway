package tiles

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type scienceTransport func(*http.Request) (*http.Response, error)

func (f scienceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func scienceResponse(status int, contentType string, data []byte) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {contentType}}, Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data))}
}

func scienceFixture(t *testing.T, size int, asJPEG bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	img.SetNRGBA(0, 0, color.NRGBA{R: 80, G: 120, B: 160, A: 128})
	var b bytes.Buffer
	var err error
	if asJPEG {
		err = jpeg.Encode(&b, img, nil)
	} else {
		err = png.Encode(&b, img)
	}
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func scienceRequest(h http.Handler, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, sciencePath+path, nil))
	return w
}

func TestScienceAllowlistAndCache(t *testing.T) {
	pngData, jpegData := scienceFixture(t, 256, false), scienceFixture(t, 256, true)
	for id, source := range scienceSources {
		t.Run(id, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: scienceTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				want := source.url(0, 0, 1)
				if r.URL.String() != want {
					t.Errorf("upstream = %s, want %s", r.URL, want)
				}
				if source.extension == "jpg" {
					return scienceResponse(200, "image/jpeg", jpegData), nil
				}
				return scienceResponse(200, "image/png; charset=binary", pngData), nil
			})}
			dir := t.TempDir()
			mux := http.NewServeMux()
			flush := RegisterScience(mux, dir, client)
			t.Cleanup(flush)
			var first []byte
			for range 2 {
				w := scienceRequest(mux, "/"+id+"/0/0/1.png?url=https://example.com")
				if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || w.Header().Get("X-Science-Source") != id || !strings.Contains(w.Header().Get("Cache-Control"), "max-age=") {
					t.Fatalf("response = %d, %v", w.Code, w.Header())
				}
				if err := validateSciencePNG(w.Body.Bytes()); err != nil {
					t.Fatal(err)
				}
				if source.extension == "png" && !bytes.Equal(w.Body.Bytes(), pngData) {
					t.Fatal("PNG bytes or alpha changed")
				}
				first = bytes.Clone(w.Body.Bytes())
			}
			flush()
			restarted := http.NewServeMux()
			t.Cleanup(RegisterScience(restarted, dir, client))
			if w := scienceRequest(restarted, "/"+id+"/0/0/1.png"); !bytes.Equal(w.Body.Bytes(), first) || calls != 1 {
				t.Fatalf("disk cache response = %d, upstream calls = %d", w.Code, calls)
			}
			// A damaged disk entry must be fetched again after a restart.
			if err := os.WriteFile(filepath.Join(dir, id+"-0-0-1.png"), []byte("broken"), 0600); err != nil {
				t.Fatal(err)
			}
			repaired := http.NewServeMux()
			t.Cleanup(RegisterScience(repaired, dir, client))
			if w := scienceRequest(repaired, "/"+id+"/0/0/1.png"); w.Code != 200 || calls != 2 {
				t.Fatalf("repair response = %d, upstream calls = %d", w.Code, calls)
			}
		})
	}
}

func TestScienceRejectsInvalidRequests(t *testing.T) {
	client := &http.Client{Transport: scienceTransport(func(*http.Request) (*http.Response, error) {
		t.Error("invalid request reached upstream")
		return nil, fmt.Errorf("unexpected fetch")
	})}
	mux := http.NewServeMux()
	t.Cleanup(RegisterScience(mux, t.TempDir(), client))
	for _, path := range []string{
		"/themis-day/10/0/0.png", "/themis-day/999999999999999999999/0/0.png",
		"/themis-day/-1/0/0.png", "/themis-day/01/0/0.png", "/themis-day/+1/0/0.png",
		"/themis-day/0/1/0.png", "/themis-day/0/0/2.png", "/themis-day/0/-1/0.png",
		"/themis-day/0/0/00.png", "/themis-day/0/0/0.jpg", "/themis-day/0/0/.png",
		"/themis-day/0/0/0.png.png", "/tes-albedo/2/0/0.png", "/mola-color/8/0/0.png",
	} {
		if w := scienceRequest(mux, path); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d", path, w.Code)
		}
	}
	if w := scienceRequest(mux, "/unknown/0/0/0.png"); w.Code != http.StatusNotFound {
		t.Errorf("unknown layer: status = %d", w.Code)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, sciencePath+"/themis-day/0/0/0.png", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: status = %d", w.Code)
	}
}

func TestScienceUpstreamErrorsAreNotCached(t *testing.T) {
	valid := scienceFixture(t, 256, false)
	for _, tc := range []struct {
		name   string
		status int
		mime   string
		data   []byte
	}{
		{"missing", 404, "text/html", nil},
		{"unavailable", 503, "text/html", nil},
		{"redirect", 302, "text/html", nil},
		{"wrong MIME", 200, "text/html", valid},
		{"corrupt PNG", 200, "image/png", valid[:len(valid)/2]},
		{"wrong dimensions", 200, "image/png", scienceFixture(t, 512, false)},
		{"wrong format", 200, "image/png", scienceFixture(t, 256, true)},
		{"oversize", 200, "image/png", make([]byte, 2*1024*1024+1)},
		{"network", 0, "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: scienceTransport(func(*http.Request) (*http.Response, error) {
				calls++
				if calls > 1 {
					return scienceResponse(200, "image/png", valid), nil
				}
				if tc.status == 0 {
					return nil, fmt.Errorf("offline")
				}
				r := scienceResponse(tc.status, tc.mime, tc.data)
				r.Header.Set("Location", "https://example.com/untrusted.png")
				return r, nil
			})}
			mux := http.NewServeMux()
			t.Cleanup(RegisterScience(mux, t.TempDir(), client))
			w := scienceRequest(mux, "/themis-day/0/0/0.png")
			if w.Code != http.StatusBadGateway || w.Header().Get("Cache-Control") != "no-store" || calls != 1 {
				t.Fatalf("error response = %d, %v, calls = %d", w.Code, w.Header(), calls)
			}
			if w := scienceRequest(mux, "/themis-day/0/0/0.png"); w.Code != 200 || calls != 2 {
				t.Fatalf("retry response = %d, calls = %d", w.Code, calls)
			}
			if client.CheckRedirect != nil {
				t.Fatal("shared client was mutated")
			}
		})
	}
}

func TestScienceCatalogMatchesAllowlist(t *testing.T) {
	data, err := os.ReadFile("../../../../src/data/science-rasters.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog []struct {
		ID       string `json:"id"`
		URL      string `json:"url"`
		MaxLevel int    `json:"maxLevel"`
		TileSize int    `json:"tileSize"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for _, entry := range catalog {
		source, ok := scienceSources[entry.ID]
		if !ok || seen[entry.ID] || entry.MaxLevel != source.maxLevel || entry.TileSize != source.tileSize || entry.URL != sciencePath+"/"+entry.ID+"/{z}/{y}/{x}.png" {
			t.Errorf("catalog entry does not match allowlist: %+v", entry)
		}
		seen[entry.ID] = true
	}
	if len(seen) != len(scienceSources) {
		t.Fatalf("catalog has %d layers; allowlist has %d", len(seen), len(scienceSources))
	}
}
