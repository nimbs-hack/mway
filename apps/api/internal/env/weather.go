package env

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"mars-console/api/internal/tiles"
)

const weatherPath = "/api/weather"

// How long a fetched feed counts as fresh. The rovers report once a sol.
const weatherTTL = time.Hour

// How many sols of history go to the browser, newest last.
const historySols = 120

type station struct {
	Rover      string
	Instrument string
	Site       string
	Feed       string
	List       string // JSON key holding the per-sol records
}

// Public NASA weather feeds. They carry the rovers' own daily summaries
// and are meant for outreach, as the REMS disclaimer says.
var stations = map[string]station{
	"gale":   {"Curiosity", "REMS", "Gale crater", "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json", "soles"},
	"jezero": {"Perseverance", "MEDA", "Jezero crater", "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json", "sols"},
}

// Reading is one sol. Temperatures in kelvin and pressure in pascals.
// Missing channels are null.
type Reading struct {
	Sol        int      `json:"sol"`
	Date       string   `json:"date"`
	Ls         *float64 `json:"ls"`
	Season     string   `json:"season,omitempty"`
	AirMinK    *float64 `json:"airMinK"`
	AirMaxK    *float64 `json:"airMaxK"`
	GroundMinK *float64 `json:"groundMinK"`
	GroundMaxK *float64 `json:"groundMaxK"`
	PressurePa *float64 `json:"pressurePa"`
	Opacity    string   `json:"opacity,omitempty"`
	UV         string   `json:"uv,omitempty"`
	Sunrise    string   `json:"sunrise,omitempty"`
	Sunset     string   `json:"sunset,omitempty"`
}

// Report is what the browser gets for one station.
type Report struct {
	Station    string    `json:"station"`
	Rover      string    `json:"rover"`
	Instrument string    `json:"instrument"`
	Site       string    `json:"site"`
	SourceURL  string    `json:"sourceUrl"`
	FetchedAt  time.Time `json:"fetchedAt"`
	// Stale is true when the upstream failed and this is an older copy.
	Stale   bool      `json:"stale"`
	Latest  *Reading  `json:"latest"`
	History []Reading `json:"history"`
}

// number reads a feed value. The feeds mix numbers and strings and use
// "--" or "" for a missing channel.
func number(value any) *float64 {
	var n float64
	switch v := value.(type) {
	case float64:
		n = v
	case string:
		text := strings.TrimSpace(v)
		if text == "" || text == "--" || strings.EqualFold(text, "NA") {
			return nil
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return nil
		}
		n = parsed
	default:
		return nil
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	return &n
}

func kelvin(value any) *float64 {
	celsius := number(value)
	if celsius == nil {
		return nil
	}
	k := *celsius + 273.15
	return &k
}

func text(value any) string {
	s, _ := value.(string)
	s = strings.TrimSpace(s)
	if s == "--" {
		return ""
	}
	return s
}

func hasData(r Reading) bool {
	return r.AirMinK != nil || r.AirMaxK != nil || r.PressurePa != nil
}

// parseFeed turns a NASA weather feed into readings, oldest first, keeping
// only sols with a temperature or a pressure.
func parseFeed(data []byte, list string) ([]Reading, error) {
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}
	raw, ok := body[list]
	if !ok {
		return nil, fmt.Errorf("feed has no %q list", list)
	}
	var records []map[string]any
	if err := json.Unmarshal(raw, &records); err != nil {
		return nil, err
	}
	readings := make([]Reading, 0, len(records))
	for _, record := range records {
		sol := number(record["sol"])
		if sol == nil {
			continue
		}
		reading := Reading{
			Sol:        int(*sol),
			Date:       text(record["terrestrial_date"]),
			Ls:         number(record["ls"]),
			Season:     text(record["season"]),
			AirMinK:    kelvin(record["min_temp"]),
			AirMaxK:    kelvin(record["max_temp"]),
			GroundMinK: kelvin(record["min_gts_temp"]),
			GroundMaxK: kelvin(record["max_gts_temp"]),
			PressurePa: number(record["pressure"]),
			Opacity:    text(record["atmo_opacity"]),
			UV:         text(record["local_uv_irradiance_index"]),
			Sunrise:    text(record["sunrise"]),
			Sunset:     text(record["sunset"]),
		}
		if hasData(reading) {
			readings = append(readings, reading)
		}
	}
	sort.Slice(readings, func(i, j int) bool { return readings[i].Sol < readings[j].Sol })
	return readings, nil
}

func buildReport(id string, s station, readings []Reading, now time.Time) Report {
	report := Report{Station: id, Rover: s.Rover, Instrument: s.Instrument, Site: s.Site, SourceURL: s.Feed, FetchedAt: now, History: []Reading{}}
	if len(readings) == 0 {
		return report
	}
	latest := readings[len(readings)-1]
	report.Latest = &latest
	start := len(readings) - historySols
	if start < 0 {
		start = 0
	}
	report.History = readings[start:]
	return report
}

// RegisterWeather serves GET /api/weather/{station} for "gale" and "jezero".
// Feeds are cached for an hour. When the upstream fails, the last good copy
// is served with stale set.
func RegisterWeather(mux *http.ServeMux, client *http.Client) {
	if client == nil {
		client = http.DefaultClient
	}
	var mu sync.Mutex
	cache := map[string]Report{}
	mux.HandleFunc("GET "+weatherPath+"/{station}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("station")
		s, ok := stations[id]
		if !ok {
			http.Error(w, "Unknown station", http.StatusNotFound)
			return
		}
		mu.Lock()
		report, cached := cache[id]
		mu.Unlock()
		if !cached || time.Since(report.FetchedAt) > weatherTTL {
			data, _, err := tiles.Fetch(r.Context(), client, s.Feed, 16*1024*1024)
			var readings []Reading
			if err == nil {
				readings, err = parseFeed(data, s.List)
			}
			switch {
			case err == nil:
				report = buildReport(id, s, readings, time.Now().UTC())
				mu.Lock()
				cache[id] = report
				mu.Unlock()
			case cached:
				log.Printf("Weather feed %s failed, serving cached copy: %v", id, err)
				report.Stale = true
			default:
				log.Printf("Weather feed %s unavailable: %v", id, err)
				http.Error(w, "Weather feed unavailable", http.StatusBadGateway)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		_ = json.NewEncoder(w).Encode(report)
	})
}
