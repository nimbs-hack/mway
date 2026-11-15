// Package env serves site conditions that aren't map tiles: the geologic
// unit at a point and rover weather station readings.
package env

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"

	"mars-console/api/internal/tiles"
)

const geologyPath = "/api/geology/unit"

// Trek's ArcGIS copy of USGS SIM 3292 (Tanaka et al. 2014). Coordinates are
// planetocentric latitude and east longitude, -180 to 180, on the Mars 2000
// sphere.
const geologyIdentify = "https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/identify"

// Unit is one SIM 3292 map unit, such as "AHi" with its description.
type Unit struct {
	Unit        string `json:"unit"`
	Description string `json:"description"`
	Source      string `json:"source"`
}

// Lookups are rounded to this many degrees. At 1:20M scale the map can't
// tell closer points apart, so nearby clicks share one upstream request.
const geologyGrid = 0.01

func parseCoordinate(raw string, limit float64) (float64, error) {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.Abs(value) > limit {
		return 0, fmt.Errorf("coordinate out of range")
	}
	return value, nil
}

func identifyURL(lat, lon float64) string {
	query := url.Values{}
	query.Set("geometry", fmt.Sprintf("%.4f,%.4f", lon, lat))
	query.Set("geometryType", "esriGeometryPoint")
	query.Set("sr", "4326")
	query.Set("layers", "all")
	query.Set("tolerance", "0")
	query.Set("mapExtent", fmt.Sprintf("%.4f,%.4f,%.4f,%.4f", lon-1, lat-1, lon+1, lat+1))
	query.Set("imageDisplay", "400,400,96")
	query.Set("returnGeometry", "false")
	query.Set("f", "json")
	return geologyIdentify + "?" + query.Encode()
}

// parseIdentify picks the first unit in an ArcGIS identify response.
func parseIdentify(data []byte) (*Unit, error) {
	var response struct {
		Results []struct {
			Attributes map[string]any `json:"attributes"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, err
	}
	for _, result := range response.Results {
		unit, _ := result.Attributes["Unit"].(string)
		description, _ := result.Attributes["UnitDesc"].(string)
		if unit != "" {
			return &Unit{Unit: unit, Description: description, Source: "USGS SIM 3292, Tanaka et al. 2014"}, nil
		}
	}
	return nil, nil
}

// RegisterGeology answers GET /api/geology/unit?lat=..&lon=.. with the map
// unit under the point, or 404 where the map has none.
func RegisterGeology(mux *http.ServeMux, client *http.Client) {
	if client == nil {
		client = http.DefaultClient
	}
	var mu sync.Mutex
	cache := map[string]*Unit{}
	mux.HandleFunc("GET "+geologyPath, func(w http.ResponseWriter, r *http.Request) {
		lat, latErr := parseCoordinate(r.URL.Query().Get("lat"), 90)
		lon, lonErr := parseCoordinate(r.URL.Query().Get("lon"), 180)
		if latErr != nil || lonErr != nil {
			http.Error(w, "lat must be -90 to 90 and lon -180 to 180", http.StatusBadRequest)
			return
		}
		lat = math.Round(lat/geologyGrid) * geologyGrid
		lon = math.Round(lon/geologyGrid) * geologyGrid
		key := fmt.Sprintf("%.2f,%.2f", lat, lon)

		mu.Lock()
		unit, cached := cache[key]
		mu.Unlock()
		if !cached {
			data, _, err := tiles.Fetch(r.Context(), client, identifyURL(lat, lon), 256*1024)
			if err == nil {
				unit, err = parseIdentify(data)
			}
			if err != nil {
				log.Printf("Geology lookup failed at %s: %v", key, err)
				http.Error(w, "Geology lookup unavailable", http.StatusBadGateway)
				return
			}
			mu.Lock()
			// A plain map is enough. Clear it rather than grow without bound.
			if len(cache) > 4096 {
				cache = map[string]*Unit{}
			}
			cache[key] = unit
			mu.Unlock()
		}
		if unit == nil {
			http.Error(w, "No mapped unit here", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_ = json.NewEncoder(w).Encode(unit)
	})
}
