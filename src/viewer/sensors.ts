// Suit sensor readings for each crew member on the EVA: life signs, oxygen
// and energy. There is no suit telemetry yet, so these readings are SIMULATED.
// The viewer calls nothing here but readSuitSensors, so a real feed replaces
// that one function.
//
// The simulation is built on the planner's suit model (../data/suit), so its
// numbers are the ones the plan assumes: metabolic rate around the Apollo EVA
// average, oxygen from metabolic energy by the BVAD ratio, and a suit oxygen
// loss under the BVAD allowance. Units are SI throughout.

import { SUIT } from '../data/suit'

// The suit is sized for an 8 h EVA at the planned oxygen use and loss.
export const EVA_HOURS = 8
export const TANK_KG = EVA_HOURS * 3600 * (SUIT.baseW * SUIT.oxygenKgPerJ + SUIT.suitOxygenKgPerHour / 3600)
// Shuttle and ISS EMU operating pressure, 4.3 psi.
export const SUIT_PRESSURE_PA = 29_600
// Time already out when the simulation starts.
export const EVA_ELAPSED_AT_START_S = 2.5 * 3600
// Below this much oxygen time, a crew member is close to the limit, and below
// the second, over it. 30 min is what an EMU's secondary oxygen pack gives.
export const OXYGEN_TIME_CAUTION_S = 60 * 60
export const OXYGEN_TIME_HAZARD_S = 30 * 60
// Leak alerts are set against the suit oxygen loss the plan allows.
export const LEAK_LIMIT_KG_S = SUIT.suitOxygenKgPerHour / 3600
// Blood oxygen saturation: the usual clinical lines for low and very low.
export const SPO2_CAUTION = 0.94
export const SPO2_HAZARD = 0.9

export type Level = 'ok' | 'caution' | 'hazard'

export interface SuitReading {
  member: number
  // Seconds since the EVA started.
  elapsedS: number
  heartRateBpm: number
  breathsPerMin: number
  // Blood oxygen saturation, 0 to 1.
  spo2: number
  coreTempK: number
  metabolicW: number
  // Metabolic energy since the EVA started.
  energyJ: number
  // Oxygen breathed, and oxygen lost from the suit.
  oxygenUseKgS: number
  leakKgS: number
  oxygenLeftKg: number
  // At the current use and loss.
  oxygenTimeLeftS: number
  suitPressurePa: number
}

// Each person works a little harder or easier than the planned average, and
// their suit loses a different share of the oxygen loss the plan allows. The
// fourth suit loses close to the whole allowance, so the feed shows what a
// caution looks like.
const WORK = [1, 0.9, 1.15, 0.95, 1.08, 0.88]
const LEAK_SHARE = [0.6, 0.7, 0.55, 0.95, 0.65, 0.75]
// Effort rises and falls over ten minutes as the ground changes.
const SWING = 0.12
const OMEGA = (2 * Math.PI) / 600

export function readSuitSensors(crew: number, seconds: number): SuitReading[] {
  const elapsedS = EVA_ELAPSED_AT_START_S + Math.max(0, seconds)
  return Array.from({ length: crew }, (_, member) => {
    const base = SUIT.baseW * WORK[member % WORK.length]!
    const phase = member * 1.7
    const metabolicW = base * (1 + SWING * Math.sin(OMEGA * elapsedS + phase))
    // The integral of the rate above, from the start of the EVA.
    const energyJ = base * elapsedS + ((base * SWING) / OMEGA) * (Math.cos(phase) - Math.cos(OMEGA * elapsedS + phase))
    const oxygenUseKgS = metabolicW * SUIT.oxygenKgPerJ
    const leakKgS = LEAK_LIMIT_KG_S * LEAK_SHARE[member % LEAK_SHARE.length]!
    const oxygenLeftKg = Math.max(0, TANK_KG - energyJ * SUIT.oxygenKgPerJ - leakKgS * elapsedS)
    return {
      member,
      elapsedS,
      // Heart rate and breathing follow the work rate, as they do at these
      // loads. The coefficients only keep them in a usual range.
      heartRateBpm: 60 + 0.2 * metabolicW,
      breathsPerMin: 10 + 0.03 * metabolicW,
      spo2: 0.975 + 0.008 * Math.sin(OMEGA * 0.7 * elapsedS + phase),
      coreTempK: 309.95 + 0.0025 * metabolicW,
      metabolicW,
      energyJ,
      oxygenUseKgS,
      leakKgS,
      oxygenLeftKg,
      oxygenTimeLeftS: oxygenLeftKg / (oxygenUseKgS + leakKgS),
      suitPressurePa: SUIT_PRESSURE_PA + 20 * Math.sin(OMEGA * 3 * elapsedS + phase),
    }
  })
}

// How close each reading with a limit is to it.
export function readingLevels(reading: SuitReading) {
  const below = (value: number, caution: number, hazard: number): Level => (value < hazard ? 'hazard' : value < caution ? 'caution' : 'ok')
  const above = (value: number, caution: number, hazard: number): Level => (value > hazard ? 'hazard' : value > caution ? 'caution' : 'ok')
  return {
    oxygenTime: below(reading.oxygenTimeLeftS, OXYGEN_TIME_CAUTION_S, OXYGEN_TIME_HAZARD_S),
    leak: above(reading.leakKgS, 0.8 * LEAK_LIMIT_KG_S, LEAK_LIMIT_KG_S),
    spo2: below(reading.spo2, SPO2_CAUTION, SPO2_HAZARD),
    metabolic: above(reading.metabolicW, 0.8 * SUIT.limitW, SUIT.limitW),
  }
}

// The worst level among a reading's limits.
export function worstLevel(reading: SuitReading): Level {
  const levels = Object.values(readingLevels(reading))
  return levels.includes('hazard') ? 'hazard' : levels.includes('caution') ? 'caution' : 'ok'
}
