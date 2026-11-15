// Package planner works out what a crew needs for a mission: food energy and
// nutrients, water, oxygen and electricity, plus the carbon dioxide and body
// heat the vehicle has to deal with. It also reads and writes the mission
// file, a single CCSDS Space Packet.
package planner

// Every rate the planner uses, with where it comes from. Nothing here is
// measured by us. Values marked ASSUMED have no published source behind them
// and are planning choices.
//
// BVAD     NASA Life Support Baseline Values and Assumptions Document,
//          NASA/TP-2015-218570/REV1, January 2018.
// STD-3001 NASA-STD-3001 Volume 2, Revision F, approved 2026-07-14. Requirement
//          numbers such as [V2 7003] are the same in every revision.
// HASF     Smith, Zwart, Douglas, Heer. Human Adaptation to Spaceflight: The
//          Role of Food and Nutrition, 2nd edition, NASA, 2021. Table 1,
//          "Exploration Requirements (2020)".

const (
	KJPerKcal = 4.184
	mjPerKcal = KJPerKcal / 1000

	// BVAD Table 3-33: nominal balance for an 82 kg crewmember. One table, so
	// the ratios between its rows stay consistent when scaled by food energy.
	bvadFoodEnergyMJ = 12.59
	OxygenKgPerMJ    = 0.816 / bvadFoodEnergyMJ
	CO2KgPerMJ       = 1.04 / bvadFoodEnergyMJ
	HeatMJPerMJ      = 12.0 / bvadFoodEnergyMJ
	// Food mass as eaten, before packaging.
	FoodKgPerMJ = 1.51 / bvadFoodEnergyMJ
	// BVAD section 4.3: "an additional ~17 % mass penalty ... for individually
	// packaged meals".
	FoodPackagingFraction = 0.17

	// STD-3001 [V2 6109], Table 6.3-1: at least 2.5 L per crewmember per day
	// for hydration, drinking and food rehydration together. Revisions before
	// C asked for 2.0 kg. BVAD Table 4-20 splits the 2.5 kg as 2.00 drinking
	// and 0.50 food rehydration.
	PotableWaterKgPerDay = 2.5
	// STD-3001 [V2 6109], Table 6.3-1: least water for personal hygiene per
	// crewmember per day.
	HygieneWaterMinKgPerDay = 0.4

	// HASF Table 1: fluid of 32 mL per kg of body mass, with a floor by sex.
	FluidLPerKg = 0.032

	// STD-3001 [V2 7004]: 837 kJ (200 kcal) more food per hour of EVA.
	EVAFoodKcalPerHour = 200
	EVAFoodMJPerHour   = EVAFoodKcalPerHour * mjPerKcal
	// STD-3001 [V2 11030] and Table 6.3-1: 240 mL of drinking water per EVA
	// hour. BVAD Table 4-76 gives the same figure.
	EVADrinkKgPerHour = 0.24
	// BVAD Table 4-75, nominal values for lunar surface suits. Both leave the
	// suit and never come back to the vehicle, so recycling cannot recover
	// them. The cooling figure is the equatorial one; polar sites lose about half.
	EVAOxygenLossKgPerHour   = 0.092
	EVACoolingWaterKgPerHour = 0.625

	// BVAD Table 3-2, ISS average power by system (Pritchett, 2014).
	// Per crewmember: life support 5.31 kW, crew equipment 1.07 kW and crew
	// health care 0.11 kW, shared between the six people ISS carried in 2014.
	// Dividing by six is our reading; the table does not give a crew size.
	// Rounded to 10 W, the resolution the mission file stores.
	CrewPowerW = 1080
	// Station housekeeping from the same table: data handling 4.08, comms
	// 2.90, power system 2.02, guidance 0.62, mechanisms 0.19, thermal
	// control 8.72 kW.
	StationBasePowerW = 18530

	// ISS state of the art for regenerative life support.
	// Water: NASA, "NASA Achieves Water Recovery Milestone on International
	// Space Station", 2023. Oxygen: the Sabatier process, about half of the
	// oxygen in exhaled carbon dioxide (NASA ICES-2024-168).
	ISSWaterRecovery  = 0.98
	ISSOxygenRecovery = 0.5

	// ASSUMED. Share added on top of everything the crew has to bring or
	// generate. A mission can set its own between the two limits.
	MinMarginPercent     = 40
	MaxMarginPercent     = 100
	DefaultMarginPercent = MinMarginPercent
)

// HASF Table 1: the least fluid a day, in litres.
var fluidFloorL = map[string]float64{"female": 2.1, "male": 2.5}

