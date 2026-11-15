package planner

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestScienceMissionSurvivesImportAndExport(t *testing.T) {
	mission := example(t, "yellowknife-science.json")
	file := encode(t, mission)
	committed, err := Examples.ReadFile("examples/yellowknife-science.mhr")
	if err != nil || string(file) != string(committed) {
		t.Fatalf("packed science example differs from its JSON: %v", err)
	}
	if file[6]>>4 != 4 || len(mission.Markers) != 10 || !strings.Contains(mission.Briefing, "https://science.nasa.gov/") {
		t.Fatal("science mission must carry its symbols and sources in version 4")
	}
	url := server(t).URL + "/api/planner"
	body, _ := json.Marshal(map[string]Mission{"mission": mission})
	status, fields := call(t, http.MethodPost, url+"/plan", string(body))
	if status != http.StatusOK {
		t.Fatalf("import: %d %s", status, fields["error"])
	}
	var planned planResponse
	raw, _ := json.Marshal(fields)
	if err := json.Unmarshal(raw, &planned); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(planned.Mission, mission) {
		t.Fatal("JSON import lost mission fields")
	}
	packed, err := base64.StdEncoding.DecodeString(planned.File)
	if err != nil || string(packed) != string(file) {
		t.Fatalf("API export differs from CLI file: %v", err)
	}
	status, fields = call(t, http.MethodPost, url+"/decode", string(packed))
	var decoded Mission
	err = json.Unmarshal(fields["mission"], &decoded)
	if status != http.StatusOK || err != nil || !reflect.DeepEqual(decoded, mission) {
		t.Fatalf("packed import differs: %d %v", status, err)
	}
	if planned.Plan.Total.EVAHours != 8 || planned.Plan.UnassignedTaskHours != 0 || len(planned.Plan.EVAOverruns) != 0 {
		t.Fatal("science tasks must fit the two four-hour EVA allocations")
	}
	for i, person := range planned.Plan.Crew {
		if person.TaskHours.EVA != person.Total.EVAHours {
			t.Errorf("crew %d: tasks and provisioned EVA hours differ", i)
		}
	}
}

func TestMarkerValidationAndUnicodeRoundTrip(t *testing.T) {
	mission := bare(t)
	mission.Markers = []Marker{{ID: "a3ec73a5-4d38-480a-b837-9c4a551d29f7", Symbol: "mil2525c-sample", Point: [2]float64{-4.5896404, 137.4493304}, Label: "Зразок породи"}}
	mission.Briefing = "Sample notes\nМісія\nhttps://science.nasa.gov/"
	normalized, err := Normalize(mission)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeMission(encode(t, mission))
	if err != nil || !reflect.DeepEqual(decoded, normalized) || decoded.Markers[0].Point != [2]float64{-4.58964, 137.44933} {
		t.Fatalf("Unicode/coordinates round trip: %+v, %v", decoded.Markers, err)
	}
	cases := []struct {
		name string
		edit func(*Mission)
	}{
		{"unknown symbol", func(m *Mission) { m.Markers[0].Symbol = "mil2525c-missing" }},
		{"latitude", func(m *Mission) { m.Markers[0].Point[0] = 91 }},
		{"longitude", func(m *Mission) { m.Markers[0].Point[1] = 181 }},
		{"duplicate id", func(m *Mission) { m.Markers = append(m.Markers, m.Markers[0]) }},
		{"empty id", func(m *Mission) { m.Markers[0].ID = "" }},
		{"label control", func(m *Mission) { m.Markers[0].Label = "bad\x00label" }},
		{"long briefing", func(m *Mission) { m.Briefing = strings.Repeat("x", 16001) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := mission
			candidate.Markers = append([]Marker(nil), mission.Markers...)
			tc.edit(&candidate)
			if _, err := EncodeMission(candidate, PacketOptions{}); err == nil {
				t.Fatal("invalid mission was accepted")
			}
		})
	}
}

func TestVersionFourRejectsDamagedOrOversizedExtras(t *testing.T) {
	mission := bare(t)
	base := encode(t, mission)
	mission.Briefing = "Source and assumptions"
	file := encode(t, mission)
	start := len(base) - crcBytes
	length := append([]byte(nil), file...)
	length[start], length[start+1] = 0xff, 0xff
	refused(t, resealed(length), "it ends before the symbols and briefing do")
	invalid := append([]byte(nil), file...)
	invalid[start+2] = '!'
	refused(t, resealed(invalid), "symbols and briefing are not a JSON object")
	file[start+3] ^= 1
	refused(t, file, "checksum mismatch")
	for i := range 255 {
		mission.Markers = append(mission.Markers, Marker{ID: fmt.Sprintf("%064d", i), Symbol: "mil2525c-sample", Label: strings.Repeat("x", 160)})
	}
	if _, err := EncodeMission(mission, PacketOptions{}); err == nil || !strings.Contains(err.Error(), "exceed") {
		t.Fatalf("oversized packet: %v", err)
	}
}

