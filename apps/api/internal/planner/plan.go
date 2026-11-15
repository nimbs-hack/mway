package planner

import (
	"math"
	"strings"
)

const secondsPerDay = 86400

type Range struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

type Nutrient struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Unit   string  `json:"unit"`
	Amount float64 `json:"amount"`
	// Set where the requirement is a range.
	Max *float64 `json:"max,omitempty"`
}

// DailyNeeds is one person's needs for a day spent inside. EVA adds to these.
type DailyNeeds struct {
	FoodEnergyMJ  float64    `json:"foodEnergyMJ"`
	ProteinG      Range      `json:"proteinG"`
	CarbohydrateG Range      `json:"carbohydrateG"`
	FatG          Range      `json:"fatG"`
	FluidL        float64    `json:"fluidL"`
	Nutrients     []Nutrient `json:"nutrients"`
}

// EnergyRequirementMJ is the Estimated Energy Requirement, in megajoules per day.
func EnergyRequirementMJ(person Astronaut) float64 {
	c := eer[person.Sex]
	activity := activityFactor[person.Sex][person.Activity]
	kcal := c.base - c.perYear*float64(person.Age) +
		activity*(c.perKg*person.MassKg+c.perMetre*float64(person.HeightCm)/100)
	return kcal * KJPerKcal / 1000
}

func fluidRequirementL(person Astronaut) float64 {
	return math.Max(FluidLPerKg*person.MassKg, fluidFloorL[person.Sex])
}

func NeedsPerDay(person Astronaut) DailyNeeds {
	energy := EnergyRequirementMJ(person)
	kcal := energy * 1000 / KJPerKcal
	needs := DailyNeeds{
		FoodEnergyMJ:  energy,
		ProteinG:      Range{proteinMinGPerKg * person.MassKg, proteinMaxGPerKg * person.MassKg},
		CarbohydrateG: Range{kcal * carbohydrateMinShare / kcalPerGCarbohydrate, kcal * carbohydrateMaxShare / kcalPerGCarbohydrate},
		FatG:          Range{kcal * fatMinShare / kcalPerGFat, kcal * fatMaxShare / kcalPerGFat},
		FluidL:        fluidRequirementL(person),
	}
	for _, target := range nutrientTargets {
		nutrient := Nutrient{ID: target.id, Label: target.label, Unit: target.unit, Amount: target.female}
		if person.Sex == "male" {
			nutrient.Amount = target.male
		}
		if target.max > 0 {
			max := target.max
			nutrient.Max = &max
		}
		needs.Nutrients = append(needs.Nutrients, nutrient)
	}
	return needs
}

// Resources are amounts over some span of time. Mass in kilograms, energy in
// megajoules. "Used" is what passes through the crew; "supply" is what is
// left to bring after recycling.
type Resources struct {
	FoodEnergyMJ float64 `json:"foodEnergyMJ"`
	// With packaging.
	FoodKg         float64 `json:"foodKg"`
	WaterUsedKg    float64 `json:"waterUsedKg"`
	WaterSupplyKg  float64 `json:"waterSupplyKg"`
	OxygenUsedKg   float64 `json:"oxygenUsedKg"`
	OxygenSupplyKg float64 `json:"oxygenSupplyKg"`
	// Carbon dioxide the crew breathes out and the vehicle has to remove.
	CO2Kg float64 `json:"co2Kg"`
	// Body heat the vehicle has to reject.
	HeatMJ        float64 `json:"heatMJ"`
	ElectricityMJ float64 `json:"electricityMJ"`
	EVAHours      float64 `json:"evaHours"`
}

func (r *Resources) add(amount Resources, times float64) {
	r.FoodEnergyMJ += amount.FoodEnergyMJ * times
	r.FoodKg += amount.FoodKg * times
	r.WaterUsedKg += amount.WaterUsedKg * times
	r.WaterSupplyKg += amount.WaterSupplyKg * times
	r.OxygenUsedKg += amount.OxygenUsedKg * times
	r.OxygenSupplyKg += amount.OxygenSupplyKg * times
	r.CO2Kg += amount.CO2Kg * times
	r.HeatMJ += amount.HeatMJ * times
	r.ElectricityMJ += amount.ElectricityMJ * times
	r.EVAHours += amount.EVAHours * times
}

