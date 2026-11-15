package planner

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// Examples holds a sample mission, a sample roster and a packed mission
// file. All of it is fictional.
//
//go:embed examples
var Examples embed.FS

// A mission description is a few kilobytes. Anything near this is not one.
const maxRequestBytes = 1 << 20

type typeEntry struct {
	ID string `json:"id"`
	MissionTemplate
}

type kindEntry struct {
	ID string `json:"id"`
	PhasePreset
}

// catalog is everything an editor needs to offer choices and explain itself,
// so that it holds no copy of the planner's lists or rates.
type catalog struct {
	MissionTypes         []typeEntry        `json:"missionTypes"`
	PhaseKinds           []kindEntry        `json:"phaseKinds"`
	Sexes                []string           `json:"sexes"`
	Roles                []string           `json:"roles"`
	Activities           []string           `json:"activities"`
	TaskKinds            []string           `json:"taskKinds"`
	DefaultMarginPercent int                `json:"defaultMarginPercent"`
	MinMarginPercent     int                `json:"minMarginPercent"`
	MaxMarginPercent     int                `json:"maxMarginPercent"`
	Rates                map[string]float64 `json:"rates"`
	// A fictional mission and crew to start from.
	Example      Mission     `json:"example"`
	SampleRoster []Astronaut `json:"sampleRoster"`
}

func buildCatalog() (catalog, error) {
	c := catalog{
		Sexes: Sexes, Roles: Roles, Activities: Activities, TaskKinds: TaskKinds,
		DefaultMarginPercent: DefaultMarginPercent,
		MinMarginPercent:     MinMarginPercent,
		MaxMarginPercent:     MaxMarginPercent,
		Rates: map[string]float64{
			"evaFoodKcalPerHour":       EVAFoodKcalPerHour,
			"foodKgPer1000Kcal":        FoodKgPerMJ * (1 + FoodPackagingFraction) * KJPerKcal,
			"oxygenKgPer1000Kcal":      OxygenKgPerMJ * KJPerKcal,
			"co2KgPer1000Kcal":         CO2KgPerMJ * KJPerKcal,
			"potableWaterKgPerDay":     PotableWaterKgPerDay,
			"evaDrinkKgPerHour":        EVADrinkKgPerHour,
			"evaCoolingWaterKgPerHour": EVACoolingWaterKgPerHour,
			"evaOxygenLossKgPerHour":   EVAOxygenLossKgPerHour,
			"dailyCommandBits":         DailyCommandBits,
		},
	}
	for _, id := range MissionTypes {
		c.MissionTypes = append(c.MissionTypes, typeEntry{id, MissionTemplates[id]})
	}
	for _, id := range PhaseKinds {
		c.PhaseKinds = append(c.PhaseKinds, kindEntry{id, PhasePresets[id]})
	}

	rosterFile, err := Examples.ReadFile("examples/roster.json")
	if err != nil {
		return c, err
	}
	var roster struct {
		Astronauts json.RawMessage `json:"astronauts"`
	}
	if err := json.Unmarshal(rosterFile, &roster); err != nil {
		return c, err
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(roster.Astronauts, &entries); err != nil {
		return c, err
	}
	for _, entry := range entries {
		person, err := ParseAstronaut(entry)
		if err != nil {
			return c, err
		}
		c.SampleRoster = append(c.SampleRoster, person)
	}
	example, err := Examples.ReadFile("examples/gale-expedition.json")
	if err != nil {
		return c, err
	}
	c.Example, err = ParseMission(example, roster.Astronauts)
	return c, err
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// refuse answers a request the planner cannot use. A mission that does not
// add up is the caller's to fix, so it gets 422 and the reason.
func refuse(w http.ResponseWriter, err error) {
	var missionError *MissionError
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &missionError):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": missionError.Message})
	case errors.As(err, &tooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "the request is too large"})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the request could not be read"})
	}
}

type planRequest struct {
	Mission json.RawMessage `json:"mission"`
	// Optional. Crew entries given as names are looked up here.
	Roster json.RawMessage `json:"roster"`
}

type planResponse struct {
	// The mission as the planner understood it: defaults filled in, values
	// snapped to what the file stores.
	Mission  Mission  `json:"mission"`
	Plan     Plan     `json:"plan"`
	Cautions []string `json:"cautions"`
	// The mission file, base64 encoded.
	File      string         `json:"file"`
	FileBytes int            `json:"fileBytes"`
	Links     []LinkEstimate `json:"links"`
}

// Register adds the planner's routes to the server.
//
//	GET  /api/planner/catalog  mission types, phase presets, lists, rates, examples
//	POST /api/planner/plan     {mission, roster?} to the checked mission, its plan and its file
//	POST /api/planner/decode   a mission file to the mission in it
func Register(mux *http.ServeMux) {
	// The catalog is built from files compiled into the program, so it can
	// only fail if those files are wrong. The tests check that they are not.
	listing, catalogErr := buildCatalog()
	mux.HandleFunc("GET /api/planner/catalog", func(w http.ResponseWriter, _ *http.Request) {
		if catalogErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "the planner catalog could not be built"})
			return
		}
		writeJSON(w, http.StatusOK, listing)
	})

	mux.HandleFunc("POST /api/planner/plan", func(w http.ResponseWriter, r *http.Request) {
		var request planRequest
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
		if err == nil {
			err = json.Unmarshal(body, &request)
		}
		if err != nil {
			refuse(w, err)
			return
		}
		if len(request.Mission) == 0 {
			refuse(w, &MissionError{"mission must be an object"})
			return
		}
		mission, err := ParseMission(request.Mission, request.Roster)
		if err != nil {
			refuse(w, err)
			return
		}
		file, err := EncodeMission(mission, PacketOptions{})
		if err != nil {
			refuse(w, err)
			return
		}
		plan := PlanMission(mission)
		writeJSON(w, http.StatusOK, planResponse{
			Mission:   mission,
			Plan:      plan,
			Cautions:  Cautions(mission, plan),
			File:      base64.StdEncoding.EncodeToString(file),
			FileBytes: len(file),
			Links:     LinkEstimates(len(file)),
		})
	})

	mux.HandleFunc("POST /api/planner/decode", func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPacketBytes))
		if err != nil {
			refuse(w, err)
			return
		}
		mission, err := DecodeMission(data)
		if err != nil {
			refuse(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]Mission{"mission": mission})
	})
}
