package planner

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

// MissionError says why a mission description or a mission file was refused.
// Its message is written for the person who has to fix the input.
type MissionError struct{ Message string }

func (e *MissionError) Error() string { return e.Message }

// The order of every list below is part of the file format: values are stored
// as their index. Add new entries at the end.
var (
	Sexes = []string{"female", "male"}
	Roles = []string{
		"commander", "pilot", "flight-engineer", "mission-specialist",
		"scientist", "physician", "payload-specialist", "other",
	}
	// The four activity levels of the Dietary Reference Intake energy equations.
	Activities   = []string{"sedentary", "low", "active", "very-active"}
	PhaseKinds   = []string{"custom", "transit", "station", "lander", "habitat", "rover", "analog"}
	MissionTypes = []string{
		"custom", "orbital-station", "lunar-sortie", "lunar-outpost",
		"mars-short-stay", "mars-long-stay", "rover-traverse", "analog",
	}
	TaskKinds = []string{"sample", "survey", "deploy", "repair", "image", "drill", "transfer", "other"}
)

// Astronaut is what the planner needs to know about one person.
type Astronaut struct {
	// Call sign. Printable ASCII, 1 to 31 characters.
	Name string `json:"name"`
	Sex  string `json:"sex"`
	// Years. The energy equations cover adults.
	Age      int     `json:"age"`
	MassKg   float64 `json:"massKg"`
	HeightCm int     `json:"heightCm"`
	Role     string  `json:"role"`
	Activity string  `json:"activity"`
	// Share of a phase's EVA hours this person takes. 1 is a full share, 0
	// stays inside, 2 covers for someone who does.
	EVAShare float64 `json:"evaShare"`
}

// PhaseParams is what a phase changes about the crew's needs.
type PhaseParams struct {
	// Hours outside per crewmember per week.
	EVAHoursPerWeek float64 `json:"evaHoursPerWeek"`
	// Share of waste water turned back into clean water, 0 to 1.
	WaterRecovery float64 `json:"waterRecovery"`
	// Share of breathed oxygen won back from carbon dioxide, 0 to 1.
	OxygenRecovery float64 `json:"oxygenRecovery"`
	// Washing and toilet flush water per crewmember per day.
	HygieneWaterKg float64 `json:"hygieneWaterKg"`
	// Vehicle power that does not depend on crew size.
	BasePowerW float64 `json:"basePowerW"`
	// Life support and crew equipment power per crewmember.
	CrewPowerW float64 `json:"crewPowerW"`
}

type Phase struct {
	Kind string `json:"kind"`
	Days int    `json:"days"`
	PhaseParams
}

// How each parameter is stored: value = stored integer * num / den. The slice
// order is the bit order of a phase's override mask in the file.
type paramField struct {
	key      string
	num, den float64
	bytes    int
	of       func(*PhaseParams) *float64
}

var paramFields = []paramField{
	{"evaHoursPerWeek", 1, 2, 1, func(p *PhaseParams) *float64 { return &p.EVAHoursPerWeek }},
	{"waterRecovery", 1, 100, 1, func(p *PhaseParams) *float64 { return &p.WaterRecovery }},
	{"oxygenRecovery", 1, 100, 1, func(p *PhaseParams) *float64 { return &p.OxygenRecovery }},
	{"hygieneWaterKg", 1, 100, 2, func(p *PhaseParams) *float64 { return &p.HygieneWaterKg }},
	{"basePowerW", 10, 1, 2, func(p *PhaseParams) *float64 { return &p.BasePowerW }},
	{"crewPowerW", 10, 1, 2, func(p *PhaseParams) *float64 { return &p.CrewPowerW }},
}

// ParamKeys lists the phase parameters a mission can override, in file order.
func ParamKeys() []string {
	keys := make([]string, len(paramFields))
	for i, field := range paramFields {
		keys[i] = field.key
	}
	return keys
}