// STD-3001 [V2 7003], Table 7.1-1: Estimated Energy Requirement for adults 19
// and older, as printed in Revision F.
//
//	EER = base - perYear * age + AF * (perKg * mass + perMetre * height)
//
// Revisions before C print 622 for the men's constant. C to F print 662.
type eerCoefficients struct{ base, perYear, perKg, perMetre float64 }

var eer = map[string]eerCoefficients{
	"male":   {662, 9.53, 15.9, 539.6},
	"female": {354, 6.91, 9.36, 726},
}

// "active" is the 1.25 that STD-3001 [V2 7003] applies to both sexes. The
// standard has no other levels, only a range of 1.0 to 1.25 by gravity and
// exercise. The rest are the Dietary Reference Intake factors (Institute of
// Medicine, 2005), and "very-active" is above the standard's range.
var activityFactor = map[string]map[string]float64{
	"male":   {"sedentary": 1.0, "low": 1.11, "active": 1.25, "very-active": 1.48},
	"female": {"sedentary": 1.0, "low": 1.12, "active": 1.25, "very-active": 1.45},
}

// HASF Table 1, exploration requirements. Shares are of daily food energy.
const (
	proteinMinGPerKg     = 1.2
	proteinMaxGPerKg     = 1.8
	carbohydrateMinShare = 0.45
	carbohydrateMaxShare = 0.65
	fatMinShare          = 0.2
	fatMaxShare          = 0.35
	kcalPerGCarbohydrate = 4
	kcalPerGFat          = 9
)

// HASF Table 1, per day. Where the table gives a range, max is set.
// STD-3001 [V2 7100] asks for Dietary Reference Intake values with vitamin D
// at 25 µg. The 110 and 125 mg of vitamin C were in Revision C and are not in
// D to F.
// Iron is 18 mg for women under 50 who do not suppress menstruation; the
// profile does not record that, so the planner reports the 8 mg figure.
type nutrientTarget struct {
	id, label, unit string
	female, male    float64
	max             float64 // 0 when the table gives a single value
}

var nutrientTargets = []nutrientTarget{
	{"fiber", "Fiber", "g", 25, 38, 0},
	{"omega6", "Omega-6 fatty acids", "g", 12, 17, 0},
	{"omega3", "Omega-3 fatty acids", "g", 1.1, 1.6, 0},
	{"calcium", "Calcium", "mg", 1000, 1000, 1200},
	{"phosphorus", "Phosphorus", "mg", 700, 700, 0},
	{"magnesium", "Magnesium", "mg", 320, 420, 0},
	{"sodium", "Sodium", "mg", 1500, 1500, 2300},
	{"potassium", "Potassium", "mg", 2600, 3400, 0},
	{"iron", "Iron", "mg", 8, 8, 0},
	{"zinc", "Zinc", "mg", 8, 11, 0},
	{"vitaminA", "Vitamin A", "µg", 700, 900, 0},
	{"vitaminC", "Vitamin C", "mg", 110, 125, 0},
	{"vitaminD", "Vitamin D", "µg", 25, 25, 0},
	{"vitaminE", "Vitamin E", "mg", 15, 15, 0},
	{"vitaminK", "Vitamin K", "µg", 90, 120, 0},
	{"vitaminB12", "Vitamin B12", "µg", 2.4, 2.4, 0},
	{"folate", "Folate", "µg", 400, 400, 0},
}

// Radiation, as dose equivalent in sieverts per Earth day. Quiet sun: a solar
// particle event adds on top. NASA limits effective dose, which these
// measured rates approximate.
const (
	// NASA-STD-3001 Vol 1 [V1 4030]: career effective dose under 600 mSv.
	CareerDoseLimitSv = 0.6
	// Curiosity RAD in cruise to Mars, galactic cosmic rays. Zeitlin et al.,
	// Science 340, 1080 (2013).
	TransitDoseSvPerDay = 0.00184
	// Curiosity RAD at Gale crater, August 2012 to June 2013. NASA news
	// release, 9 December 2013. The same value as in data/SOURCES.md.
	MarsSurfaceDoseSvPerDay = 0.00067
	// Chang'e 4 LND on the lunar far side. Zhang et al., Science Advances 6,
	// eaaz1334 (2020).
	MoonSurfaceDoseSvPerDay = 0.001369
	// ISS crews get about 0.2 to 0.5 mSv a day (NASA, NTRS 20250006168).
	// The top of that range.
	StationDoseSvPerDay = 0.0005
	// World average natural background, 2.4 mSv a year (UNSCEAR 2008).
	EarthDoseSvPerDay = 0.0024 / 365
)
