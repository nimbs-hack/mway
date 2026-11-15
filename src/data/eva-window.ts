import { localSolarTime, marsSolDate, SOL, sunElevation, sunState } from './mars-time'
import type { LatLon } from './geo'
import type { Reason, Verdict } from './plan'
import { checkSpaceWeather } from './space-weather'
import type { Arrival, SpaceWeather } from './space-weather'
import type { Reading } from './weather'

// Finds the best time to start an EVA over the next few sols. The Sun's
// position is computed. Temperatures are the nearest station's latest low
// and high laid on a typical daily curve, so they are an estimate, not a
// forecast. CMEs come from the DONKI forecasts. Times are UTC milliseconds.

const MINUTE = 60_000
const STEP = 10 * MINUTE

// ASSUMED: the Sun stays up an hour past the planned end, so an overrun
// does not end in the dark.
export const DAYLIGHT_RESERVE = 3_600_000

// ASSUMED daily curve: lowest at sunrise, highest at these local solar
// hours, then cooling with this time constant. The ground sensor reads the
// surface, which heats and cools before the air does.
const AIR_PEAK = 14
const GROUND_PEAK = 13
const COOLING_HOURS = 4

// Windows within this share of the warmest count as equal, and the earliest wins.
const TIE = 0.02

export type Range = { min: number, max: number }

export type EvaWindow = {
  start: number
  end: number
  // Local true solar time at the start point, hours.
  startSolar: number
  endSolar: number
  // Sun elevation in degrees: lowest and highest during the EVA.
  sun: Range
  // From the end to sunset.
  daylightLeft: number
  // Kelvin. Null without a station reading.
  air: Range | null
  ground: Range | null
  verdict: Verdict
  reasons: Reason[]
  // The Sun's part of the reasons: down during the EVA, or setting less than
  // an hour after it. Null when the daylight is enough.
  daylight: Reason | null
  // CMEs within the window and its margin.
  cmes: Arrival[]
  // 0 to 1: how warm the window is on the daily curve.
  warmth: number
}

export type SolPlan = {
  // Mars sol date of the sol at the start point, counting from local midnight.
  sol: number
  // UTC of local solar noon.
  noon: number
  sunrise: number | null
  sunset: number | null
  best: EvaWindow | null
}

export type WindowSearch = {
  sols: SolPlan[]
  best: EvaWindow | null
}

const RANK: Record<Verdict, number> = { go: 0, caution: 1, 'no-go': 2 }

// Share of the day's swing reached at a local solar hour: 0 at sunrise, 1 at the peak.
export function dailyCurve(hour: number, sunrise: number, peak: number) {
  const rise = Math.min(sunrise, peak - 1)
  if (hour >= rise && hour <= peak) return Math.sin((Math.PI / 2) * ((hour - rise) / (peak - rise)))
  const since = (hour - peak + 24) % 24
  const span = 24 - (peak - rise)
  const floor = Math.exp(-span / COOLING_HOURS)
  return Math.max(0, (Math.exp(-since / COOLING_HOURS) - floor) / (1 - floor))
}

// Local solar hour of sunrise for the season's declination. 0 in polar day, 12 in polar night.
export function sunriseHour(lat: number, declination: number) {
  const cos = -Math.tan((lat * Math.PI) / 180) * Math.tan((declination * Math.PI) / 180)
  if (cos <= -1) return 0
  if (cos >= 1) return 12
  return 12 - (Math.acos(cos) * 180) / Math.PI / 15
}

function temperatures(low: number | null, high: number | null, curve: number[]): Range | null {
  if (low == null || high == null) return null
  const values = curve.map((f) => low + (high - low) * f)
  return { min: Math.min(...values), max: Math.max(...values) }
}

// The first time from `from` within `span` that the Sun crosses the horizon going up or down.
function crossing(from: number, span: number, lat: number, lon: number, rising: boolean) {
  let previous = sunElevation(from, lat, lon)
  for (let t = from + STEP; t <= from + span; t += STEP) {
    const e = sunElevation(t, lat, lon)
    if (rising ? previous < 0 && e >= 0 : previous >= 0 && e < 0) {
      // Halve the step down to a minute.
      let a = t - STEP
      let b = t
      while (b - a > MINUTE) {
        const mid = (a + b) / 2
        const up = sunElevation(mid, lat, lon) >= 0
        if (up === rising) b = mid
        else a = mid
      }
      return b
    }
    previous = e
  }
  return null
}

type Context = {
  lat: number
  lon: number
  // Milliseconds from leaving to getting back.
  duration: number
  now: number
  reading: Reading | null
  space: SpaceWeather | null
}

function sunset(start: number, lat: number, lon: number) {
  return sunElevation(start, lat, lon) < 0 ? null : crossing(start, (SOL / 2) * 1000, lat, lon, false)
}

