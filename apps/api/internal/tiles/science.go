package tiles

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"log"
	"mime"
	"net/http"
	"strings"
)

const sciencePath = "/api/science"

type scienceSource struct {
	layer     string
	extension string
	maxLevel  int
	tileSize  int
	// template overrides the Trek tile path. It takes z, y and x, in that order.
	template string
}

// url is the upstream tile for one grid cell.
func (s scienceSource) url(z, y, x int) string {
	if s.template != "" {
		return fmt.Sprintf(s.template, z, y, x)
	}
	return fmt.Sprintf("https://trek.nasa.gov/tiles/Mars/EQ/%s/1.0.0/default/default028mm/%d/%d/%d.%s", s.layer, z, y, x, s.extension)
}

// Verified Mars Trek EQ products. Keep this allowlist in sync with
// src/data/science-rasters.json and data/SOURCES.md.
var scienceSources = map[string]scienceSource{
	"themis-day":     {"THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png", 9, 256, ""},
	"themis-night":   {"THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", "png", 9, 256, ""},
	"mola-color":     {"Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 7, 256, ""},
	"tes-albedo":     {"Mars_MGS_TES_Albedo_mosaic_global_7410m", "png", 1, 256, ""},
	"mola-roughness": {"mola_roughness", "png", 1, 256, ""},
	// USGS SIM 3292 global geologic map (Tanaka et al. 2014), served by Trek's
	// ArcGIS WMTS rather than the static tile tree.
	"geology": {"SIM3292_Global_Geology", "png", 11, 256,
		"https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/%d/%d/%d.png"},
}

func validateSciencePNG(data []byte) error {
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != 256 || config.Height != 256 {
		return fmt.Errorf("invalid science PNG dimensions or format")
	}
	_, err = png.Decode(bytes.NewReader(data))
	return err
}

// RegisterScience serves a north-origin geographic grid, 2^(z+1) columns by
// 2^z rows. Cached bytes are PNG, including the JPEG MOLA color source.
// Flush must run after the server stops accepting requests.
func RegisterScience(mux *http.ServeMux, cacheDir string, client *http.Client) func() {
	return registerTrekTiles(mux, sciencePath, scienceSources, cacheDir, client)
}

// registerTrekTiles serves an allowlist of Trek EQ layers under path, with a
// disk cache. Science layers and the HiRISE mosaics share it.
func registerTrekTiles(mux *http.ServeMux, path string, sources map[string]scienceSource, cacheDir string, client *http.Client) func() {
	if client == nil {
		client = http.DefaultClient
	}
	// These endpoints have no redirects. Do not let an upstream redirect expand
	// the allowlist or mutate the client shared with the other tile handlers.
	fixedClient := *client
	fixedClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return fmt.Errorf("science upstream redirect refused")
	}
	cache := NewCache(cacheDir, 2048, 32*1024*1024, validateSciencePNG)
	mux.HandleFunc("GET "+path+"/{id}/{z}/{y}/{file}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		id := r.PathValue("id")
		source, ok := sources[id]
		if !ok {
			http.Error(w, "Unknown science layer", http.StatusNotFound)
			return
		}
		z, err := ParseCoordinate(r.PathValue("z"), source.maxLevel)
		if err != nil {
			http.Error(w, "Invalid science tile coordinates", http.StatusBadRequest)
			return
		}
		file := r.PathValue("file")
		y, yErr := ParseCoordinate(r.PathValue("y"), (1<<z)-1)
		x, xErr := ParseCoordinate(strings.TrimSuffix(file, ".png"), (1<<(z+1))-1)
		if yErr != nil || xErr != nil || !strings.HasSuffix(file, ".png") {
			http.Error(w, "Invalid science tile coordinates", http.StatusBadRequest)
			return
		}
		key := fmt.Sprintf("%s-%d-%d-%d.png", id, z, y, x)
		data, err := cache.Get(r.Context(), key, func(ctx context.Context) ([]byte, error) {
			url := source.url(z, y, x)
			data, headers, err := Fetch(ctx, &fixedClient, url, 2*1024*1024)
			if err != nil {
				return nil, err
			}
			contentType, _, err := mime.ParseMediaType(headers.Get("Content-Type"))
			expectedType, expectedFormat := "image/png", "png"
			if source.extension == "jpg" {
				expectedType, expectedFormat = "image/jpeg", "jpeg"
			}
			if err != nil || contentType != expectedType {
				return nil, fmt.Errorf("science upstream returned unexpected content type %q", contentType)
			}
			config, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || format != expectedFormat || config.Width != source.tileSize || config.Height != source.tileSize {
				return nil, fmt.Errorf("invalid science tile format or dimensions")
			}
			if format == "png" {
				// Cache validates the full PNG before storing it, preserving alpha.
				return data, nil
			}
			img, _, err := image.Decode(bytes.NewReader(data))
			if err != nil {
				return nil, err
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, img); err != nil {
				return nil, err
			}
			return encoded.Bytes(), nil
		})
		if err != nil {
			log.Printf("Science tile unavailable id=%s z=%d y=%d x=%d: %v", id, z, y, x, err)
			http.Error(w, "Science tile unavailable; coverage may be missing", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=2592000")
		w.Header().Set("X-Science-Source", id)
		_, _ = w.Write(data)
	})
	return cache.Flush
}