// BVAD Table 4-75 plans 80 crewmember-hours of EVA a week for a lunar
// outpost. Shared by the nominal crew of four, that is 20 hours each.
const surfaceEVAHours = 20

// Hygiene water per crewmember per day. The larger two are from BVAD Tables
// 4-19 and 4-20. BVAD's short-mission allocation leaves 0.2 kg, under the
// minimum in STD-3001, so stored-supply phases use the minimum.
const (
	hygieneWipesOnly   = HygieneWaterMinKgPerDay
	hygieneStation     = 0.7  // oral hygiene and hand wash 0.4, urinal flush 0.3
	hygieneSurfaceBase = 1.98 // adds a shower and a bigger flush
)

type PhasePreset struct {
	Summary string `json:"summary"`
	PhaseParams
}

// PhasePresets holds what each phase kind assumes. Presets other than
// station leave the vehicle base load at zero: BVAD gives one only for ISS.
// Set basePowerW on a phase when the vehicle is known.
var PhasePresets = map[string]PhasePreset{
	"custom": {
		"Nothing assumed: stored supplies, no recycling, no EVA. Set what differs.",
		PhaseParams{0, 0, 0, hygieneStation, 0, CrewPowerW},
	},
	"transit": {
		"Weightless cruise between worlds. Recycling at ISS level, crew stays inside.",
		PhaseParams{0, ISSWaterRecovery, ISSOxygenRecovery, hygieneStation, 0, CrewPowerW},
	},
	"station": {
		"Orbital station with ISS life support and ISS housekeeping power.",
		// ASSUMED: station crews go outside a few times a year.
		PhaseParams{0.5, ISSWaterRecovery, ISSOxygenRecovery, hygieneStation, StationBasePowerW, CrewPowerW},
	},
	"lander": {
		"Days on the surface living in the lander. Stored supplies, wipes, daily EVA.",
		PhaseParams{surfaceEVAHours, 0, 0, hygieneWipesOnly, 0, CrewPowerW},
	},
	"habitat": {
		"Surface base for months. Recycling at ISS level, showers, regular EVA.",
		PhaseParams{surfaceEVAHours, ISSWaterRecovery, ISSOxygenRecovery, hygieneSurfaceBase, 0, CrewPowerW},
	},
	"rover": {
		"Pressurised rover away from base. Stored supplies, wipes, daily EVA.",
		PhaseParams{surfaceEVAHours, 0, 0, hygieneWipesOnly, 0, CrewPowerW},
	},
	"analog": {
		"Rehearsal habitat on Earth. Breathes outside air, water is trucked in.",
		// Oxygen recovery of 1: nothing to ship, the air is free.
		PhaseParams{0, 0, 1, hygieneSurfaceBase, 0, CrewPowerW},
	},
}

type TemplatePhase struct {
	Kind string `json:"kind"`
	Days int    `json:"days"`
}

type MissionTemplate struct {
	Summary string          `json:"summary"`
	Phases  []TemplatePhase `json:"phases"`
}

// MissionTemplates holds the default phase list of each mission type. Lunar
// and Mars durations are the nominal values of BVAD Table 3-1, with its
// transit time split evenly between the two legs.
var MissionTemplates = map[string]MissionTemplate{
	"custom":          {"Anything else. You list the phases yourself.", []TemplatePhase{}},
	"orbital-station": {"A six-month stay on a station in low Earth orbit, like an ISS expedition.", []TemplatePhase{{"station", 180}}},
	"lunar-sortie": {"Fly to the Moon, spend a week on the surface in the lander, fly home.",
		[]TemplatePhase{{"transit", 9}, {"lander", 7}, {"transit", 9}}},
	"lunar-outpost": {"Seven months in a lunar surface habitat.",
		[]TemplatePhase{{"transit", 9}, {"habitat", 210}, {"transit", 9}}},
	"mars-short-stay": {"Mars and back with 30 days on the surface, living in the lander.",
		[]TemplatePhase{{"transit", 180}, {"lander", 30}, {"transit", 180}}},
	"mars-long-stay": {"Mars and back with 600 days in a surface habitat, waiting for the return window.",
		[]TemplatePhase{{"transit", 180}, {"habitat", 600}, {"transit", 180}}},
	// ASSUMED duration. The crew that goes is usually two.
	"rover-traverse": {"Two weeks away from base in a pressurised rover.", []TemplatePhase{{"rover", 14}}},
	// 378 days is the length of NASA's CHAPEA mission 1.
	"analog": {"A year in a sealed habitat on Earth, rehearsing a surface stay.", []TemplatePhase{{"analog", 378}}},
}

