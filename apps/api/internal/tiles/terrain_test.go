package tiles

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type terrainRoundTripper func(*http.Request) (*http.Response, error)

func (f terrainRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func terrainTestClient(fetch func(*http.Request) (*http.Response, error)) *http.Client {
	return &http.Client{Transport: terrainRoundTripper(fetch)}
}

func terrainTestResponse(data []byte, contentType string, status int) *http.Response {
	headers := make(http.Header)
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	return &http.Response{
		StatusCode: status, Header: headers,
		Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data)),
	}
}

func terrainTestMesh() []byte {
	data := make([]byte, 128)
	binary.LittleEndian.PutUint32(data[24:28], math.Float32bits(4000))
	binary.LittleEndian.PutUint32(data[28:32], math.Float32bits(5000))
	binary.LittleEndian.PutUint32(data[88:92], 3)
	// Include arbitrary payload bytes to catch accidental re-encoding.
	copy(data[96:], []byte{0xff, 0x00, 0x80, 0x7f, 0x31, 0x72})
	return data
}

func terrainTestRequest(handler http.Handler, path string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, TerrainPath+path, nil))
	return recorder
}

func TestTerrainMetadataPreservesFields(t *testing.T) {
	metadata := []byte(`{"format":"quantized-mesh-1.0","version":"2.0","scheme":"tms","projection":"EPSG:4326","tiles":["https://example.test/{z}/{x}/{y}.terrain"],"available":[[{"startX":0,"endX":1,"startY":0,"endY":0}],[{"startX":2,"endX":3,"startY":1,"endY":1}]],"extensions":["octvertexnormals"],"attribution":"NASA","custom":{"id":9007199254740993}}`)
	var calls atomic.Int32
	client := terrainTestClient(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.String() != terrainUpstream+"/layer.json" {
			t.Errorf("upstream URL = %s", r.URL)
		}
		return terrainTestResponse(metadata, "application/json", http.StatusOK), nil
	})
	dir := t.TempDir()
	mux := http.NewServeMux()
	flush := RegisterTerrain(mux, dir, client)
	t.Cleanup(flush)
	response := terrainTestRequest(mux, "/layer.json")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	if response.Header().Get("Content-Type") != "application/json" || response.Header().Get("Cache-Control") != terrainCacheControl {
		t.Fatalf("headers = %v", response.Header())
	}
	var got, want map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(metadata, &want); err != nil {
		t.Fatal(err)
	}
	want["tiles"] = json.RawMessage(`["{z}/{x}/{y}.terrain?v=2.0"]`)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("metadata = %s, want fields %v", response.Body, want)
	}
	flush()
	restarted := http.NewServeMux()
	t.Cleanup(RegisterTerrain(restarted, dir, client))
	if cached := terrainTestRequest(restarted, "/layer.json"); cached.Code != http.StatusOK || !bytes.Equal(cached.Body.Bytes(), response.Body.Bytes()) {
		t.Fatalf("restarted metadata = %d %s", cached.Code, cached.Body)
	}
	if calls.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", calls.Load())
	}
}

func TestTerrainCoalescesRequestsAndReusesDiskCache(t *testing.T) {
	mesh := terrainTestMesh()
	metadata := []byte(`{"format":"quantized-mesh-1.0","version":"2.0","available":[]}`)
	for _, test := range []struct {
		name, path, upstreamPath, key, contentType string
		data                                       []byte
	}{
		{"mesh", "/9/902/242.terrain?v=ignored", "/9/902/242.terrain?v=2.0", "9-902-242.terrain", "application/octet-stream", mesh},
		{"metadata", "/layer.json", "/layer.json", "layer.json", "application/json", metadata},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			release := make(chan struct{})
			client := terrainTestClient(func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				if r.URL.String() != terrainUpstream+test.upstreamPath || r.Method != http.MethodGet {
					t.Errorf("upstream request = %s %s", r.Method, r.URL)
				}
				if _, ok := r.Context().Deadline(); !ok {
					t.Error("upstream request has no timeout")
				}
				select {
				case <-release:
				case <-r.Context().Done():
					return nil, r.Context().Err()
				}
				return terrainTestResponse(test.data, test.contentType, http.StatusOK), nil
			})
			dir := t.TempDir()
			mux := http.NewServeMux()
			flush := RegisterTerrain(mux, dir, client)
			t.Cleanup(flush)
			const requests = 16
			entered := make(chan struct{}, requests)
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				entered <- struct{}{}
				mux.ServeHTTP(w, r)
			})
			responses := make([]*httptest.ResponseRecorder, requests)
			var wg sync.WaitGroup
			for i := range responses {
				wg.Add(1)
				go func() {
					defer wg.Done()
					responses[i] = terrainTestRequest(handler, test.path)
				}()
			}
			for range requests {
				<-entered
			}
			close(release)
			wg.Wait()
			for _, response := range responses {
				if response.Code != http.StatusOK || response.Header().Get("Content-Type") != test.contentType || response.Header().Get("Cache-Control") != terrainCacheControl {
					t.Fatalf("response = %d %v %s", response.Code, response.Header(), response.Body)
				}
				if !bytes.Equal(response.Body.Bytes(), responses[0].Body.Bytes()) {
					t.Fatal("concurrent responses differ")
				}
				if test.name == "mesh" && !bytes.Equal(response.Body.Bytes(), mesh) {
					t.Fatal("mesh bytes changed")
				}
			}
			flush()
			disk, err := os.ReadFile(filepath.Join(dir, test.key))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(disk, responses[0].Body.Bytes()) {
				t.Fatal("disk bytes differ from response")
			}
			restarted := http.NewServeMux()
			t.Cleanup(RegisterTerrain(restarted, dir, client))
			response := terrainTestRequest(restarted, test.path)
			if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), disk) {
				t.Fatalf("restarted response = %d %s", response.Code, response.Body)
			}
			if calls.Load() != 1 {
				t.Fatalf("upstream calls = %d, want 1", calls.Load())
			}
		})
	}
}

