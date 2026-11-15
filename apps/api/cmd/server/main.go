package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"mars-console/api/internal/env"
	"mars-console/api/internal/planner"
	"mars-console/api/internal/tiles"
)

func handler(cacheDir, staticDir string, client *http.Client) (http.Handler, func()) {
	mux := http.NewServeMux()
	// Four downloads at a time, the same order of load a browser puts on the
	// upstream servers by itself.
	ahead := tiles.NewReadAhead(4, 512)
	flushCTX := tiles.RegisterCTX(mux, filepath.Join(cacheDir, "ctx-v01"), client, ahead)
	flushViking := tiles.RegisterViking(mux, filepath.Join(cacheDir, "viking-v1"), client, ahead)
	flushTerrain := tiles.RegisterTerrain(mux, filepath.Join(cacheDir, "mars-v14-v2"), client, ahead)
	flushScience := tiles.RegisterScience(mux, filepath.Join(cacheDir, "science-v1"), client)
	flushHiRISE := tiles.RegisterHiRISE(mux, filepath.Join(cacheDir, "hirise-v1"), client)
	env.RegisterGeology(mux, client)
	env.RegisterWeather(mux, client)
	env.RegisterSpaceWeather(mux, client)
	planner.Register(mux)
	// An unknown API route must not return the SPA's HTML.
	mux.HandleFunc("/api/", http.NotFound)
	mux.HandleFunc("/api", http.NotFound)
	files := http.FileServer(http.Dir(staticDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := filepath.Join(staticDir, filepath.FromSlash(strings.TrimPrefix(r.URL.Path, "/")))
		if info, err := os.Stat(name); err == nil && !info.IsDir() {
			// Vite fingerprints everything under assets. Entry points and the
			// service worker must revalidate so deployments take effect.
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			if compressed, err := os.Stat(name + ".gz"); err == nil && !compressed.IsDir() {
				w.Header().Set("Vary", "Accept-Encoding")
				if acceptsGzip(r.Header.Get("Accept-Encoding")) {
					w.Header().Set("Content-Encoding", "gzip")
					w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(name)))
					r = r.Clone(r.Context())
					r.URL.Path += ".gz"
				}
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
	return mux, func() {
		ahead.Close()
		flushViking()
		flushCTX()
		flushTerrain()
		flushScience()
		flushHiRISE()
	}
}

func run() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	addr := flag.String("addr", ":"+port, "HTTP listen address")
	cacheDir := flag.String("cache-dir", "data/cache", "Tile cache directory")
	staticDir := flag.String("static-dir", "dist", "Built frontend directory")
	flag.Parse()
	app, flush := handler(*cacheDir, *staticDir, tiles.NewClient())
	defer flush()
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: app, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	// The development launcher reads the actual address when listening on port 0.
	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"address": listener.Addr().String()}); err != nil {
		_ = server.Close()
		return err
	}
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return fmt.Errorf("shutdown: %w", err)
		}
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