// Site is a place on Mars the mission works at. Coordinates are
// planetocentric latitude and east-positive longitude from -180 to 180 on the
// IAU 2000 Mars sphere, the system NASA Trek tiles use. Stored to a millionth
// of a degree, about 6 cm on the ground.
type Site struct {
	// Printable ASCII, 1 to 31 characters, unique in the mission.
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	// What the site is and why the crew goes there. Readable UTF-8, up to
	// MaxSiteDescription bytes, kept with the symbols and briefing in the file.
	Description string `json:"description,omitempty"`
}

// MaxSiteDescription is the longest site description in bytes.
const MaxSiteDescription = 500

// Task is a piece of work at a site. Site, Phase and Crew are positions in
// the mission's lists, counted from zero.
type Task struct {
	Site  int `json:"site"`
	Phase int `json:"phase"`
	// Who does it, in crew list order, up to MaxTaskCrew people. Empty while
	// nobody is assigned.
	Crew []int  `json:"crew"`
	Kind string `json:"kind"`
	// Done outside in a suit. EVA tasks draw on each person's EVA hours.
	EVA bool `json:"eva"`
	// Hours of work for each assigned person, in steps of half an hour.
	Hours float64 `json:"hours"`
	// Printable ASCII, up to 31 characters. May be empty.
	Note string `json:"note"`
	// The plan stop the task is done at, from zero. It must be a visit to the
	// task's site. Nil when the plan sets none, which means the site's first
	// visit. A mission without a plan visits its sites in list order, so
	// there stop i is site i.
	Stop *int `json:"stop,omitempty"`
}

type Mission struct {
	// Printable ASCII, up to 31 characters. May be empty.
	Name string `json:"name"`
	Type string `json:"type"`
	// Added on top of everything the crew has to bring or generate.
	MarginPercent int         `json:"marginPercent"`
	Crew          []Astronaut `json:"crew"`
	Phases        []Phase     `json:"phases"`
	Sites         []Site      `json:"sites"`
	Tasks         []Task      `json:"tasks"`
	Markers       []Marker    `json:"markers,omitempty"`
	Briefing      string      `json:"briefing,omitempty"`
	// The plan: site positions in the order the EVA visits them, from zero.
	// A site may come back, but not twice in a row. Empty means no plan.
	Route []int `json:"route,omitempty"`
}

const (
	maxText  = 31
	maxCount = 255
)

// checker validates loosely typed input. It keeps the first problem it meets
// and turns every later check into a no-op, so callers read top to bottom.
type checker struct{ err error }

func (c *checker) failf(format string, args ...any) {
	if c.err == nil {
		c.err = &MissionError{fmt.Sprintf(format, args...)}
	}
}

// given renders a rejected value the way the input wrote it.
func given(value any) string {
	if value == nil {
		return "nothing"
	}
	text, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(text)
}

func number(value float64) string { return strconv.FormatFloat(value, 'f', -1, 64) }

func (c *checker) record(value any, what string) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		c.failf("%s must be an object", what)
		return map[string]any{}
	}
	return object
}

func (c *checker) list(value any, what string, min int) []any {
	items, ok := value.([]any)
	if !ok || len(items) < min || len(items) > maxCount {
		c.failf("%s must be a list of %d to %d entries", what, min, maxCount)
		return nil
	}
	return items
}