func TestTerrainRejectsInvalidCoordinates(t *testing.T) {
	var calls atomic.Int32
	client := terrainTestClient(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("unexpected upstream request")
	})
	mux := http.NewServeMux()
	t.Cleanup(RegisterTerrain(mux, t.TempDir(), client))
	for _, path := range []string{
		"/19/0/0.terrain", "/0/2/0.terrain", "/0/0/1.terrain",
		"/18/524288/0.terrain", "/18/0/262144.terrain",
		"/-1/0/0.terrain", "/0/-1/0.terrain", "/0/0/-1.terrain",
		"/01/0/0.terrain", "/0/01/0.terrain", "/0/0/01.terrain",
		"/+1/0/0.terrain", "/0/+1/0.terrain", "/0/0/+0.terrain",
		"/1e1/0/0.terrain", "/0/1.0/0.terrain", "/0/0/0.0.terrain",
		"/99999999999999999999999999/0/0.terrain", "/0/99999999999999999999999999/0.terrain",
		"/0/0/99999999999999999999999999.terrain", "/0/0/0.TERRAIN",
		"/0/0/.terrain", "/0/0/0", "/0/0/0.terrain.extra", "/0/0/0.terrain.terrain",
	} {
		t.Run(path, func(t *testing.T) {
			response := terrainTestRequest(mux, path)
			if response.Code != http.StatusBadRequest || response.Body.String() != "Invalid terrain tile coordinates" {
				t.Fatalf("response = %d %s", response.Code, response.Body)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatalf("upstream calls = %d, want 0", calls.Load())
	}
}

func TestTerrainCoordinateBoundariesAndMissingContentType(t *testing.T) {
	for _, path := range []string{"/0/0/0.terrain", "/0/1/0.terrain", "/18/524287/262143.terrain"} {
		t.Run(path, func(t *testing.T) {
			client := terrainTestClient(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != terrainUpstream+path+"?v=2.0" {
					t.Errorf("upstream URL = %s", r.URL)
				}
				return terrainTestResponse(terrainTestMesh(), "", http.StatusOK), nil
			})
			mux := http.NewServeMux()
			t.Cleanup(RegisterTerrain(mux, t.TempDir(), client))
			if response := terrainTestRequest(mux, path); response.Code != http.StatusOK {
				t.Fatalf("response = %d %s", response.Code, response.Body)
			}
		})
	}
}

func TestTerrainRejectsInvalidMetadata(t *testing.T) {
	for name, body := range map[string]string{
		"invalid JSON":      `{"format":`,
		"null":              `null`,
		"array":             `[]`,
		"missing fields":    `{}`,
		"wrong format":      `{"format":"heightmap-1.0","version":"2.0","available":[]}`,
		"wrong version":     `{"format":"quantized-mesh-1.0","version":"1.0","available":[]}`,
		"numeric version":   `{"format":"quantized-mesh-1.0","version":2,"available":[]}`,
		"missing version":   `{"format":"quantized-mesh-1.0","available":[]}`,
		"null available":    `{"format":"quantized-mesh-1.0","version":"2.0","available":null}`,
		"object available":  `{"format":"quantized-mesh-1.0","version":"2.0","available":{}}`,
		"missing available": `{"format":"quantized-mesh-1.0","version":"2.0"}`,
		"oversized":         `{"format":"quantized-mesh-1.0","version":"2.0","available":[],"extra":"` + strings.Repeat("x", terrainMetadataMaxBytes) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			assertTerrainFailure(t, "/layer.json", "Terrain metadata unavailable", func(*http.Request) (*http.Response, error) {
				return terrainTestResponse([]byte(body), "application/json", http.StatusOK), nil
			})
		})
	}
}