// Provision is the part of Resources that someone has to bring or generate.
type Provision struct {
	FoodEnergyMJ   float64 `json:"foodEnergyMJ"`
	FoodKg         float64 `json:"foodKg"`
	WaterSupplyKg  float64 `json:"waterSupplyKg"`
	OxygenSupplyKg float64 `json:"oxygenSupplyKg"`
	ElectricityMJ  float64 `json:"electricityMJ"`
}

type TaskHours struct {
	EVA    float64 `json:"eva"`
	Inside float64 `json:"inside"`
}

type CrewPlan struct {
	Name  string     `json:"name"`
	Daily DailyNeeds `json:"daily"`
	// Electricity here is this person's share of life support and crew
	// equipment. The vehicle base load is in the phase and mission totals.
	Total Resources `json:"total"`
	// Hours of assigned tasks, outside and inside.
	TaskHours TaskHours `json:"taskHours"`
	// Mission radiation dose equivalent, quiet sun, in sieverts. Phases with
	// no known rate add nothing; see Plan.DoseUnknownDays.
	DoseSv float64 `json:"doseSv"`
}

type PhasePlan struct {
	Kind  string    `json:"kind"`
	Days  int       `json:"days"`
	Total Resources `json:"total"`
}

// EVAOverrun is someone having more EVA task hours in a phase than the phase
// gives them.
type EVAOverrun struct {
	Crew         int     `json:"crew"`
	Phase        int     `json:"phase"`
	PlannedHours float64 `json:"plannedHours"`
	BudgetHours  float64 `json:"budgetHours"`
}

type Plan struct {
	Days          int         `json:"days"`
	Crew          []CrewPlan  `json:"crew"`
	Phases        []PhasePlan `json:"phases"`
	Total         Resources   `json:"total"`
	MarginPercent int         `json:"marginPercent"`
	// The mission total with the margin added.
	Provision Provision `json:"provision"`
	// Hours of tasks nobody is assigned to yet.
	UnassignedTaskHours float64 `json:"unassignedTaskHours"`
	// Consumables follow each phase's EVA hours, not the task list, so tasks
	// that exceed those hours would be planned without the supplies for them.
	EVAOverruns []EVAOverrun `json:"evaOverruns"`
	// Days in phases with no dose rate, left out of every DoseSv.
	DoseUnknownDays int `json:"doseUnknownDays"`
	// The career limit DoseSv is checked against.
	DoseLimitSv float64 `json:"doseLimitSv"`
}

// DoseRate is the dose equivalent per day for a phase of a mission, and false
// where nothing is known. Surface phases are on the Moon for lunar mission
// types and on Mars otherwise, since sites are on Mars. The rate is the
// unshielded surface value, so habitat time is an upper bound.
func DoseRate(missionType, phaseKind string) (float64, bool) {
	surface := MarsSurfaceDoseSvPerDay
	if strings.HasPrefix(missionType, "lunar-") {
		surface = MoonSurfaceDoseSvPerDay
	}
	switch phaseKind {
	case "transit":
		return TransitDoseSvPerDay, true
	case "station":
		return StationDoseSvPerDay, true
	case "lander", "habitat", "rover":
		return surface, true
	case "analog":
		return EarthDoseSvPerDay, true
	}
	return 0, false
}