func (c *checker) text(value any, what string, minLength int) string {
	text, ok := value.(string)
	printable := ok && !strings.ContainsFunc(text, func(r rune) bool { return r < 0x20 || r > 0x7e })
	if !printable {
		c.failf("%s must be printable ASCII text", what)
		return ""
	}
	if len(text) < minLength || len(text) > maxText {
		c.failf("%s must be %d to %d characters, got %d", what, minLength, maxText, len(text))
		return ""
	}
	return text
}

func (c *checker) choice(value any, options []string, what string) string {
	text, ok := value.(string)
	if !ok || !slices.Contains(options, text) {
		c.failf("%s must be one of %s; got %s", what, strings.Join(options, ", "), given(value))
		return ""
	}
	return text
}

// measure checks the range, then snaps to the resolution the file format
// stores. The result is stored*num/den, the same expression the decoder uses,
// so a mission equals itself after a round trip through a file.
func (c *checker) measure(value any, what string, min, max, num, den float64) float64 {
	v, ok := value.(float64)
	if !ok || math.IsNaN(v) || math.IsInf(v, 0) || v < min || v > max {
		c.failf("%s must be a number from %s to %s; got %s", what, number(min), number(max), given(value))
		return 0
	}
	return stored(v, num, den) * num / den
}

// stored is the integer a value is kept as. Halves round up.
func stored(value, num, den float64) float64 { return math.Floor(value*den/num + 0.5) }

// reference resolves a position in a list, given as a number or, where names
// is not empty-named, as the name of the entry.
func (c *checker) reference(value any, names []string, byName bool, what string) int {
	index := -1
	switch v := value.(type) {
	case float64:
		if v == math.Trunc(v) && v >= 0 && v < float64(len(names)) {
			index = int(v)
		}
	case string:
		if byName {
			index = slices.Index(names, v)
		}
	}
	if index < 0 {
		c.failf("%s must point at one of %d entries; got %s", what, len(names), given(value))
		return 0
	}
	return index
}

func (c *checker) unique(names []string, what string) {
	for i, name := range names {
		if slices.Index(names, name) != i {
			c.failf("%q is in the %s twice", name, what)
			return
		}
	}
}

