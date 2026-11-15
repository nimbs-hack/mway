// Traverse limits and the travel time model. Kept free of the editor's map
// code so the viewer's route search can use them. ./plan re-exports them.

import type { Ground } from './ground'

// SI units: degrees for slope, m/s for the three speeds, seconds for time,
// meters for range. `pace` is speed over flat ground. `climb` and `descent`
// are vertical rates, meters of height per second. `rocks` and `ripples`
// are the share of `pace` kept on that ground, from 0 to 1.
export type Limits = {
  slope: number
  pace: number
  climb: number
  descent: number
  eva: number
  work: number
  range: number
  rocks: number
  ripples: number
}

const perHour = (meters: number) => meters / 3600

// NASA-STD-3001 Vol 2 [V2 11030] rationale: suit water sized for "a 10-km
// walk-back in case of rover failure", from the Apollo Medical Summit. No
// preset may allow more.
export const WALK_BACK_REFERENCE = 10_000

// Planning assumptions, not suit certifications. No Mars suit limits are
// published.
//
// Human and Rover are the two traverse presets of the algorithms branch
// (TRAVERSE_PRESETS in packages/shared/src/types.ts): slope limit, flat,
// climb and descent speed, and longest EVA. Their work time and walk-back
// range are ASSUMED here, since that branch has neither.
//
// The other three came with the route planner. Their slope limits follow
// lunar traverse studies, and they use the algorithms branch's default
// climb and descent rates.
//
// Speed on rough ground is the same share of the flat speed in every preset.
// Ripples are loose sand. Soule and Goldman (J Appl Physiol 1972) measured
// walking on loose sand at 2.1 times the energy of a paved road, and at the
// same effort that is 1 / sqrt(2.1) of the speed, by the speed-squared term
// of the Pandolf load carriage equation. The share on rocks is ASSUMED: no
// suited walking speed over rocks is published.
export const ROUGH_PACE = { rocks: 0.5, ripples: 0.69 }

export const PRESETS: { id: string, name: string, limits: Limits }[] = [
  { id: 'human', name: 'Human, EVA suit', limits: { slope: 7, pace: perHour(2500), climb: perHour(350), descent: perHour(800), eva: 4 * 3600, work: 60 * 60, range: 3000, ...ROUGH_PACE } },
  { id: 'rover', name: 'Rover, pressurized', limits: { slope: 15, pace: perHour(5000), climb: perHour(700), descent: perHour(1200), eva: 8 * 3600, work: 60 * 60, range: WALK_BACK_REFERENCE, ...ROUGH_PACE } },
  { id: 'conservative', name: 'Conservative', limits: { slope: 15, pace: 0.7, climb: perHour(350), descent: perHour(800), eva: 3 * 3600, work: 45 * 60, range: 1500, ...ROUGH_PACE } },
  { id: 'nominal', name: 'Nominal', limits: { slope: 20, pace: 0.85, climb: perHour(350), descent: perHour(800), eva: 4 * 3600, work: 60 * 60, range: 3000, ...ROUGH_PACE } },
  { id: 'extended', name: 'Extended', limits: { slope: 25, pace: 1, climb: perHour(350), descent: perHour(800), eva: 6 * 3600, work: 90 * 60, range: 5000, ...ROUGH_PACE } },
]

export const DEFAULT_PRESET = 'nominal'
export const DEFAULT_LIMITS = PRESETS.find((preset) => preset.id === DEFAULT_PRESET)!.limits

// Seconds to cover `run` meters of ground while going up or down by `rise`
// meters. The model of the algorithms branch (evaluateEvaWeather in
// apps/api/src/weather/generator.ts): the distance at the flat speed, plus
// the height gained at the climb rate, plus the height lost at the descent
// rate. Rocks and ripples under the step slow the flat speed.
export function stepTime(run: number, rise: number, limits: Limits, ground?: Ground | null) {
  return run / groundPace(limits, ground) + Math.max(0, rise) / limits.climb + Math.max(0, -rise) / limits.descent
}

// Speed over the ground in m/s. Never faster than the flat speed, and never
// under a twentieth of it, so a zero in a limit cannot stop the clock.
export function groundPace(limits: Limits, ground?: Ground | null) {
  const share = ground === 'rocks' ? limits.rocks : ground === 'ripples' ? limits.ripples : 1
  return limits.pace * Math.min(1, Math.max(0.05, share))
}