// DailyUse is one person's needs for one day of a phase.
func DailyUse(person Astronaut, phase Phase) Resources {
	evaHours := phase.EVAHoursPerWeek / 7 * person.EVAShare
	energy := EnergyRequirementMJ(person) + EVAFoodMJPerHour*evaHours

	// Gas exchange and heat follow the energy the body burns.
	breathed := energy * OxygenKgPerMJ
	suitOxygen := EVAOxygenLossKgPerHour * evaHours

	drunk := math.Max(PotableWaterKgPerDay, fluidRequirementL(person)) + EVADrinkKgPerHour*evaHours
	// Water that comes back as urine, sweat, breath or wash water.
	recyclable := drunk + phase.HygieneWaterKg
	suitCooling := EVACoolingWaterKgPerHour * evaHours

	return Resources{
		FoodEnergyMJ:   energy,
		FoodKg:         energy * FoodKgPerMJ * (1 + FoodPackagingFraction),
		WaterUsedKg:    recyclable + suitCooling,
		WaterSupplyKg:  recyclable*(1-phase.WaterRecovery) + suitCooling,
		OxygenUsedKg:   breathed + suitOxygen,
		OxygenSupplyKg: breathed*(1-phase.OxygenRecovery) + suitOxygen,
		CO2Kg:          energy * CO2KgPerMJ,
		HeatMJ:         energy * HeatMJPerMJ,
		ElectricityMJ:  phase.CrewPowerW * secondsPerDay / 1e6,
		EVAHours:       evaHours,
	}
}

// PlanMission works out the mission's needs. The mission must have come from
// ParseMission, Normalize or DecodeMission.
func PlanMission(mission Mission) Plan {
	// Empty lists, not nil, so a mission with nobody on it yet sends [] and
	// not null.
	plan := Plan{MarginPercent: mission.MarginPercent, Crew: []CrewPlan{}, EVAOverruns: []EVAOverrun{}, DoseLimitSv: CareerDoseLimitSv}
	for _, person := range mission.Crew {
		plan.Crew = append(plan.Crew, CrewPlan{Name: person.Name, Daily: NeedsPerDay(person)})
	}

	for _, phase := range mission.Phases {
		days := float64(phase.Days)
		var total Resources
		for i, person := range mission.Crew {
			perDay := DailyUse(person, phase)
			plan.Crew[i].Total.add(perDay, days)
			total.add(perDay, days)
		}
		total.ElectricityMJ += phase.BasePowerW * secondsPerDay * days / 1e6
		if rate, ok := DoseRate(mission.Type, phase.Kind); ok {
			for i := range plan.Crew {
				plan.Crew[i].DoseSv += rate * days
			}
		} else {
			plan.DoseUnknownDays += phase.Days
		}
		plan.Total.add(total, 1)
		plan.Phases = append(plan.Phases, PhasePlan{Kind: phase.Kind, Days: phase.Days, Total: total})
		plan.Days += phase.Days
	}

	factor := 1 + float64(mission.MarginPercent)/100
	plan.Provision = Provision{
		FoodEnergyMJ:   plan.Total.FoodEnergyMJ * factor,
		FoodKg:         plan.Total.FoodKg * factor,
		WaterSupplyKg:  plan.Total.WaterSupplyKg * factor,
		OxygenSupplyKg: plan.Total.OxygenSupplyKg * factor,
		ElectricityMJ:  plan.Total.ElectricityMJ * factor,
	}

	// EVA task hours per person and phase, in the order tasks first mention them.
	type slot struct{ crew, phase int }
	planned := map[slot]float64{}
	var order []slot
	for _, task := range mission.Tasks {
		if len(task.Crew) == 0 {
			plan.UnassignedTaskHours += task.Hours
			continue
		}
		// Everyone on a task works its full length.
		for _, person := range task.Crew {
			hours := &plan.Crew[person].TaskHours
			if !task.EVA {
				hours.Inside += task.Hours
				continue
			}
			hours.EVA += task.Hours
			key := slot{person, task.Phase}
			if _, seen := planned[key]; !seen {
				order = append(order, key)
			}
			planned[key] += task.Hours
		}
	}
	for _, key := range order {
		phase := mission.Phases[key.phase]
		budget := DailyUse(mission.Crew[key.crew], phase).EVAHours * float64(phase.Days)
		if planned[key] > budget+1e-9 {
			plan.EVAOverruns = append(plan.EVAOverruns, EVAOverrun{key.crew, key.phase, planned[key], budget})
		}
	}
	return plan
}