// or returns the fallback where the input left a field out or set it to null.
func or(value, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

func (c *checker) astronaut(value any, where string) Astronaut {
	input := c.record(value, where)
	return Astronaut{
		Name:     c.text(input["name"], where+" name", 1),
		Sex:      c.choice(input["sex"], Sexes, where+" sex"),
		Age:      int(c.measure(input["age"], where+" age", 18, 99, 1, 1)),
		MassKg:   c.measure(input["massKg"], where+" massKg", 30, 250, 1, 10),
		HeightCm: int(c.measure(input["heightCm"], where+" heightCm", 120, 250, 1, 1)),
		Role:     c.choice(or(input["role"], "mission-specialist"), Roles, where+" role"),
		Activity: c.choice(or(input["activity"], "active"), Activities, where+" activity"),
		EVAShare: c.measure(or(input["evaShare"], 1.0), where+" evaShare", 0, 2.55, 1, 100),
	}
}

func (c *checker) phase(value any, where string) Phase {
	input := c.record(value, where)
	kind := c.choice(input["kind"], PhaseKinds, where+" kind")
	preset := PhasePresets[kind].PhaseParams
	phase := Phase{Kind: kind, Days: int(c.measure(input["days"], where+" days", 1, 65535, 1, 1))}
	for _, field := range paramFields {
		max := (math.Pow(256, float64(field.bytes)) - 1) * field.num / field.den
		if strings.HasSuffix(field.key, "Recovery") {
			max = 1
		}
		*field.of(&phase.PhaseParams) = c.measure(
			or(input[field.key], *field.of(&preset)), where+" "+field.key, 0, max, field.num, field.den)
	}
	return phase
}

func (c *checker) site(value any, where string) Site {
	input := c.record(value, where)
	return Site{
		Name:        c.text(input["name"], where+" name", 1),
		Lat:         c.measure(input["lat"], where+" lat", -90, 90, 1, 1e6),
		Lon:         c.measure(input["lon"], where+" lon", -180, 180, 1, 1e6),
		Description: c.extraText(or(input["description"], ""), where+" description", 0, MaxSiteDescription, true),
	}
}

func (c *checker) task(value any, where string, crew, sites []string, phases int) Task {
	input := c.record(value, where)
	eva, isBool := or(input["eva"], true).(bool)
	if !isBool {
		c.failf("%s eva must be true or false", where)
	}
	task := Task{
		Site:  c.reference(input["site"], sites, true, where+" site"),
		Phase: c.reference(input["phase"], make([]string, phases), false, where+" phase"),
	}
	task.Crew = c.taskCrew(input["crew"], crew, where+" crew")
	task.Kind = c.choice(input["kind"], TaskKinds, where+" kind")
	task.EVA = eva
	task.Hours = c.measure(input["hours"], where+" hours", 0.5, 127.5, 1, 2)
	task.Note = c.text(or(input["note"], ""), where+" note", 0)
	if raw, set := input["stop"]; set && raw != nil {
		stop, ok := raw.(float64)
		if !ok || stop != math.Trunc(stop) || stop < 0 || stop >= maxCount {
			c.failf("%s stop must be a plan position from 0 to %d; got %s", where, maxCount-1, given(raw))
		}
		at := int(stop)
		task.Stop = &at
	}
	return task
}

// MaxTaskCrew is how many people one task can be assigned to. The file keeps
// the count of those after the first in four bits.
const MaxTaskCrew = 16

// taskCrew reads who a task is assigned to: nobody, one crew member, as
// missions written before format version 3 have it, or a list of them.
func (c *checker) taskCrew(value any, crew []string, where string) []int {
	people := []int{}
	switch v := value.(type) {
	case nil:
	case []any:
		for _, entry := range v {
			people = append(people, c.reference(entry, crew, true, where))
		}
	default:
		people = append(people, c.reference(v, crew, true, where))
	}
	if len(people) > MaxTaskCrew {
		c.failf("%s must list at most %d people; got %d", where, MaxTaskCrew, len(people))
	}
	slices.Sort(people)
	if len(slices.Compact(slices.Clone(people))) != len(people) {
		c.failf("%s lists the same person twice", where)
	}
	return people
}

// ParseAstronaut validates one profile on its own, for rosters kept outside
// a mission.
func ParseAstronaut(data []byte) (Astronaut, error) {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return Astronaut{}, &MissionError{"the profile is not valid JSON"}
	}
	c := &checker{}
	person := c.astronaut(raw, "astronaut")
	return person, c.err
}

// ParseMission validates a mission description in JSON and fills in
// defaults. Everything that enters the planner, from JSON or from a decoded
// file, goes through here. roster is an optional JSON list of profiles; a
// crew entry given as a string is looked up in it by name.
func ParseMission(data, roster []byte) (Mission, error) {
	var raw, rawRoster any
	if err := json.Unmarshal(data, &raw); err != nil {
		return Mission{}, &MissionError{"the mission is not valid JSON"}
	}
	if len(roster) > 0 {
		if err := json.Unmarshal(roster, &rawRoster); err != nil {
			return Mission{}, &MissionError{"the roster is not valid JSON"}
		}
	}
	return parseMission(raw, rawRoster)
}

