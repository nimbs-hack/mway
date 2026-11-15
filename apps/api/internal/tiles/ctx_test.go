package tiles

import (
	"bytes"
	"fmt"
	"image/color"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// Rewrite only the destination. Tests still check the fixed upstream paths.
type ctxTestTransport struct {
	origin *url.URL
	base   http.RoundTripper
}

func (transport ctxTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != "https" || r.URL.Host != "astro.arcgis.com" {
		return nil, fmt.Errorf("unexpected upstream %s", r.URL)
	}
	request := r.Clone(r.Context())
	request.URL.Scheme = transport.origin.Scheme
	request.URL.Host = transport.origin.Host
	return transport.base.RoundTrip(request)
}

func ctxTestClient(t *testing.T, handler http.HandlerFunc) *http.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := server.Client()
	client.Transport = ctxTestTransport{origin, client.Transport}
	return client
}

func ctxTestAPI(t *testing.T, dir string, client *http.Client) (*http.ServeMux, func()) {
	t.Helper()
	mux := http.NewServeMux()
	flush := RegisterCTX(mux, dir, client)
	t.Cleanup(flush)
	return mux, flush
}

func ctxTestRequest(handler http.Handler, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, CTXPath+"/"+path, nil))
	return w
}

func ctxTestFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names
}

func TestCTXCoalescingAndDiskReuse(t *testing.T) {
	for _, format := range []string{"png", "jpeg"} {
		t.Run(format, func(t *testing.T) {
			dir := t.TempDir()
			data := ctxTestSolid(t, color.Gray{Y: 136}, format)
			var calls atomic.Int32
			client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/arcgis/rest/services/OnMars/CTX1/MapServer/tile/12/1612/3340" {
					t.Errorf("unexpected path %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "image/"+format+"; charset=binary")
				_, _ = w.Write(data)
			})
			mux, flush := ctxTestAPI(t, dir, client)
			const path = "12/1612/3340.png"
			var pending sync.WaitGroup
			start := make(chan struct{})
			for range 12 {
				pending.Add(1)
				go func() {
					defer pending.Done()
					<-start
					response := ctxTestRequest(mux, path)
					if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), data) {
						t.Errorf("response status %d, original bytes preserved %v", response.Code, bytes.Equal(response.Body.Bytes(), data))
					}
					if response.Header().Get("Content-Type") != "image/"+format || response.Header().Get("X-Imagery-Source") != "CTX V01" || response.Header().Get("Cache-Control") != "public, max-age=2592000" {
						t.Errorf("response headers %v", response.Header())
					}
				}()
			}
			close(start)
			pending.Wait()
			flush()
			restarted, _ := ctxTestAPI(t, dir, client)
			response := ctxTestRequest(restarted, path+"?cache=4")
			if response.Code != 200 || response.Header().Get("Content-Type") != "image/"+format || !bytes.Equal(response.Body.Bytes(), data) {
				t.Fatal("disk hit did not preserve original image and MIME")
			}
			if calls.Load() != 1 {
				t.Fatalf("upstream calls = %d, want 1", calls.Load())
			}
		})
	}
}

func TestCTXCoordinatesAndSourceValidation(t *testing.T) {
	data := ctxTestSolid(t, color.Black, "png")
	var calls atomic.Int32
	client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
	})
	mux, _ := ctxTestAPI(t, t.TempDir(), client)
	invalid := []string{
		"13/0/0.png", "0/1/0.png", "0/0/2.png", "-1/0/0.png", "0/0/-1.png",
		"00/0/0.png", "0/00/0.png", "0/0/00.png", "1e1/0/0.png", "0/0/1.0.png",
		"+1/0/0.png", "0/0/0.jpg", "0/0/0", "12/4096/0.png", "12/0/8192.png",
		"999999999999999999999/0/0.png", "0/0/99999999999999999999.png",
		"0/0/0.png?source=", "0/0/0.png?source=other", "0/0/0.png?source=V01",
	}
	for _, path := range invalid {
		response := ctxTestRequest(mux, path)
		if response.Code != 400 || response.Body.String() != "Invalid CTX tile coordinates" {
			t.Errorf("%s: status %d, body %q", path, response.Code, response.Body.String())
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid coordinates reached upstream")
	}
	for _, path := range []string{"0/0/0.png", "0/0/1.png", "12/4095/8191.png"} {
		if response := ctxTestRequest(mux, path); response.Code != 200 {
			t.Errorf("valid boundary %s returned %d", path, response.Code)
		}
	}
}

