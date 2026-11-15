package planner

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

const mjPerKWh = 3.6

// num formats a number with thousands separators and a fixed number of decimals.
func num(value float64, digits int) string {
	scale := math.Pow(10, float64(digits))
	text := strconv.FormatFloat(math.Round(value*scale)/scale, 'f', digits, 64)
	whole, fraction, _ := strings.Cut(text, ".")
	sign := ""
	if strings.HasPrefix(whole, "-") {
		sign, whole = "-", whole[1:]
	}
	var grouped strings.Builder
	for i, digit := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			grouped.WriteByte(',')
		}
		grouped.WriteRune(digit)
	}
	if fraction != "" {
		return sign + grouped.String() + "." + fraction
	}
	return sign + grouped.String()
}

func kcal(megajoules float64) float64 { return megajoules * 1000 / KJPerKcal }
func percent(share float64) string    { return fmt.Sprintf("%.0f%%", share*100) }
func span(r Range) string             { return num(r.Min, 0) + "-" + num(r.Max, 0) }

// FormatCoordinates writes a position the way Mars maps do, with east
// longitude from 0 to 360.
func FormatCoordinates(lat, lon float64) string {
	east := math.Mod(math.Mod(lon, 360)+360, 360)
	hemisphere := "N"
	if lat < 0 {
		hemisphere = "S"
	}
	return fmt.Sprintf("%.4f°%s %.4f°E", math.Abs(lat), hemisphere, east)
}

// Cautions lists the things in the plan that do not add up, as sentences for
// a person to act on.
func Cautions(mission Mission, plan Plan) []string {
	lines := []string{}
	for _, over := range plan.EVAOverruns {
		lines = append(lines, fmt.Sprintf(
			"%s has %s h of EVA tasks in phase %d but only %s h of EVA there. Supplies cover the lower figure.",
			mission.Crew[over.Crew].Name, num(over.PlannedHours, 1), over.Phase+1, num(over.BudgetHours, 1)))
	}
	if plan.UnassignedTaskHours > 0 {
		lines = append(lines, num(plan.UnassignedTaskHours, 1)+" h of tasks have nobody assigned.")
	}
	// Everyone on board gets the same dose, so one line per dose, not per person.
	var doses []string
	over := map[string][]string{}
	for _, member := range plan.Crew {
		if member.DoseSv > plan.DoseLimitSv {
			dose := num(member.DoseSv*1000, 0)
			if _, seen := over[dose]; !seen {
				doses = append(doses, dose)
			}
			over[dose] = append(over[dose], member.Name)
		}
	}
	for _, dose := range doses {
		lines = append(lines, fmt.Sprintf(
			"%s would get about %s mSv on a quiet sun, over the %s mSv career limit before any earlier missions. Shorten the stay or add shielding.",
			strings.Join(over[dose], ", "), dose, num(plan.DoseLimitSv*1000, 0)))
	}
	if plan.DoseUnknownDays > 0 && len(plan.Crew) > 0 {
		lines = append(lines, fmt.Sprintf(
			"%s days are in custom phases with no radiation rate, so the dose leaves them out. Set the phase kind to count them.",
			num(float64(plan.DoseUnknownDays), 0)))
	}
	return lines
}

// table left-aligns the leading text columns and right-aligns the numbers after.
func table(rows [][]string, textColumns int) string {
	widths := make([]int, len(rows[0]))
	for _, row := range rows {
		for col, cell := range row {
			widths[col] = max(widths[col], utf8.RuneCountInString(cell))
		}
	}
	lines := make([]string, len(rows))
	for i, row := range rows {
		cells := make([]string, len(row))
		for col, cell := range row {
			padding := strings.Repeat(" ", widths[col]-utf8.RuneCountInString(cell))
			if col < textColumns {
				cells[col] = cell + padding
			} else {
				cells[col] = padding + cell
			}
		}
		lines[i] = "  " + strings.TrimRight(strings.Join(cells, "  "), " ")
	}
	return strings.Join(lines, "\n")
}

func formatDuration(seconds float64) string {
	switch {
	case seconds < 1:
		return num(seconds*1000, 0) + " ms"
	case seconds < 120:
		return num(seconds, 1) + " s"
	}
	return num(seconds/60, 1) + " min"
}

var paramHeadings = []string{"EVA/wk", "water", "oxygen", "hygiene", "base", "per crew"}

func phaseParams(p PhaseParams) []string {
	return []string{
		num(p.EVAHoursPerWeek, 1) + " h",
		percent(p.WaterRecovery),
		percent(p.OxygenRecovery),
		num(p.HygieneWaterKg, 2) + " kg",
		num(p.BasePowerW/1000, 2) + " kW",
		num(p.CrewPowerW/1000, 2) + " kW",
	}
}