func parseMission(raw, rawRoster any) (Mission, error) {
	c := &checker{}
	source := c.record(raw, "mission")
	missionType := c.choice(source["type"], MissionTypes, "mission type")

	var roster []Astronaut
	if rawRoster != nil {
		for i, entry := range c.list(rawRoster, "roster", 1) {
			roster = append(roster, c.astronaut(entry, fmt.Sprintf("roster entry %d", i+1)))
		}
	}
	crew := []Astronaut{}
	// A new mission has nobody on it until the crew is picked.
	for i, entry := range c.list(source["crew"], "crew", 0) {
		name, byName := entry.(string)
		if !byName {
			crew = append(crew, c.astronaut(entry, fmt.Sprintf("crew member %d", i+1)))
			continue
		}
		found := slices.IndexFunc(roster, func(person Astronaut) bool { return person.Name == name })
		if found < 0 {
			c.failf("no %q in the roster", name)
			continue
		}
		crew = append(crew, roster[found])
	}
	names := make([]string, len(crew))
	for i, person := range crew {
		names[i] = person.Name
	}
	c.unique(names, "crew")

	rawPhases := source["phases"]
	if rawPhases == nil {
		template := MissionTemplates[missionType].Phases
		if len(template) == 0 {
			c.failf("a %s mission needs a list of phases", missionType)
		}
		defaults := make([]any, len(template))
		for i, phase := range template {
			defaults[i] = map[string]any{"kind": phase.Kind, "days": float64(phase.Days)}
		}
		rawPhases = defaults
	}
	phases := []Phase{}
	for i, entry := range c.list(rawPhases, "phases", 1) {
		phases = append(phases, c.phase(entry, fmt.Sprintf("phase %d", i+1)))
	}

	sites := []Site{}
	for i, entry := range c.list(or(source["sites"], []any{}), "sites", 0) {
		sites = append(sites, c.site(entry, fmt.Sprintf("site %d", i+1)))
	}
	siteNames := make([]string, len(sites))
	for i, site := range sites {
		siteNames[i] = site.Name
	}
	c.unique(siteNames, "sites")

	tasks := []Task{}
	for i, entry := range c.list(or(source["tasks"], []any{}), "tasks", 0) {
		tasks = append(tasks, c.task(entry, fmt.Sprintf("task %d", i+1), names, siteNames, len(phases)))
	}

	route := []int{}
	for i, entry := range c.list(or(source["route"], []any{}), "route", 0) {
		where := fmt.Sprintf("plan stop %d", i+1)
		site := c.reference(entry, siteNames, true, where)
		if c.err == nil && i > 0 && site == route[i-1] {
			c.failf("%s is %s again; a stop must differ from the one before it", where, siteNames[site])
		}
		route = append(route, site)
	}
	if len(route) == 0 {
		route = nil
	}
	// A task's stop has to be a visit to its site.
	visits := route
	if visits == nil {
		visits = make([]int, len(sites))
		for i := range visits {
			visits[i] = i
		}
	}
	for i, task := range tasks {
		if task.Stop == nil || c.err != nil {
			continue
		}
		switch stop := *task.Stop; {
		case stop >= len(visits):
			c.failf("task %d stop must point at one of %d plan stops; got %d", i+1, len(visits), stop)
		case visits[stop] != task.Site:
			c.failf("task %d is at %s, but plan stop %d is %s", i+1, siteNames[task.Site], stop+1, siteNames[visits[stop]])
		}
	}

	markers, briefing := c.missionExtras(source)
	mission := Mission{
		Name:          c.text(or(source["name"], ""), "mission name", 0),
		Type:          missionType,
		MarginPercent: int(c.measure(or(source["marginPercent"], float64(DefaultMarginPercent)), "marginPercent", MinMarginPercent, MaxMarginPercent, 1, 1)),
		Crew:          crew,
		Phases:        phases,
		Sites:         sites,
		Tasks:         tasks,
		Markers:       markers,
		Briefing:      briefing,
		Route:         route,
	}
	if c.err != nil {
		return Mission{}, c.err
	}
	return mission, nil
}

// Normalize checks a mission built in Go code and snaps its values to the
// resolution the file stores. It is the same validation JSON input gets.
func Normalize(mission Mission) (Mission, error) {
	data, err := json.Marshal(mission)
	if err != nil {
		return Mission{}, &MissionError{"the mission holds a value that cannot be stored: " + err.Error()}
	}
	return ParseMission(data, nil)
}