func TestTerrainRejectsMalformedMeshes(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func([]byte) []byte
	}{
		{"too short", func(b []byte) []byte { return b[:95] }},
		{"too large", func(b []byte) []byte { return append(b, make([]byte, terrainMaxBytes+1-len(b))...) }},
		{"zero vertices", func(b []byte) []byte { binary.LittleEndian.PutUint32(b[88:92], 0); return b }},
		{"truncated vertices", func(b []byte) []byte { binary.LittleEndian.PutUint32(b[88:92], 6); return b }},
		{"vertex count overflow", func(b []byte) []byte { binary.LittleEndian.PutUint32(b[88:92], math.MaxUint32); return b }},
		{"NaN minimum", func(b []byte) []byte {
			binary.LittleEndian.PutUint32(b[24:28], math.Float32bits(float32(math.NaN())))
			return b
		}},
		{"infinite minimum", func(b []byte) []byte {
			binary.LittleEndian.PutUint32(b[24:28], math.Float32bits(float32(math.Inf(-1))))
			return b
		}},
		{"NaN maximum", func(b []byte) []byte {
			binary.LittleEndian.PutUint32(b[28:32], math.Float32bits(float32(math.NaN())))
			return b
		}},
		{"infinite maximum", func(b []byte) []byte {
			binary.LittleEndian.PutUint32(b[28:32], math.Float32bits(float32(math.Inf(1))))
			return b
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			data := test.mutate(terrainTestMesh())
			assertTerrainFailure(t, "/0/0/0.terrain", "Terrain tile unavailable", func(*http.Request) (*http.Response, error) {
				return terrainTestResponse(data, "application/octet-stream", http.StatusOK), nil
			})
		})
	}
}

func TestTerrainRejectsTextContentType(t *testing.T) {
	for _, contentType := range []string{"text/html", "text/plain; charset=utf-8", "Text/HTML"} {
		t.Run(contentType, func(t *testing.T) {
			assertTerrainFailure(t, "/0/0/0.terrain", "Terrain tile unavailable", func(*http.Request) (*http.Response, error) {
				return terrainTestResponse(terrainTestMesh(), contentType, http.StatusOK), nil
			})
		})
	}
}

func TestTerrainUpstreamFailures(t *testing.T) {
	for _, path := range []string{"/layer.json", "/0/0/0.terrain"} {
		t.Run(path, func(t *testing.T) {
			message := "Terrain tile unavailable"
			if path == "/layer.json" {
				message = "Terrain metadata unavailable"
			}
			t.Run("status", func(t *testing.T) {
				assertTerrainFailure(t, path, message, func(*http.Request) (*http.Response, error) {
					return terrainTestResponse(terrainTestMesh(), "application/octet-stream", http.StatusServiceUnavailable), nil
				})
			})
			t.Run("transport", func(t *testing.T) {
				assertTerrainFailure(t, path, message, func(*http.Request) (*http.Response, error) {
					return nil, errors.New("upstream connection failed")
				})
			})
		})
	}
}

// A rejected download must be retried and must never become a disk cache entry.
func assertTerrainFailure(t *testing.T, path, message string, fetch func(*http.Request) (*http.Response, error)) {
	t.Helper()
	var calls atomic.Int32
	client := terrainTestClient(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return fetch(r)
	})
	dir := t.TempDir()
	mux := http.NewServeMux()
	flush := RegisterTerrain(mux, dir, client)
	t.Cleanup(flush)
	for range 2 {
		response := terrainTestRequest(mux, path)
		if response.Code != http.StatusBadGateway || response.Header().Get("Cache-Control") != "no-store" || response.Body.String() != message {
			t.Fatalf("response = %d %v %s", response.Code, response.Header(), response.Body)
		}
	}
	flush()
	if calls.Load() != 2 {
		t.Fatalf("upstream calls = %d, want 2", calls.Load())
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("failed download left cache files: %v", entries)
	}
}