// FormatTypes lists the mission types and what each phase kind assumes.
func FormatTypes() string {
	var types []string
	for _, id := range MissionTypes {
		template := MissionTemplates[id]
		phases := make([]string, len(template.Phases))
		for i, phase := range template.Phases {
			phases[i] = fmt.Sprintf("%s %d d", phase.Kind, phase.Days)
		}
		list := strings.Join(phases, ", ")
		if list == "" {
			list = "phases: yours"
		}
		types = append(types, fmt.Sprintf("  %s\n    %s\n    %s", id, template.Summary, list))
	}
	var kinds []string
	presets := [][]string{append([]string{"kind"}, paramHeadings...)}
	for _, kind := range PhaseKinds {
		kinds = append(kinds, fmt.Sprintf("  %-8s %s", kind, PhasePresets[kind].Summary))
		presets = append(presets, append([]string{kind}, phaseParams(PhasePresets[kind].PhaseParams)...))
	}
	return strings.Join([]string{
		"MISSION TYPES",
		strings.Join(types, "\n\n"),
		"",
		"PHASE KINDS",
		strings.Join(kinds, "\n"),
		"",
		"PHASE PRESETS  (recovery = share recycled; water and power per crewmember per day)",
		table(presets, 1),
		"",
		"Any phase can override: " + strings.Join(ParamKeys(), ", ") + ".",
	}, "\n")
}

// FormatPacket shows the size of the file, its bytes, and how long it takes
// to reach Curiosity.
func FormatPacket(data []byte, mission Mission) string {
	var lines []string
	for i := 0; i < len(data); i += 16 {
		row := make([]string, 0, 16)
		for _, b := range data[i:min(i+16, len(data))] {
			row = append(row, fmt.Sprintf("%02x", b))
		}
		lines = append(lines, fmt.Sprintf("  %04x  %s", i, strings.Join(row, " ")))
	}
	asJSON, _ := json.Marshal(mission)
	var links [][]string
	for _, link := range LinkEstimates(len(data)) {
		links = append(links, []string{link.Label, num(float64(link.BitsPerSecond), 0) + " bit/s", formatDuration(link.Seconds)})
	}
	return strings.Join([]string{
		fmt.Sprintf("PACKET  %d bytes  (same mission as JSON: %s bytes, %sx larger)",
			len(data), num(float64(len(asJSON)), 0), num(float64(len(asJSON))/float64(len(data)), 1)),
		strings.Join(lines, "\n"),
		"",
		"TIME TO REACH CURIOSITY  (file bits only, before coding and framing)",
		table(links, 1),
		fmt.Sprintf("  %s%% of the 225 kbit daily command session", num(ShareOfDailyCommands(len(data))*100, 2)),
	}, "\n")
}

