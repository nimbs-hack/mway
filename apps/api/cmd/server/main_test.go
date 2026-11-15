package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticAndAPIRouting(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{"index.html": "<html>Mars</html>", "app.js": "const mars = true"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	app, flush := handler(t.TempDir(), dir, http.DefaultClient)
	defer flush()
	for _, test := range []struct {
		method, path string
		status       int
		body         string
	}{
		{"GET", "/", 200, "<html>Mars</html>"},
		{"GET", "/landing/curiosity", 200, "<html>Mars</html>"},
		{"GET", "/app.js", 200, "const mars = true"},
		{"HEAD", "/app.js", 200, ""},
		{"GET", "/api/unknown", 404, "404 page not found\n"},
		{"GET", "/api", 404, "404 page not found\n"},
		{"POST", "/api/unknown", 404, "404 page not found\n"},
		{"GET", "/api/imagery/ctx-v01/13/0/0.png", 400, ""},
		{"GET", "/api/terrain/mars-v14/19/0/0.terrain", 400, ""},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			res := httptest.NewRecorder()
			app.ServeHTTP(res, httptest.NewRequest(test.method, test.path, nil))
			if res.Code != test.status {
				t.Fatalf("status = %d, want %d", res.Code, test.status)
			}
			if test.body != "" && res.Body.String() != test.body {
				t.Fatalf("body = %q, want %q", res.Body.String(), test.body)
			}
		})
	}
}

func TestCompressedAssets(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	body := []byte("const mars = 'unchanged';")
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{
		"assets/app-hashed.js": body, "assets/app-hashed.js.gz": compressed.Bytes(),
		"index.html": []byte("Mars"), "map-cache.js": body,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	app, flush := handler(t.TempDir(), dir, http.DefaultClient)
	defer flush()
	for _, test := range []struct {
		accept string
		gzip   bool
	}{
		{"gzip, deflate, br", true}, {"GZip;q=0.8", true}, {"*;q=1", true},
		{"", false}, {"br", false}, {"gzip;q=0, *;q=1", false},
		{"*;q=1, gzip;q=0", false}, {"gzip;q=invalid", false},
	} {
		t.Run(test.accept, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/assets/app-hashed.js", nil)
			request.Header.Set("Accept-Encoding", test.accept)
			res := httptest.NewRecorder()
			app.ServeHTTP(res, request)
			if res.Code != 200 {
				t.Fatalf("status: %d", res.Code)
			}
			if (res.Header().Get("Content-Encoding") == "gzip") != test.gzip {
				t.Fatal("wrong encoding")
			}
			if res.Header().Get("Vary") != "Accept-Encoding" {
				t.Fatal("missing Vary")
			}
			if !strings.Contains(res.Header().Get("Cache-Control"), "immutable") {
				t.Fatal("asset not cached")
			}
			if !strings.Contains(res.Header().Get("Content-Type"), "javascript") {
				t.Fatal("wrong MIME type")
			}
			got := res.Body.Bytes()
			if test.gzip {
				reader, err := gzip.NewReader(bytes.NewReader(got))
				if err != nil {
					t.Fatal(err)
				}
				got, err = io.ReadAll(reader)
				if err != nil {
					t.Fatal(err)
				}
				reader.Close()
			}
			if !bytes.Equal(got, body) {
				t.Fatal("asset bytes changed")
			}
		})
	}
	for _, path := range []string{"/", "/map-cache.js"} {
		res := httptest.NewRecorder()
		app.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Header().Get("Cache-Control") != "no-cache" {
			t.Fatalf("%s must revalidate", path)
		}
	}
	request := httptest.NewRequest("HEAD", "/assets/app-hashed.js", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	res := httptest.NewRecorder()
	app.ServeHTTP(res, request)
	if res.Code != 200 || res.Body.Len() != 0 || res.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("compressed HEAD response is incorrect")
	}
}
