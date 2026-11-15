package tiles

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
)

const (
	CTXPath           = "/api/imagery/ctx-v01"
	ctxUpstream       = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile"
	ctxBackupUpstream = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile"
	ctxMaxLevel       = 12
	ctxMaxTileBytes   = 1024 * 1024
	ctxMemoryBytes    = 32 * 1024 * 1024
)

// RegisterCTX serves fixed CTX sources and returns a function that drains both
// caches. Source selection is explicit so neighboring tiles never mix mosaics.
// With a ReadAhead it also fetches the tiles around each one served.
func RegisterCTX(mux *http.ServeMux, cacheDir string, client *http.Client, ahead ...*ReadAhead) func() {
	// Reading ahead brings in about eight tiles for each one viewed, so the
	// disk keeps more of them.
	if len(ahead) > 0 {
		return registerCTX(mux, cacheDir, client, 8192, ahead[0])
	}
	return registerCTX(mux, cacheDir, client, 2048, nil)
}

func registerCTX(mux *http.ServeMux, cacheDir string, client *http.Client, maxTiles int, ahead *ReadAhead) func() {
	if client == nil {
		client = http.DefaultClient
	}
	cache := NewCache(cacheDir, maxTiles, ctxMemoryBytes, validateTileImage)
	backup := NewCache(filepath.Join(cacheDir, "beta01"), 512, ctxMemoryBytes, validateTileImage)

	var load func(context.Context, int, int, int, string, bool) ([]byte, error)
	rebuild := func(ctx context.Context, z, y, x int, source string) ([]byte, error) {
		var children [4][]byte
		var errs [4]error
		var pending sync.WaitGroup
		for quadrant := range children {
			pending.Add(1)
			go func() {
				defer pending.Done()
				// Do not recursively repair corrupt children. A failed request must
				// not expand into downloads of the entire imagery pyramid.
				children[quadrant], errs[quadrant] = load(ctx, z+1, y*2+quadrant/2, x*2+quadrant%2, source, false)
			}()
		}
		pending.Wait()
		for _, err := range errs {
			if err != nil {
				return nil, err
			}
		}
		return rebuildCTXImage(children)
	}
	load = func(ctx context.Context, z, y, x int, source string, repair bool) ([]byte, error) {
		if source == "v01" && z == 10 {
			// Old level-10 tiles can decode but show the wrong location.
			key := fmt.Sprintf("10-rebuilt-1-%d-%d.png", y, x)
			return cache.Get(ctx, key, func(ctx context.Context) ([]byte, error) {
				return rebuild(ctx, z, y, x, source)
			})
		}
		target, upstream := cache, ctxUpstream
		if source == "beta01" {
			target, upstream = backup, ctxBackupUpstream
		}
		key := fmt.Sprintf("%d-%d-%d.png", z, y, x)
		return target.Get(ctx, key, func(ctx context.Context) ([]byte, error) {
			url := fmt.Sprintf("%s/%d/%d/%d", upstream, z, y, x)
			data, headers, err := Fetch(ctx, client, url, ctxMaxTileBytes)
			if err != nil {
				return nil, err
			}
			mime, _, _ := strings.Cut(headers.Get("Content-Type"), ";")
			if mime != "image/png" && mime != "image/jpeg" {
				return nil, fmt.Errorf("CTX upstream returned %q", mime)
			}
			if err := validateTileImage(data); err != nil {
				if !repair || z >= ctxMaxLevel {
					return nil, err
				}
				// Some intermediate PNGs are truncated even though their finer
				// tiles are complete. Rebuild from the same source at this scale.
				return rebuild(ctx, z, y, x, source)
			}
			return data, nil
		})
	}

	mux.HandleFunc("GET "+CTXPath+"/{z}/{y}/{file}", func(w http.ResponseWriter, r *http.Request) {
		source := "v01"
		if values, exists := r.URL.Query()["source"]; exists {
			source = values[0]
		}
		z, zErr := ParseCoordinate(r.PathValue("z"), ctxMaxLevel)
		// Keep shifts bounded even when an invalid level is supplied.
		if zErr != nil {
			ctxText(w, http.StatusBadRequest, "Invalid CTX tile coordinates")
			return
		}
		file := r.PathValue("file")
		y, yErr := ParseCoordinate(r.PathValue("y"), (1<<z)-1)
		x, xErr := ParseCoordinate(strings.TrimSuffix(file, ".png"), (1<<(z+1))-1)
		if yErr != nil || xErr != nil || !strings.HasSuffix(file, ".png") || source != "v01" && source != "beta01" {
			ctxText(w, http.StatusBadRequest, "Invalid CTX tile coordinates")
			return
		}
		data, err := load(r.Context(), z, y, x, source, true)
		mime := tileImageType(data)
		if err != nil || mime == "" {
			if err == nil {
				err = fmt.Errorf("invalid cached CTX image")
			}
			log.Printf("CTX tile unavailable source=%s z=%d y=%d x=%d: %v", source, z, y, x, err)
			w.Header().Set("Cache-Control", "no-store")
			ctxText(w, http.StatusBadGateway, "CTX tile unavailable")
			return
		}
		for _, next := range around(tile{z, x, y}, ctxMaxLevel-1) {
			ahead.offer(fmt.Sprintf("ctx/%s/%d/%d/%d", source, next.z, next.row, next.col), func(ctx context.Context) {
				_, _ = load(ctx, next.z, next.row, next.col, source, true)
			})
		}
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Cache-Control", "public, max-age=2592000")
		label := "CTX V01"
		if source == "beta01" {
			label = "CTX beta01 fallback"
		}
		w.Header().Set("X-Imagery-Source", label)
		_, _ = w.Write(data)
	})
	return func() {
		cache.Flush()
		backup.Flush()
	}
}

func ctxText(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(message))
}