func TestCTXRejectsUpstreamFailures(t *testing.T) {
	valid := ctxTestSolid(t, color.Black, "png")
	for _, test := range []struct {
		name   string
		status int
		mime   string
		data   []byte
	}{
		{"status", 503, "image/png", valid},
		{"html", 200, "text/html", []byte("<html>")},
		{"missing MIME", 200, "", valid},
		{"truncated", 200, "image/png", valid[:len(valid)-40]},
		{"oversize", 200, "image/png", append(bytes.Clone(valid), make([]byte, ctxMaxTileBytes)...)},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			var calls atomic.Int32
			client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header()["Content-Type"] = []string{test.mime}
				w.WriteHeader(test.status)
				_, _ = w.Write(test.data)
			})
			mux, flush := ctxTestAPI(t, dir, client)
			for range 2 {
				response := ctxTestRequest(mux, "0/0/0.png")
				if response.Code != 502 || response.Header().Get("Cache-Control") != "no-store" || response.Body.String() != "CTX tile unavailable" {
					t.Fatalf("unexpected failure response %v", response)
				}
			}
			flush()
			wantCalls := int32(2)
			if test.name == "truncated" {
				wantCalls = 10 // One bad parent and four bad children per attempt.
			}
			if calls.Load() != wantCalls || len(ctxTestFiles(t, dir)) != 0 {
				t.Fatal("upstream error was cached")
			}
		})
	}
}

func TestCTXOldDiskCacheAndCorruption(t *testing.T) {
	for _, format := range []string{"png", "jpeg"} {
		t.Run(format, func(t *testing.T) {
			dir := t.TempDir()
			data := ctxTestSolid(t, color.Gray{Y: 136}, format)
			for name, contents := range map[string][]byte{"12-1792-1719.png": data[:len(data)-40], "12-1792-1720.png": data} {
				if err := os.WriteFile(filepath.Join(dir, name), contents, 0600); err != nil {
					t.Fatal(err)
				}
			}
			var calls atomic.Int32
			client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				// Any allowed image MIME is accepted; response MIME follows bytes.
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write(data)
			})
			mux, flush := ctxTestAPI(t, dir, client)
			for _, path := range []string{"12/1792/1719.png?cache=2", "12/1792/1720.png"} {
				response := ctxTestRequest(mux, path)
				if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), data) || response.Header().Get("Content-Type") != "image/"+format {
					t.Fatal("failed to repair or reuse old disk cache")
				}
			}
			flush()
			stored, err := os.ReadFile(filepath.Join(dir, "12-1792-1719.png"))
			if err != nil || !bytes.Equal(stored, data) || calls.Load() != 1 {
				t.Fatalf("corrupt entry not replaced: %v, calls %d", err, calls.Load())
			}
		})
	}
}

