package tiles

import "net/http"

const hirisePath = "/api/imagery/hirise"

// HiRISE orthomosaics on Mars Trek's EQ grid, about 25 cm/px. maxLevel is the
// deepest tile matrix in each layer's WMTSCapabilities.xml. Keep in sync with
// HIRISE_LAYERS in src/data/imagery.js and data/SOURCES.md.
var hiriseSources = map[string]scienceSource{
	"gale":      {"curiosity_hirise_mosaic", "png", 16, 256, ""},
	"jezero":    {"JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png", 17, 256, ""},
	"gusev":     {"spirit_hirise_mosaic", "png", 17, 256, ""},
	"meridiani": {"opportunity_hirise_mosaic", "png", 17, 256, ""},
}

// RegisterHiRISE serves the HiRISE mosaics through the same cache as science
// tiles. Flush must run after the server stops accepting requests.
func RegisterHiRISE(mux *http.ServeMux, cacheDir string, client *http.Client) func() {
	return registerTrekTiles(mux, hirisePath, hiriseSources, cacheDir, client)
}
