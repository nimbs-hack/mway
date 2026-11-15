package env

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"mars-console/api/internal/tiles"
)

const spaceWeatherPath = "/api/spaceweather"

// NASA DONKI through api.nasa.gov. One request may span at most 60 days, and
// DEMO_KEY allows about 10 requests an hour, so results are cached for an
// hour. Set NASA_API_KEY for a higher limit.
const donkiEnlil = "https://api.nasa.gov/DONKI/WSAEnlilSimulations"

// How far back to read model runs. A CME reaches Mars in about 2 to 8 days,
// so older runs can only describe arrivals already past.
const enlilLookback = 30 * 24 * time.Hour

// Arrival is one CME forecast to reach Mars, from the newest WSA-ENLIL run
// that modeled it. Times are UTC.
type Arrival struct {
	CME          string    `json:"cme"`
	Launched     time.Time `json:"launched"`
	SpeedKmS     float64   `json:"speedKmS"`
	Arrival      time.Time `json:"arrival"`
	Glancing     bool      `json:"glancing"`
	Minor        bool      `json:"minor"`
	ModelRun     time.Time `json:"modelRun"`
	SimulationID string    `json:"simulationId"`
	Link         string    `json:"link"`
}

// SpaceWeather is what the browser gets.
type SpaceWeather struct {
	FetchedAt time.Time `json:"fetchedAt"`
	Stale     bool      `json:"stale"`
	Source    string    `json:"source"`
	Arrivals  []Arrival `json:"arrivals"`
}

// DONKI times look like "2026-11-13T16:13Z", without seconds.
func donkiTime(value string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02T15:04Z", time.RFC3339} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unreadable DONKI time %q", value)
}

// parseEnlil keeps Mars arrivals, one per CME, from the newest model run.
func parseEnlil(data []byte) ([]Arrival, error) {
	var runs []struct {
		SimulationID        string `json:"simulationID"`
		ModelCompletionTime string `json:"modelCompletionTime"`
		Link                string `json:"link"`
		CMEInputs           []struct {
			CMEID          string  `json:"CMEID"`
			CMEStartTime   string  `json:"cmeStartTime"`
			Speed          float64 `json:"speed"`
			IsMostAccurate bool    `json:"isMostAccurate"`
		} `json:"cmeInputs"`
		ImpactList []struct {
			Location       string `json:"location"`
			ArrivalTime    string `json:"arrivalTime"`
			IsGlancingBlow bool   `json:"isGlancingBlow"`
			IsMinorImpact  bool   `json:"isMinorImpact"`
		} `json:"impactList"`
	}
	if err := json.Unmarshal(data, &runs); err != nil {
		return nil, err
	}
	byCME := map[string]Arrival{}
	for _, run := range runs {
		completed, err := donkiTime(run.ModelCompletionTime)
		if err != nil {
			continue
		}
		for _, impact := range run.ImpactList {
			if impact.Location != "Mars" {
				continue
			}
			arrival, err := donkiTime(impact.ArrivalTime)
			if err != nil {
				continue
			}
			ids := make([]string, 0, len(run.CMEInputs))
			a := Arrival{Arrival: arrival, Glancing: impact.IsGlancingBlow, Minor: impact.IsMinorImpact, ModelRun: completed, SimulationID: run.SimulationID, Link: run.Link}
			for _, input := range run.CMEInputs {
				ids = append(ids, input.CMEID)
				if input.IsMostAccurate || a.SpeedKmS == 0 {
					a.SpeedKmS = input.Speed
					if launched, err := donkiTime(input.CMEStartTime); err == nil {
						a.Launched = launched
					}
				}
			}
			sort.Strings(ids)
			a.CME = strings.Join(ids, "+")
			if a.CME == "" {
				a.CME = run.SimulationID
			}
			if old, ok := byCME[a.CME]; !ok || a.ModelRun.After(old.ModelRun) {
				byCME[a.CME] = a
			}
		}
	}
	arrivals := make([]Arrival, 0, len(byCME))
	for _, a := range byCME {
		arrivals = append(arrivals, a)
	}
	sort.Slice(arrivals, func(i, j int) bool { return arrivals[i].Arrival.Before(arrivals[j].Arrival) })
	return arrivals, nil
}

func enlilURL(now time.Time, key string) string {
	query := url.Values{}
	query.Set("startDate", now.Add(-enlilLookback).Format("2006-01-02"))
	query.Set("endDate", now.Format("2006-01-02"))
	query.Set("api_key", key)
	return donkiEnlil + "?" + query.Encode()
}

// RegisterSpaceWeather serves GET /api/spaceweather: CME arrivals at Mars
// forecast by WSA-ENLIL runs from the last 30 days, past and upcoming.
func RegisterSpaceWeather(mux *http.ServeMux, client *http.Client) {
	if client == nil {
		client = http.DefaultClient
	}
	key := strings.TrimSpace(os.Getenv("NASA_API_KEY"))
	if key == "" {
		key = "DEMO_KEY"
	}
	var mu sync.Mutex
	var cached *SpaceWeather
	mux.HandleFunc("GET "+spaceWeatherPath, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		report := cached
		mu.Unlock()
		if report == nil || time.Since(report.FetchedAt) > time.Hour {
			now := time.Now().UTC()
			data, _, err := tiles.Fetch(r.Context(), client, enlilURL(now, key), 8*1024*1024)
			var arrivals []Arrival
			if err == nil {
				arrivals, err = parseEnlil(data)
			}
			switch {
			case err == nil:
				report = &SpaceWeather{FetchedAt: now, Source: "NASA DONKI, WSA-ENLIL runs from CCMC", Arrivals: arrivals}
				mu.Lock()
				cached = report
				mu.Unlock()
			case report != nil:
				log.Printf("Space weather fetch failed, serving cached copy: %v", err)
				stale := *report
				stale.Stale = true
				report = &stale
			default:
				log.Printf("Space weather unavailable: %v", err)
				http.Error(w, "Space weather unavailable", http.StatusBadGateway)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		_ = json.NewEncoder(w).Encode(report)
	})
}
