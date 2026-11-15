package planner

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Marker uses planetocentric latitude and east longitude in -180..180.
// IDs belong to the mission, so opening another mission replaces its symbols.
type Marker struct {
	ID     string     `json:"id"`
	Symbol string     `json:"symbol"`
	Point  [2]float64 `json:"point"`
	Label  string     `json:"label"`
}

type missionExtras struct {
	Markers  []Marker `json:"markers,omitempty"`
	Briefing string   `json:"briefing,omitempty"`
	// One entry for each site, in site order, when any site has a description.
	SiteDescriptions []string `json:"siteDescriptions,omitempty"`
	Route            []int    `json:"route,omitempty"`
	// One entry for each task, in task order: its plan stop, or -1 for none.
	// Written only when some task has a stop.
	TaskStops []int `json:"taskStops,omitempty"`
}

// taskStops is each task's plan stop in task order, -1 for none, or nil when
// no task has one.
func taskStops(tasks []Task) []int {
	stops := make([]int, len(tasks))
	has := false
	for i, task := range tasks {
		stops[i] = -1
		if task.Stop != nil {
			stops[i] = *task.Stop
			has = true
		}
	}
	if !has {
		return nil
	}
	return stops
}

// siteDescriptions is the sites' descriptions in site order, or nil when no
// site has one.
func siteDescriptions(sites []Site) []string {
	descriptions := make([]string, len(sites))
	has := false
	for i, site := range sites {
		descriptions[i] = site.Description
		has = has || site.Description != ""
	}
	if !has {
		return nil
	}
	return descriptions
}

// The frontend catalog test checks this list against the rendered symbols.
//
//go:embed marker-symbols.json
var markerSymbolsJSON []byte

var markerSymbols = func() []string {
	var symbols []string
	if err := json.Unmarshal(markerSymbolsJSON, &symbols); err != nil {
		panic(err)
	}
	return symbols
}()

// Extra text supports Unicode labels and multiline science notes. Limits are
// in bytes because the packet has a fixed byte budget.
func (c *checker) extraText(value any, what string, min, max int, multiline bool) string {
	text, ok := value.(string)
	if !ok || !utf8.ValidString(text) || len(text) < min || len(text) > max || strings.ContainsFunc(text, func(r rune) bool {
		return unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\t' || r == '\r'))
	}) {
		c.failf("%s must be readable UTF-8 text from %d to %d bytes", what, min, max)
		return ""
	}
	return text
}

func (c *checker) missionExtras(source map[string]any) ([]Marker, string) {
	var markers []Marker
	ids := []string{}
	for i, entry := range c.list(or(source["markers"], []any{}), "markers", 0) {
		what := fmt.Sprintf("marker %d", i+1)
		raw := c.record(entry, what)
		point, ok := raw["point"].([]any)
		if !ok || len(point) != 2 {
			c.failf("%s point must contain latitude and longitude", what)
			continue
		}
		marker := Marker{
			ID:     c.extraText(raw["id"], what+" id", 1, 64, false),
			Symbol: c.choice(raw["symbol"], markerSymbols, what+" symbol"),
			Point: [2]float64{
				c.measure(point[0], what+" latitude", -90, 90, 1, 1e6),
				c.measure(point[1], what+" longitude", -180, 180, 1, 1e6),
			},
			Label: c.extraText(or(raw["label"], ""), what+" label", 0, 160, false),
		}
		markers = append(markers, marker)
		ids = append(ids, marker.ID)
	}
	c.unique(ids, "markers")
	return markers, c.extraText(or(source["briefing"], ""), "mission briefing", 0, 16000, true)
}
