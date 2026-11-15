package tiles

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"log"
	"mime"
	"net/http"
	"strings"
)

const (
	VikingPath     = "/api/imagery/viking"
	vikingUpstream = "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm"
	vikingMaxLevel = 7
	vikingTileSize = 256
	// The app ships levels 0 to 3 and asks for these from level 4.
	vikingReadAheadFrom = 4
	vikingMaxTileBytes  = 512 * 1024
	vikingMemoryBytes   = 16 * 1024 * 1024
)

func validateVikingJPEG(data []byte) error {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != "jpeg" || config.Width != vikingTileSize || config.Height != vikingTileSize {
		return fmt.Errorf("invalid Viking tile format or dimensions")
	}
	_, err = jpeg.Decode(bytes.NewReader(data))
	return err
}

// RegisterViking serves the Viking MDIM 2.1 color basemap from Mars Trek
// with a disk cache. Trek takes one to two seconds a tile, so a tile seen
// once comes from disk afterwards, and with a ReadAhead the tiles around
// each one served are fetched before the viewer asks.
func RegisterViking(mux *http.ServeMux, cacheDir string, client *http.Client, ahead ...*ReadAhead) func() {
	if client == nil {
		client = http.DefaultClient
	}
	fixedClient := *client
	fixedClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return fmt.Errorf("viking upstream redirect refused")
	}
	var readAhead *ReadAhead
	if len(ahead) > 0 {
		readAhead = ahead[0]
	}
	// Levels 4 to 7 hold under 44,000 tiles of about 45 KB each.
	cache := NewCache(cacheDir, 16384, vikingMemoryBytes, validateVikingJPEG)
	load := func(ctx context.Context, z, y, x int) ([]byte, error) {
		return cache.Get(ctx, fmt.Sprintf("%d-%d-%d.jpg", z, y, x), func(ctx context.Context) ([]byte, error) {
			data, headers, err := Fetch(ctx, &fixedClient, fmt.Sprintf("%s/%d/%d/%d.jpg", vikingUpstream, z, y, x), vikingMaxTileBytes)
			if err != nil {
				return nil, err
			}
			if contentType, _, _ := mime.ParseMediaType(headers.Get("Content-Type")); contentType != "image/jpeg" {
				return nil, fmt.Errorf("viking upstream returned %q", contentType)
			}
			return data, nil
		})
	}
	mux.HandleFunc("GET "+VikingPath+"/{z}/{y}/{file}", func(w http.ResponseWriter, r *http.Request) {
		z, zErr := ParseCoordinate(r.PathValue("z"), vikingMaxLevel)
		if zErr != nil {
			ctxText(w, http.StatusBadRequest, "Invalid Viking tile coordinates")
			return
		}
		file := r.PathValue("file")
		y, yErr := ParseCoordinate(r.PathValue("y"), (1<<z)-1)
		x, xErr := ParseCoordinate(strings.TrimSuffix(file, ".jpg"), (1<<(z+1))-1)
		if yErr != nil || xErr != nil || !strings.HasSuffix(file, ".jpg") {
			ctxText(w, http.StatusBadRequest, "Invalid Viking tile coordinates")
			return
		}
		data, err := load(r.Context(), z, y, x)
		if err != nil {
			log.Printf("Viking tile unavailable z=%d y=%d x=%d: %v", z, y, x, err)
			w.Header().Set("Cache-Control", "no-store")
			ctxText(w, http.StatusBadGateway, "Viking tile unavailable")
			return
		}
		for _, next := range aroundFrom(tile{z, x, y}, vikingReadAheadFrom, vikingMaxLevel) {
			readAhead.offer(fmt.Sprintf("viking/%d/%d/%d", next.z, next.row, next.col), func(ctx context.Context) {
				_, _ = load(ctx, next.z, next.row, next.col)
			})
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=2592000")
		_, _ = w.Write(data)
	})
	return cache.Flush
}