func TestCTXSourceSeparation(t *testing.T) {
	dir := t.TempDir()
	pngData := ctxTestSolid(t, color.Black, "png")
	jpegData := ctxTestSolid(t, color.White, "jpeg")
	var primary, backup atomic.Int32
	client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/CTX1/") {
			primary.Add(1)
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngData[:len(pngData)-40])
		} else {
			if r.URL.Path != "/arcgis/rest/services/OnMars/CTX/MapServer/tile/12/1792/1719" {
				t.Errorf("unexpected backup path %s", r.URL.Path)
			}
			backup.Add(1)
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write(jpegData)
		}
	})
	mux, flush := ctxTestAPI(t, dir, client)
	const path = "12/1792/1719.png"
	if response := ctxTestRequest(mux, path); response.Code != 502 || backup.Load() != 0 {
		t.Fatal("primary failure silently fell back")
	}
	response := ctxTestRequest(mux, path+"?cache=3&source=beta01")
	if response.Code != 200 || response.Header().Get("X-Imagery-Source") != "CTX beta01 fallback" || !bytes.Equal(response.Body.Bytes(), jpegData) {
		t.Fatal("explicit backup not served")
	}
	flush()
	restarted, _ := ctxTestAPI(t, dir, client)
	if response := ctxTestRequest(restarted, path+"?source=beta01"); response.Code != 200 || response.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatal("backup disk entry not reused")
	}
	if response := ctxTestRequest(restarted, path+"?source=v01"); response.Code != 502 {
		t.Fatal("backup cache contaminated primary")
	}
	if primary.Load() != 2 || backup.Load() != 1 || len(ctxTestFiles(t, dir)) != 0 || !reflect.DeepEqual(ctxTestFiles(t, filepath.Join(dir, "beta01")), []string{"12-1792-1719.png"}) {
		t.Fatal("source caches were not kept separate")
	}
}

func TestCTXRebuildOrientationAndReuse(t *testing.T) {
	dir := t.TempDir()
	colors := []color.RGBA{{255, 0, 0, 255}, {0, 255, 0, 255}, {0, 0, 255, 255}, {255, 255, 255, 255}}
	var children [4][]byte
	for i, c := range colors {
		children[i] = ctxTestSolid(t, c, "png")
	}
	if err := os.WriteFile(filepath.Join(dir, "10-416-732.png"), children[0], 0600); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		for quadrant, data := range children {
			want := fmt.Sprintf("/arcgis/rest/services/OnMars/CTX1/MapServer/tile/11/%d/%d", 832+quadrant/2, 1464+quadrant%2)
			if r.URL.Path == want {
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write(data)
				return
			}
		}
		t.Errorf("unexpected path %s", r.URL.Path)
		w.WriteHeader(404)
	})
	mux, flush := ctxTestAPI(t, dir, client)
	const path = "10/416/732.png?cache=4"
	responses := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() { responses <- ctxTestRequest(mux, path) }()
	}
	for range 2 {
		response := <-responses
		if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" {
			t.Fatalf("rebuild status %d", response.Code)
		}
		img, err := decodeTileImage(response.Body.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		for quadrant, want := range colors {
			x, y := 128+(quadrant%2)*256, 128+(quadrant/2)*256
			if got := color.RGBAModel.Convert(img.At(x, y)); got != want {
				t.Errorf("quadrant %d = %v, want %v", quadrant, got, want)
			}
		}
	}
	if response := ctxTestRequest(mux, "11/833/1465.png"); response.Code != 200 || !bytes.Equal(response.Body.Bytes(), children[3]) {
		t.Fatal("child not available on zoom")
	}
	flush()
	restarted, _ := ctxTestAPI(t, dir, client)
	if response := ctxTestRequest(restarted, path); response.Code != 200 {
		t.Fatal("rebuilt parent not reused from disk")
	}
	if calls.Load() != 4 {
		t.Fatalf("upstream calls = %d, want 4", calls.Load())
	}
	if _, err := os.Stat(filepath.Join(dir, "10-rebuilt-1-416-732.png")); err != nil {
		t.Fatal(err)
	}
}