// FormatPlan writes the plan as text for a terminal. detail adds nutrient
// targets and totals per crew member.
func FormatPlan(mission Mission, plan Plan, detail bool) string {
	name := mission.Name
	if name == "" {
		name = "UNNAMED"
	}
	title := fmt.Sprintf("%s  %s  %s days  %d crew  margin %d%%",
		name, mission.Type, num(float64(plan.Days), 0), len(mission.Crew), plan.MarginPercent)

	phases := [][]string{append([]string{"phase", "days"}, paramHeadings...)}
	for i, phase := range mission.Phases {
		row := []string{fmt.Sprintf("%d %s", i+1, phase.Kind), num(float64(phase.Days), 0)}
		phases = append(phases, append(row, phaseParams(phase.PhaseParams)...))
	}

	crew := [][]string{{"name", "role", "kcal", "protein g", "carbs g", "fat g", "fluid L"}}
	for i, person := range mission.Crew {
		daily := plan.Crew[i].Daily
		crew = append(crew, []string{
			person.Name, person.Role, num(kcal(daily.FoodEnergyMJ), 0),
			span(daily.ProteinG), span(daily.CarbohydrateG), span(daily.FatG), num(daily.FluidL, 1),
		})
	}

	t, p := plan.Total, plan.Provision
	kwh := func(megajoules float64) string { return num(megajoules/mjPerKWh, 0) + " kWh" }
	kg := func(mass float64) string { return num(mass, 0) + " kg" }
	averageHeatW := t.HeatMJ * 1e6 / (float64(plan.Days) * secondsPerDay)
	totals := table([][]string{
		{"", "used", "to supply", fmt.Sprintf("with %d%% margin", plan.MarginPercent)},
		{"Food energy", "", num(kcal(t.FoodEnergyMJ)/1e6, 2) + " Gcal", num(kcal(p.FoodEnergyMJ)/1e6, 2) + " Gcal"},
		{"Food, packaged", "", kg(t.FoodKg), kg(p.FoodKg)},
		{"Water", kg(t.WaterUsedKg), kg(t.WaterSupplyKg), kg(p.WaterSupplyKg)},
		{"Oxygen", kg(t.OxygenUsedKg), kg(t.OxygenSupplyKg), kg(p.OxygenSupplyKg)},
		{"Electricity", "", kwh(t.ElectricityMJ), kwh(p.ElectricityMJ)},
		{"Carbon dioxide to remove", kg(t.CO2Kg), "", ""},
		{"Body heat to reject", num(t.HeatMJ, 0) + " MJ", "avg " + num(averageHeatW, 0) + " W", ""},
		{"EVA", num(t.EVAHours, 0) + " h", "", ""},
	}, 1)

	perPhase := [][]string{{"phase", "food kg", "water kg", "oxygen kg", "power kWh", "EVA h"}}
	for i, phase := range plan.Phases {
		perPhase = append(perPhase, []string{
			fmt.Sprintf("%d %s", i+1, phase.Kind),
			num(phase.Total.FoodKg, 0), num(phase.Total.WaterSupplyKg, 0), num(phase.Total.OxygenSupplyKg, 0),
			num(phase.Total.ElectricityMJ/mjPerKWh, 0), num(phase.Total.EVAHours, 0),
		})
	}

	sections := []string{
		title, "",
		"PHASES", table(phases, 1), "",
		"CREW, PER DAY INSIDE  (each EVA hour adds 200 kcal)", table(crew, 2), "",
		"MISSION TOTALS", totals, "",
		"TO SUPPLY, BY PHASE  (before margin)", table(perPhase, 1),
	}

	if len(mission.Sites) > 0 {
		sites := [][]string{{"site", "planetocentric latitude, east longitude"}}
		for _, site := range mission.Sites {
			sites = append(sites, []string{site.Name, FormatCoordinates(site.Lat, site.Lon)})
		}
		sections = append(sections, "", "SITES", table(sites, 2))
	}
	if len(mission.Tasks) > 0 {
		tasks := [][]string{{"site", "task", "who", "where", "phase", "hours"}}
		for _, task := range mission.Tasks {
			what, who, where := task.Kind, "nobody", "inside"
			if task.Note != "" {
				what += ": " + task.Note
			}
			if len(task.Crew) > 0 {
				names := make([]string, len(task.Crew))
				for i, person := range task.Crew {
					names[i] = mission.Crew[person].Name
				}
				who = strings.Join(names, ", ")
			}
			if task.EVA {
				where = "EVA"
			}
			tasks = append(tasks, []string{
				mission.Sites[task.Site].Name, what, who, where,
				fmt.Sprintf("%d %s", task.Phase+1, mission.Phases[task.Phase].Kind), num(task.Hours, 1) + " h",
			})
		}
		sections = append(sections, "", "TASKS", table(tasks, 5))
	}
	if warnings := Cautions(mission, plan); len(warnings) > 0 {
		sections = append(sections, "", "CAUTIONS")
		for _, warning := range warnings {
			sections = append(sections, "  "+warning)
		}
	}

	if detail {
		header := []string{"per day"}
		for _, person := range mission.Crew {
			header = append(header, person.Name)
		}
		nutrients := [][]string{header}
		for row, nutrient := range plan.Crew[0].Daily.Nutrients {
			line := []string{nutrient.Label + ", " + nutrient.Unit}
			for _, member := range plan.Crew {
				n := member.Daily.Nutrients[row]
				if n.Max == nil {
					line = append(line, strconv.FormatFloat(n.Amount, 'f', -1, 64))
				} else {
					line = append(line, num(n.Amount, 0)+"-"+num(*n.Max, 0))
				}
			}
			nutrients = append(nutrients, line)
		}
		perCrew := [][]string{{"mission total", "food kg", "water kg", "oxygen kg", "CO2 kg", "EVA h", "dose mSv"}}
		for _, member := range plan.Crew {
			perCrew = append(perCrew, []string{
				member.Name, num(member.Total.FoodKg, 0), num(member.Total.WaterSupplyKg, 0),
				num(member.Total.OxygenSupplyKg, 0), num(member.Total.CO2Kg, 0), num(member.Total.EVAHours, 0), num(member.DoseSv*1000, 0),
			})
		}
		sections = append(sections, "", "NUTRIENT TARGETS", table(nutrients, 1),
			"", "TO SUPPLY, BY CREW MEMBER  (before margin)", table(perCrew, 1))
	}

	var noBaseLoad []string
	for _, phase := range mission.Phases {
		if phase.BasePowerW == 0 && !slices.Contains(noBaseLoad, phase.Kind) {
			noBaseLoad = append(noBaseLoad, phase.Kind)
		}
	}
	sections = append(sections, "")
	if len(noBaseLoad) > 0 {
		sections = append(sections, fmt.Sprintf(
			"  Electricity for %s covers life support and crew equipment only. Set basePowerW to add the vehicle's own load.",
			strings.Join(noBaseLoad, ", ")))
	}
	sections = append(sections, "  Rates come from NASA documents listed in the README. Treat the result as a planning estimate.")
	return strings.Join(sections, "\n")
}