func TestSiteDescriptionsSurvivesARoundTripAndOnlyItRaisesTheVersion(t *testing.T) {
	mission := bare(t)
	mission.Sites = []Site{{Name: "A", Lat: 1, Lon: 2}, {Name: "B", Lat: 3, Lon: 4, Description: "Boxwork ridges.\nSample the light-toned veins."}}
	file := encode(t, mission)
	decoded, err := DecodeMission(file)
	if err != nil || file[6]>>4 != 4 || !reflect.DeepEqual(decoded.Sites, mission.Sites) {
		t.Fatalf("version %d, sites %+v, %v", file[6]>>4, decoded.Sites, err)
	}
	mission.Sites[1].Description = ""
	if file := encode(t, mission); file[6]>>4 != 3 {
		t.Errorf("sites without descriptions wrote version %d, want 3", file[6]>>4)
	}
}

func TestSiteDescriptionsOverTheLimitIsRefused(t *testing.T) {
	source := map[string]any{"name": "A", "lat": 1.0, "lon": 2.0, "description": strings.Repeat("x", MaxSiteDescription+1)}
	c := &checker{}
	c.site(source, "site 1")
	if c.err == nil || !strings.Contains(c.err.Error(), "site 1 description") {
		t.Errorf("err = %v", c.err)
	}
}

func TestThePlanSurvivesARoundTripAndMayComeBackToASite(t *testing.T) {
	mission := bare(t)
	mission.Sites = []Site{{Name: "A", Lat: 1, Lon: 2}, {Name: "B", Lat: 3, Lon: 4}, {Name: "C", Lat: 5, Lon: 6}}
	mission.Route = []int{0, 1, 0, 2, 0}
	file := encode(t, mission)
	decoded, err := DecodeMission(file)
	if err != nil || file[6]>>4 != 4 || !reflect.DeepEqual(decoded.Route, mission.Route) {
		t.Fatalf("version %d, route %v, %v", file[6]>>4, decoded.Route, err)
	}
	mission.Route = nil
	if file := encode(t, mission); file[6]>>4 != 3 {
		t.Errorf("a mission without a plan wrote version %d, want 3", file[6]>>4)
	}
}

func TestAPlanStopMustBeASiteAndDifferFromTheOneBefore(t *testing.T) {
	sites := []any{map[string]any{"name": "A", "lat": 1.0, "lon": 2.0}, map[string]any{"name": "B", "lat": 3.0, "lon": 4.0}}
	for _, test := range []struct {
		route []any
		want  string
	}{
		{[]any{0.0, 0.0}, "plan stop 2 is A again"},
		{[]any{0.0, 2.0}, "plan stop 2 must point at one of 2 entries"},
		{[]any{"B", "A"}, ""},
	} {
		source := map[string]any{"route": test.route, "sites": sites}
		mission := example(t, "gale-expedition.json")
		mission.Sites, mission.Tasks = nil, nil
		data, _ := json.Marshal(mission)
		var raw map[string]any
		_ = json.Unmarshal(data, &raw)
		raw["sites"], raw["route"] = source["sites"], source["route"]
		data, _ = json.Marshal(raw)
		got, err := ParseMission(data, nil)
		switch {
		case test.want == "" && (err != nil || !reflect.DeepEqual(got.Route, []int{1, 0})):
			t.Errorf("%v: route %v, %v", test.route, got.Route, err)
		case test.want != "" && (err == nil || !strings.Contains(err.Error(), test.want)):
			t.Errorf("%v: err = %v, want %q", test.route, err, test.want)
		}
	}
}

func TestATaskKeepsItsPlanStop(t *testing.T) {
	mission := bare(t)
	mission.Sites = []Site{{Name: "A", Lat: 1, Lon: 2}, {Name: "B", Lat: 3, Lon: 4}}
	mission.Route = []int{0, 1, 0}
	third := 2
	mission.Tasks = []Task{
		{Site: 0, Phase: 0, Crew: []int{0}, Kind: "sample", EVA: true, Hours: 1, Stop: &third},
		{Site: 1, Phase: 0, Crew: []int{}, Kind: "survey", EVA: true, Hours: 2},
	}
	decoded, err := DecodeMission(encode(t, mission))
	if err != nil || !reflect.DeepEqual(decoded.Tasks, mission.Tasks) {
		t.Fatalf("tasks %+v, %v", decoded.Tasks, err)
	}
}

func TestATaskStopMustBeAVisitToItsSite(t *testing.T) {
	mission := bare(t)
	mission.Sites = []Site{{Name: "A", Lat: 1, Lon: 2}, {Name: "B", Lat: 3, Lon: 4}}
	mission.Route = []int{0, 1, 0}
	for stop, want := range map[int]string{1: "task 1 is at A, but plan stop 2 is B", 3: "task 1 stop must point at one of 3 plan stops"} {
		at := stop
		mission.Tasks = []Task{{Site: 0, Phase: 0, Crew: []int{}, Kind: "sample", EVA: true, Hours: 1, Stop: &at}}
		if _, err := Normalize(mission); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("stop %d: err = %v, want %q", stop, err, want)
		}
	}
}