// Everything about one start time. The Sun must be up from the start to an
// hour after the end, or the window is no-go.
function windowAt(ctx: Context, start: number): EvaWindow {
  const { lat, lon, duration, reading } = ctx
  const state = sunState(start)
  const rise = sunriseHour(lat, state.declination)
  const air: number[] = []
  const ground: number[] = []
  const sun: number[] = []
  for (let t = start; t <= start + duration; t += STEP) {
    const hour = localSolarTime(t, lon)
    air.push(dailyCurve(hour, rise, AIR_PEAK))
    ground.push(dailyCurve(hour, rise, GROUND_PEAK))
    sun.push(sunElevation(t, lat, lon))
  }
  const set = sunset(start, lat, lon)
  const daylightLeft = set === null ? 0 : set - (start + duration)
  const check = checkSpaceWeather(ctx.space, start, start + duration, ctx.now)
  const daylight: Reason | null =
    Math.min(...sun) <= 0
      ? { level: 'no-go', text: 'Sun is down during the EVA' }
      : daylightLeft < DAYLIGHT_RESERVE
        ? { level: 'caution', text: 'Less than an hour of daylight after the end' }
        : null
  const reasons: Reason[] = daylight ? [daylight, ...check.reasons] : [...check.reasons]
  const verdict: Verdict = reasons.some((r) => r.level === 'no-go') ? 'no-go' : reasons.length ? 'caution' : 'go'
  return {
    start,
    end: start + duration,
    startSolar: localSolarTime(start, lon),
    endSolar: localSolarTime(start + duration, lon),
    sun: { min: Math.min(...sun), max: Math.max(...sun) },
    daylightLeft,
    air: temperatures(reading?.airMinK ?? null, reading?.airMaxK ?? null, air),
    ground: temperatures(reading?.groundMinK ?? null, reading?.groundMaxK ?? null, ground),
    verdict,
    reasons,
    daylight,
    cmes: check.during,
    warmth: air.reduce((a, b) => a + b, 0) / air.length,
  }
}

export type WindowInput = {
  point: LatLon
  // Seconds from leaving to getting back.
  duration: number
  now: number
  reading?: Reading | null
  space?: SpaceWeather | null
}

const context = (input: WindowInput): Context => ({
  lat: input.point[0],
  lon: input.point[1],
  duration: input.duration * 1000,
  now: input.now,
  reading: input.reading ?? null,
  space: input.space ?? null,
})

// The same checks for a start the user picked.
export function assessStart(input: WindowInput, start: number): EvaWindow {
  return windowAt(context(input), start)
}

// The best start in each of the next `sols` sols at the point, and the best of those.
export function findWindows(input: WindowInput & { sols?: number }): WindowSearch {
  const ctx = context(input)
  const { lat, lon, duration, now } = ctx
  const count = input.sols ?? 7
  const first = Math.ceil(now / STEP) * STEP
  const solOf = (t: number) => Math.floor(marsSolDate(t) + lon / 360)
  const firstSol = solOf(first)

  const sols: SolPlan[] = []
  for (let i = 0; i < count; i++) {
    // Local noon of this sol, from the solar time a whole number of sols on.
    const guess = first + i * SOL * 1000
    const noon = guess + ((12 - localSolarTime(guess, lon) + 24) % 24) * (SOL / 24) * 1000
    sols.push({
      sol: solOf(noon),
      noon,
      sunrise: crossing(noon - (SOL / 2) * 1000, (SOL / 2) * 1000, lat, lon, true),
      sunset: crossing(noon, (SOL / 2) * 1000, lat, lon, false),
      best: null,
    })
  }

  for (const plan of sols) {
    if (plan.sunrise === null || plan.sunset === null) continue
    // Starts from sunrise, or now if later, to the last that still ends an hour before sunset.
    const from = Math.max(first, Math.ceil(plan.sunrise / STEP) * STEP)
    if (from >= plan.sunset) continue
    // An EVA longer than the daylight still gets a start: at sunrise, the
    // most light it can have. Its verdict says the Sun sets before the end.
    const to = Math.max(from, plan.sunset - duration - DAYLIGHT_RESERVE)
    for (let start = from; start <= to; start += STEP) {
      const w = windowAt(ctx, start)
      const current = plan.best
      if (current && (RANK[current.verdict] < RANK[w.verdict] || (RANK[current.verdict] === RANK[w.verdict] && current.warmth >= w.warmth))) continue
      plan.best = w
    }
  }

  return { sols, best: bestOf(sols.map((s) => s.best)) }
}

// The best of some sols' best windows: fewest problems first, then the
// warmest, then the soonest among near-equals. When none can be done
// safely, the one that runs least past sunset. Null when there are none.
export function bestOf(windows: Array<EvaWindow | null>): EvaWindow | null {
  const found = windows.filter((w): w is EvaWindow => w !== null)
  if (!found.length) return null
  const rank = Math.min(...found.map((w) => RANK[w.verdict]))
  const top = found.filter((w) => RANK[w.verdict] === rank)
  if (rank === RANK['no-go']) return top.reduce((a, b) => (b.daylightLeft > a.daylightLeft ? b : a))
  const warmest = Math.max(...top.map((w) => w.warmth))
  return top.find((w) => w.warmth >= warmest - TIE) ?? null
}