func TestCTXCorruptChildAndBackupLevel10(t *testing.T) {
	dir := t.TempDir()
	data := ctxTestSolid(t, color.Black, "png")
	client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if strings.Contains(r.URL.Path, "/CTX1/") && strings.HasSuffix(r.URL.Path, "/833/1465") {
			_, _ = w.Write(data[:len(data)-40])
			return
		}
		if strings.Contains(r.URL.Path, "/CTX/") && !strings.HasSuffix(r.URL.Path, "/10/416/732") {
			t.Errorf("backup level 10 unexpectedly rebuilt: %s", r.URL.Path)
		}
		_, _ = w.Write(data)
	})
	mux, flush := ctxTestAPI(t, dir, client)
	if response := ctxTestRequest(mux, "10/416/732.png"); response.Code != 502 {
		t.Fatal("accepted corrupt child")
	}
	flush()
	want := []string{"11-832-1464.png", "11-832-1465.png", "11-833-1464.png"}
	if got := ctxTestFiles(t, dir); !reflect.DeepEqual(got, want) {
		t.Fatalf("cached files = %v, want %v", got, want)
	}
	if response := ctxTestRequest(mux, "10/416/732.png?source=beta01"); response.Code != 200 || !bytes.Equal(response.Body.Bytes(), data) {
		t.Fatal("backup level 10 should serve original bytes")
	}
}

func TestCTXDiskEviction(t *testing.T) {
	dir := t.TempDir()
	data := ctxTestSolid(t, color.Black, "png")
	client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
	})
	mux := http.NewServeMux()
	flush := registerCTX(mux, dir, client, 2, nil)
	t.Cleanup(flush)
	for x := range 3 {
		if response := ctxTestRequest(mux, fmt.Sprintf("1/0/%d.png", x)); response.Code != 200 {
			t.Fatalf("tile %d status %d", x, response.Code)
		}
	}
	flush()
	if got := ctxTestFiles(t, dir); !reflect.DeepEqual(got, []string{"1-0-1.png", "1-0-2.png"}) {
		t.Fatalf("files after eviction = %v", got)
	}
}

func TestCTXRepairsTruncatedIntermediateTile(t *testing.T) {
	for _, source := range []string{"v01", "beta01"} {
		t.Run(source, func(t *testing.T) {
			dir := t.TempDir()
			valid := ctxTestSolid(t, color.Gray{Y: 136}, "png")
			var calls atomic.Int32
			service := "CTX1"
			if source == "beta01" {
				service = "CTX"
			}
			client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "image/png")
				if !strings.Contains(r.URL.Path, "/"+service+"/") {
					t.Errorf("mixed imagery source: %s", r.URL.Path)
				}
				if strings.HasSuffix(r.URL.Path, "/11/812/2926") {
					_, _ = w.Write(valid[:len(valid)-40])
					return
				}
				if !strings.Contains(r.URL.Path, "/tile/12/") {
					t.Errorf("unexpected child: %s", r.URL.Path)
				}
				_, _ = w.Write(valid)
			})
			mux, flush := ctxTestAPI(t, dir, client)
			path := "11/812/2926.png?source=" + source
			response := ctxTestRequest(mux, path)
			if response.Code != 200 {
				t.Fatalf("repaired status = %d", response.Code)
			}
			if err := validateTileImage(response.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
			flush()
			restarted, _ := ctxTestAPI(t, dir, client)
			if hit := ctxTestRequest(restarted, path); hit.Code != 200 || !bytes.Equal(hit.Body.Bytes(), response.Body.Bytes()) {
				t.Fatal("repair was not reused from disk")
			}
			if hit := ctxTestRequest(restarted, "12/1625/5853.png?source="+source); hit.Code != 200 || !bytes.Equal(hit.Body.Bytes(), valid) {
				t.Fatal("repair did not warm its children")
			}
			if calls.Load() != 5 {
				t.Fatalf("calls = %d, want 5", calls.Load())
			}
		})
	}
}

func TestCTXDoesNotRepairBeyondNativeResolution(t *testing.T) {
	valid := ctxTestSolid(t, color.Black, "png")
	var calls atomic.Int32
	client := ctxTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(valid[:len(valid)-40])
	})
	mux, _ := ctxTestAPI(t, t.TempDir(), client)
	if response := ctxTestRequest(mux, "12/0/0.png"); response.Code != 502 {
		t.Fatal("accepted truncated native tile")
	}
	if calls.Load() != 1 {
		t.Fatal("requested tiles beyond native resolution")
	}
}
