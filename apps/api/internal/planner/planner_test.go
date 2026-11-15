package planner

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

const kcalMJ = KJPerKcal / 1000

type object = map[string]any

var person = Astronaut{
	Name: "TEST", Sex: "male", Age: 30, MassKg: 70, HeightCm: 175,
	Role: "pilot", Activity: "active", EVAShare: 1,
}

func js(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func parse(t *testing.T, mission any) Mission {
	t.Helper()
	parsed, err := ParseMission(js(t, mission), nil)
	if err != nil {
		t.Fatalf("ParseMission: %v", err)
	}
	return parsed
}

func near(t *testing.T, what string, got, want, tolerance float64) {
	t.Helper()
	if math.Abs(got-want) > tolerance {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

func phaseOf(kind string, change func(*Phase)) Phase {
	phase := Phase{Kind: kind, Days: 1, PhaseParams: PhasePresets[kind].PhaseParams}
	if change != nil {
		change(&phase)
	}
	return phase
}

func rejects(t *testing.T, mission any, want string) {
	t.Helper()
	_, err := ParseMission(js(t, mission), nil)
	var missionError *MissionError
	if err == nil || !asMissionError(err, &missionError) || !strings.Contains(err.Error(), want) {
		t.Errorf("error = %v, want one containing %q", err, want)
	}
}

func asMissionError(err error, target **MissionError) bool {
	found, ok := err.(*MissionError)
	*target = found
	return ok
}

func TestEnergyRequirementMatchesTheDRIEquation(t *testing.T) {
	// 662 - 9.53*30 + 1.25*(15.9*70 + 539.6*1.75) = 2947.7 kcal
	near(t, "man", EnergyRequirementMJ(person)/kcalMJ, 2947.7, 0.5)
	// 354 - 6.91*30 + 1.25*(9.36*60 + 726*1.65) = 2346.1 kcal
	woman := person
	woman.Sex, woman.MassKg, woman.HeightCm = "female", 60, 165
	near(t, "woman", EnergyRequirementMJ(woman)/kcalMJ, 2346.1, 0.5)
}

func TestActivityLevelMovesTheRequirement(t *testing.T) {
	at := func(activity string) float64 {
		p := person
		p.Activity = activity
		return EnergyRequirementMJ(p)
	}
	if !(at("sedentary") < at("low") && at("low") < at("active") && at("active") < at("very-active")) {
		t.Error("energy does not rise with activity")
	}
}

func TestMacronutrientsFollowBodyMassAndEnergy(t *testing.T) {
	needs := NeedsPerDay(person)
	near(t, "protein min", needs.ProteinG.Min, 84, 1e-9)
	near(t, "protein max", needs.ProteinG.Max, 126, 1e-9)
	kcal := needs.FoodEnergyMJ / kcalMJ
	near(t, "carbohydrate min", needs.CarbohydrateG.Min, kcal*0.45/4, 1e-6)
	near(t, "fat max", needs.FatG.Max, kcal*0.35/9, 1e-6)
	// 32 mL/kg gives 2.24 L, under the 2.5 L floor for men.
	near(t, "fluid", needs.FluidL, 2.5, 0)
	for _, nutrient := range needs.Nutrients {
		if nutrient.ID == "sodium" && (nutrient.Amount != 1500 || nutrient.Max == nil || *nutrient.Max != 2300) {
			t.Errorf("sodium = %+v", nutrient)
		}
	}
	if len(needs.Nutrients) != 17 {
		t.Errorf("%d nutrients, want 17", len(needs.Nutrients))
	}
}

func TestGasExchangeKeepsTheBVADRatios(t *testing.T) {
	use := DailyUse(person, phaseOf("custom", nil))
	near(t, "oxygen", use.OxygenUsedKg/use.FoodEnergyMJ, 0.816/12.59, 1e-12)
	near(t, "co2", use.CO2Kg/use.FoodEnergyMJ, 1.04/12.59, 1e-12)
	near(t, "heat", use.HeatMJ/use.FoodEnergyMJ, 12/12.59, 1e-12)
	near(t, "food", use.FoodKg/use.FoodEnergyMJ, 1.51/12.59*1.17, 1e-12)
}

func TestAnOpenLoopDayInsideSuppliesEverythingItUses(t *testing.T) {
	use := DailyUse(person, phaseOf("custom", nil))
	near(t, "water used", use.WaterUsedKg, 2.5+0.7, 1e-9)
	if use.WaterSupplyKg != use.WaterUsedKg || use.OxygenSupplyKg != use.OxygenUsedKg || use.EVAHours != 0 {
		t.Errorf("open loop day recycles or goes outside: %+v", use)
	}
	// 1080 W for a day is 25.92 kWh.
	near(t, "electricity", use.ElectricityMJ/3.6, 25.92, 1e-9)
}

func TestOneEVAHourADayAddsFoodSuitLossesAndDrinkingWater(t *testing.T) {
	inside := DailyUse(person, phaseOf("custom", nil))
	outside := DailyUse(person, phaseOf("custom", func(p *Phase) { p.EVAHoursPerWeek = 7 }))
	near(t, "hours", outside.EVAHours, 1, 1e-9)
	near(t, "food", (outside.FoodEnergyMJ-inside.FoodEnergyMJ)/kcalMJ, 200, 1e-6)
	near(t, "water", outside.WaterUsedKg-inside.WaterUsedKg, 0.24+0.625, 1e-9)
	near(t, "oxygen", outside.OxygenUsedKg-inside.OxygenUsedKg, 200*kcalMJ*(0.816/12.59)+0.092, 1e-9)
}

func TestEVAShareScalesOnePersonNotThePhase(t *testing.T) {
	phase := phaseOf("habitat", nil)
	stays, covers := person, person
	stays.EVAShare, covers.EVAShare = 0, 1.5
	near(t, "stays inside", DailyUse(stays, phase).EVAHours, 0, 0)
	near(t, "covers", DailyUse(covers, phase).EVAHours, 20.0/7*1.5, 1e-9)
}

func TestRecyclingCutsSupplyButNeverSuitLosses(t *testing.T) {
	use := DailyUse(person, phaseOf("habitat", nil))
	hours := 20.0 / 7
	cooling := 0.625 * hours
	near(t, "water", use.WaterSupplyKg, (use.WaterUsedKg-cooling)*0.02+cooling, 1e-9)
	suitOxygen := 0.092 * hours
	near(t, "oxygen", use.OxygenSupplyKg, (use.OxygenUsedKg-suitOxygen)*0.5+suitOxygen, 1e-9)
}

func TestAnAnalogHabitatShipsNoOxygen(t *testing.T) {
	near(t, "oxygen", DailyUse(person, phaseOf("analog", nil)).OxygenSupplyKg, 0, 0)
}

func TestMissionPlan(t *testing.T) {
	two := person
	two.Name, two.Sex, two.MassKg, two.HeightCm, two.EVAShare = "TWO", "female", 60, 165, 0
	mission := parse(t, object{"name": "T-1", "type": "lunar-outpost", "marginPercent": 50, "crew": []Astronaut{person, two}})
	plan := PlanMission(mission)

	var kinds []string
	for _, phase := range mission.Phases {
		kinds = append(kinds, phase.Kind)
	}
	if strings.Join(kinds, ",") != "transit,habitat,transit" || plan.Days != 228 {
		t.Errorf("phases %v over %d days, want the lunar outpost template over 228", kinds, plan.Days)
	}

	var byPhase, byCrew Resources
	for _, phase := range plan.Phases {
		byPhase.add(phase.Total, 1)
	}
	for _, member := range plan.Crew {
		byCrew.add(member.Total, 1)
	}
	near(t, "food by phase", byPhase.FoodKg, plan.Total.FoodKg, 1e-6)
	near(t, "food by crew", byCrew.FoodKg, plan.Total.FoodKg, 1e-6)
	near(t, "water by crew", byCrew.WaterSupplyKg, plan.Total.WaterSupplyKg, 1e-6)
	near(t, "oxygen by crew", byCrew.OxygenSupplyKg, plan.Total.OxygenSupplyKg, 1e-6)
	// Only the first crew member goes outside: 20 h a week for 30 weeks.
	near(t, "EVA hours", plan.Total.EVAHours, 600, 1e-6)

	near(t, "food with margin", plan.Provision.FoodKg, plan.Total.FoodKg*1.5, 1e-6)
	near(t, "water with margin", plan.Provision.WaterSupplyKg, plan.Total.WaterSupplyKg*1.5, 1e-6)
	near(t, "electricity with margin", plan.Provision.ElectricityMJ, plan.Total.ElectricityMJ*1.5, 1e-6)
}

func TestVehicleBaseLoadIsAddedOncePerPhaseNotPerPerson(t *testing.T) {
	plan := PlanMission(parse(t, object{"type": "orbital-station", "crew": []Astronaut{person}}))
	base := 18530.0 * 86400 * 180 / 1e6
	near(t, "electricity", plan.Total.ElectricityMJ, plan.Crew[0].Total.ElectricityMJ+base, 1e-3)
}

func TestParseMissionFillsDefaults(t *testing.T) {
	mission := parse(t, object{"type": "rover-traverse", "crew": []object{
		{"name": "A", "sex": "female", "age": 30, "massKg": 60, "heightCm": 165},
	}})
	a := mission.Crew[0]
	if mission.Name != "" || mission.MarginPercent != 40 || a.Role != "mission-specialist" || a.Activity != "active" || a.EVAShare != 1 {
		t.Errorf("defaults not filled: %+v", mission)
	}
	if mission.Sites == nil || mission.Tasks == nil {
		t.Error("sites and tasks must be empty lists, not null, in JSON")
	}
}

func TestParseMissionSnapsValuesToTheResolutionTheFileStores(t *testing.T) {
	mission := parse(t, object{
		"type":   "custom",
		"crew":   []object{{"name": "A", "sex": "male", "age": 30, "massKg": 70.04, "heightCm": 175, "evaShare": 0.333}},
		"phases": []object{{"kind": "custom", "days": 3, "evaHoursPerWeek": 10.2, "basePowerW": 1234}},
	})
	if a := mission.Crew[0]; a.MassKg != 70 || a.EVAShare != 0.33 {
		t.Errorf("crew = %+v", a)
	}
	if p := mission.Phases[0]; p.EVAHoursPerWeek != 10 || p.BasePowerW != 1230 {
		t.Errorf("phase = %+v", p)
	}
}

func TestParseMissionLooksCrewUpInARosterByName(t *testing.T) {
	roster := js(t, []Astronaut{person})
	mission, err := ParseMission(js(t, object{"type": "analog", "crew": []string{"TEST"}}), roster)
	if err != nil || mission.Crew[0] != person {
		t.Errorf("crew = %+v, err = %v", mission.Crew, err)
	}
	_, err = ParseMission(js(t, object{"type": "analog", "crew": []string{"NOBODY"}}), roster)
	if err == nil || err.Error() != `no "NOBODY" in the roster` {
		t.Errorf("err = %v", err)
	}
}

func TestParseAstronautValidatesOneProfile(t *testing.T) {
	got, err := ParseAstronaut([]byte(`{"name":"A","sex":"male","age":40,"massKg":80.04,"heightCm":180}`))
	want := Astronaut{"A", "male", 40, 80, 180, "mission-specialist", "active", 1}
	if err != nil || got != want {
		t.Errorf("got %+v, %v", got, err)
	}
	if _, err := ParseAstronaut([]byte(`{"name":""}`)); err == nil || err.Error() != "astronaut name must be 1 to 31 characters, got 0" {
		t.Errorf("err = %v", err)
	}
}

func TestParseMissionRejects(t *testing.T) {
	crew := []Astronaut{person}
	child, accented := person, person
	child.Age, accented.Name = 9, "Zoë"
	cases := []struct {
		name    string
		mission any
		want    string
	}{
		{"unknown type", object{"type": "venus", "crew": crew}, "mission type must be one of"},
		{"crew not a list", object{"type": "analog", "crew": "TEST"}, "crew must be a list of 0 to 255 entries"},
		{"custom without phases", object{"type": "custom", "crew": crew}, "a custom mission needs a list of phases"},
		{"same person twice", object{"type": "analog", "crew": []Astronaut{person, person}}, `"TEST" is in the crew twice`},
		{"child", object{"type": "analog", "crew": []Astronaut{child}}, "crew member 1 age must be a number from 18 to 99; got 9"},
		{"non-ASCII name", object{"type": "analog", "crew": []Astronaut{accented}}, "printable ASCII"},
		{"recovery above 1", object{"type": "custom", "crew": crew, "phases": []object{{"kind": "custom", "days": 1, "waterRecovery": 1.5}}},
			"phase 1 waterRecovery must be a number from 0 to 1; got 1.5"},
		{"zero days", object{"type": "custom", "crew": crew, "phases": []object{{"kind": "rover", "days": 0}}}, "phase 1 days must be"},
		{"missing mass", object{"type": "analog", "crew": []object{{"name": "A", "sex": "male", "age": 30, "heightCm": 170}}},
			"crew member 1 massKg must be a number from 30 to 250; got nothing"},
		{"not an object", "mars", "mission must be an object"},
		{"thin margin", object{"type": "analog", "marginPercent": 39, "crew": crew}, "marginPercent must be a number from 40 to 100; got 39"},
		{"margin over the top", object{"type": "analog", "marginPercent": 101, "crew": crew}, "marginPercent must be a number from 40 to 100; got 101"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { rejects(t, c.mission, c.want) })
	}
	if _, err := ParseMission([]byte("{"), nil); err == nil || err.Error() != "the mission is not valid JSON" {
		t.Errorf("broken JSON: %v", err)
	}
}

// 14 days at 7 h a week: 14 h of EVA for a full share, 7 h for a half.
func withTasks(tasks ...object) object {
	two := person
	two.Name, two.EVAShare = "TWO", 0.5
	return object{
		"type": "custom",
		"crew": []Astronaut{person, two},
		"phases": []object{
			{"kind": "habitat", "days": 14, "evaHoursPerWeek": 7},
			{"kind": "transit", "days": 10},
		},
		"sites": []object{{"name": "A", "lat": -4.5, "lon": 137.4}, {"name": "B", "lat": 18.4, "lon": 77.5}},
		"tasks": tasks,
	}
}

func TestTaskNamesResolveToPositions(t *testing.T) {
	mission := parse(t, withTasks(object{"site": "B", "phase": 0, "crew": "TWO", "kind": "drill", "hours": 2.2}))
	want := []Task{{Site: 1, Phase: 0, Crew: []int{1}, Kind: "drill", EVA: true, Hours: 2, Note: ""}}
	if !reflect.DeepEqual(mission.Tasks, want) {
		t.Errorf("tasks = %+v", mission.Tasks)
	}
}

func TestATaskCanHaveSeveralPeopleAndEachWorksItsHours(t *testing.T) {
	mission := parse(t, withTasks(
		object{"site": 0, "phase": 0, "crew": []any{"TWO", 0}, "kind": "sample", "hours": 4},
		object{"site": 0, "phase": 0, "crew": []any{}, "kind": "image", "hours": 6},
	))
	if !reflect.DeepEqual(mission.Tasks[0].Crew, []int{0, 1}) || len(mission.Tasks[1].Crew) != 0 {
		t.Errorf("crew = %v, %v", mission.Tasks[0].Crew, mission.Tasks[1].Crew)
	}
	plan := PlanMission(mission)
	if plan.Crew[0].TaskHours.EVA != 4 || plan.Crew[1].TaskHours.EVA != 4 || plan.UnassignedTaskHours != 6 {
		t.Errorf("task hours = %+v, %+v, unassigned %v", plan.Crew[0].TaskHours, plan.Crew[1].TaskHours, plan.UnassignedTaskHours)
	}

	_, err := ParseMission(js(t, withTasks(object{"site": 0, "phase": 0, "crew": []any{0, "TEST"}, "kind": "sample", "hours": 4})), nil)
	if err == nil || !strings.Contains(err.Error(), "task 1 crew lists the same person twice") {
		t.Errorf("the same person twice: %v", err)
	}
}

func TestTaskHoursAddUpPerPersonOutsideAndInside(t *testing.T) {
	plan := PlanMission(parse(t, withTasks(
		object{"site": 0, "phase": 0, "crew": 0, "kind": "sample", "hours": 5},
		object{"site": 1, "phase": 0, "crew": 0, "kind": "survey", "hours": 4},
		object{"site": 0, "phase": 0, "crew": 0, "kind": "other", "hours": 3, "eva": false},
		object{"site": 0, "phase": 0, "kind": "image", "hours": 6},
	)))
	if plan.Crew[0].TaskHours != (TaskHours{9, 3}) || plan.Crew[1].TaskHours != (TaskHours{}) {
		t.Errorf("task hours = %+v, %+v", plan.Crew[0].TaskHours, plan.Crew[1].TaskHours)
	}
	if plan.UnassignedTaskHours != 6 || len(plan.EVAOverruns) != 0 {
		t.Errorf("unassigned %v, overruns %v", plan.UnassignedTaskHours, plan.EVAOverruns)
	}
}

func TestEVATasksBeyondThePhaseHoursAreReported(t *testing.T) {
	mission := parse(t, withTasks(
		object{"site": 0, "phase": 0, "crew": 0, "kind": "sample", "hours": 14},
		object{"site": 0, "phase": 0, "crew": 1, "kind": "sample", "hours": 7.5},
		// No EVA at all in transit.
		object{"site": 1, "phase": 1, "crew": 0, "kind": "repair", "hours": 1},
		// Inside work never counts against EVA hours.
		object{"site": 1, "phase": 1, "crew": 1, "kind": "other", "hours": 50, "eva": false},
	))
	plan := PlanMission(mission)
	if len(plan.EVAOverruns) != 2 {
		t.Fatalf("overruns = %+v", plan.EVAOverruns)
	}
	first, second := plan.EVAOverruns[0], plan.EVAOverruns[1]
	if first.Crew != 1 || first.Phase != 0 || first.PlannedHours != 7.5 || math.Abs(first.BudgetHours-7) > 1e-9 {
		t.Errorf("first = %+v", first)
	}
	if second.Crew != 0 || second.Phase != 1 || second.PlannedHours != 1 || second.BudgetHours != 0 {
		t.Errorf("second = %+v", second)
	}
	cautions := Cautions(mission, plan)
	want := "TWO has 7.5 h of EVA tasks in phase 1 but only 7.0 h of EVA there. Supplies cover the lower figure."
	if len(cautions) != 2 || cautions[0] != want {
		t.Errorf("cautions = %q", cautions)
	}
}

func TestCautionsListUnassignedHoursAndStayEmptyOtherwise(t *testing.T) {
	mission := parse(t, withTasks(object{"site": 0, "phase": 0, "kind": "image", "hours": 6}))
	got := Cautions(mission, PlanMission(mission))
	if len(got) != 1 || got[0] != "6.0 h of tasks have nobody assigned." {
		t.Errorf("cautions = %q", got)
	}
	clean := parse(t, withTasks())
	if got := Cautions(clean, PlanMission(clean)); got == nil || len(got) != 0 {
		t.Errorf("cautions = %#v, want an empty list", got)
	}
}

func TestTasksDoNotChangeConsumables(t *testing.T) {
	without := PlanMission(parse(t, withTasks()))
	with := PlanMission(parse(t, withTasks(object{"site": 0, "phase": 0, "crew": 0, "kind": "sample", "hours": 10})))
	if with.Total != without.Total {
		t.Error("a task changed the supply totals")
	}
}

func TestParseMissionRejectsBadTasksAndSites(t *testing.T) {
	cases := []struct {
		name string
		task object
		want string
	}{
		{"unknown site name", object{"site": "C", "phase": 0, "kind": "sample", "hours": 1}, `task 1 site must point at one of 2 entries; got "C"`},
		{"site out of range", object{"site": 2, "phase": 0, "kind": "sample", "hours": 1}, "task 1 site must point at one of 2 entries"},
		{"phase out of range", object{"site": 0, "phase": 2, "kind": "sample", "hours": 1}, "task 1 phase must point at one of 2 entries"},
		{"phase by name", object{"site": 0, "phase": "", "kind": "sample", "hours": 1}, "task 1 phase must point at one of 2 entries"},
		{"unknown crew", object{"site": 0, "phase": 0, "crew": "NOBODY", "kind": "sample", "hours": 1}, "task 1 crew must point at one of 2 entries"},
		{"unknown kind", object{"site": 0, "phase": 0, "kind": "nap", "hours": 1}, "task 1 kind must be one of"},
		{"no hours", object{"site": 0, "phase": 0, "kind": "sample", "hours": 0}, "task 1 hours must be a number from 0.5"},
		{"eva as text", object{"site": 0, "phase": 0, "kind": "sample", "hours": 1, "eva": "yes"}, "task 1 eva must be true or false"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { rejects(t, withTasks(c.task), c.want) })
	}
	bad := withTasks()
	bad["sites"] = []object{{"name": "A", "lat": 91, "lon": 0}}
	rejects(t, bad, "site 1 lat must be a number from -90 to 90")
	bad["sites"] = []object{{"name": "A", "lat": 0, "lon": 0}, {"name": "A", "lat": 1, "lon": 1}}
	rejects(t, bad, `"A" is in the sites twice`)
}

func TestNormalizeChecksAMissionBuiltInGo(t *testing.T) {
	mission := parse(t, withTasks())
	mission.Crew[0].MassKg = 70.04
	normal, err := Normalize(mission)
	if err != nil || normal.Crew[0].MassKg != 70 {
		t.Errorf("normalize: %+v, %v", normal.Crew[0], err)
	}
	mission.Crew[0].Age = 9
	if _, err := Normalize(mission); err == nil {
		t.Error("an out-of-range age passed")
	}
}

func TestReportFormatting(t *testing.T) {
	for value, want := range map[float64]string{0: "0", 999: "999", 1000: "1,000", 164229.4: "164,229", -1234567: "-1,234,567"} {
		if got := num(value, 0); got != want {
			t.Errorf("num(%v) = %q, want %q", value, got, want)
		}
	}
	if got := num(1234.567, 2); got != "1,234.57" {
		t.Errorf("num with decimals = %q", got)
	}
	if got := FormatCoordinates(-4.5895, -222.5583); got != "4.5895°S 137.4417°E" {
		t.Errorf("coordinates = %q", got)
	}
	if !strings.Contains(FormatTypes(), "mars-long-stay") {
		t.Error("types listing misses a mission type")
	}
}

func TestDoseAddsEachPhaseAtItsRate(t *testing.T) {
	// Lunar outpost: 9 + 9 days in transit, 210 on the Moon.
	plan := PlanMission(parse(t, object{"type": "lunar-outpost", "crew": []Astronaut{person}}))
	near(t, "lunar dose", plan.Crew[0].DoseSv, 18*TransitDoseSvPerDay+210*MoonSurfaceDoseSvPerDay, 1e-9)
	if plan.DoseUnknownDays != 0 || plan.DoseLimitSv != 0.6 {
		t.Errorf("unknown %d days, limit %v", plan.DoseUnknownDays, plan.DoseLimitSv)
	}

	// The same habitat phase on Mars uses the Mars rate.
	mars := PlanMission(parse(t, object{"type": "mars-long-stay", "crew": []Astronaut{person}}))
	near(t, "mars dose", mars.Crew[0].DoseSv, 360*TransitDoseSvPerDay+600*MarsSurfaceDoseSvPerDay, 1e-9)
	if lines := Cautions(parse(t, object{"type": "mars-long-stay", "crew": []Astronaut{person}}), mars); len(lines) != 1 || !strings.Contains(lines[0], "600 mSv career limit") {
		t.Errorf("cautions %v, want the career limit", lines)
	}
}

func TestCustomPhasesAreLeftOutOfTheDoseAndSaidSo(t *testing.T) {
	mission := parse(t, object{"type": "custom", "crew": []Astronaut{person}, "phases": []object{{"kind": "custom", "days": 12}}})
	plan := PlanMission(mission)
	if plan.Crew[0].DoseSv != 0 || plan.DoseUnknownDays != 12 {
		t.Errorf("dose %v, unknown %d days", plan.Crew[0].DoseSv, plan.DoseUnknownDays)
	}
	if lines := Cautions(mission, plan); len(lines) != 1 || !strings.Contains(lines[0], "no radiation rate") {
		t.Errorf("cautions %v", lines)
	}
}

func TestAMissionWithNobodyPickedYetPlansToZero(t *testing.T) {
	mission, err := ParseMission([]byte(`{"type": "analog", "crew": []}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	plan := PlanMission(mission)
	if len(plan.Crew) != 0 || plan.Total.FoodKg != 0 || plan.Total.EVAHours != 0 {
		t.Errorf("crew %d, food %v kg, EVA %v h", len(plan.Crew), plan.Total.FoodKg, plan.Total.EVAHours)
	}
	if _, err := DecodeMission(encode(t, mission)); err != nil {
		t.Errorf("a file with no crew does not read back: %v", err)
	}
	// The editor maps over the list, so it must arrive as [], not null.
	if data, _ := json.Marshal(plan); !strings.Contains(string(data), `"crew":[]`) {
		t.Errorf("plan JSON has no empty crew list: %.120s", data)
	}
}
