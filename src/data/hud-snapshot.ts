import { bearing } from './geo'
import type { LatLon } from './geo'
import type { Assessment, Limits, Plan, Reason, Verdict } from './plan'
import type { ProfileSample } from './route-profile'
import { slopeLevel } from './slope-level'

// What the map hands the HUD page: the assessed EVA route, as plain data.
// The HUD has no terrain and no planner of its own. It only draws this, so
// it can never disagree with the map. Coordinates are planetocentric
// latitude and east longitude, -180 to 180, as in src/data/geo.ts. SI units.
//
// This file must not import the terrain code, or the HUD page would load the
// whole map library.

export type HudSample = {
  d: number
  point: LatLon
  elevation: number | null
  slope: number | null
  // On terrain too coarse to trust the slope.
  coarse: boolean
}

export type HudRoute = {
  // Where the start came from, like "Curiosity · sol 5073", when known.
  startName: string | null
  // EVA start, UTC milliseconds: the one picked on the Sites page, or the one
  // worked out there. Null in snapshots saved before the start was worked out.
  when: number | null
  limits: Limits
  samples: HudSample[]
  // Distance along the route of each stop after the start. The last is the
  // target.
  marks: number[]
  verdict: Verdict
  reasons: Reason[]
  distance: number
  timeOut: number
  timeBack: number
  total: number
  maxSlope: number | null
  walkBack: number
  // Sieverts for the whole EVA, at a quiet-sun rate. Null when no rate is known.
  dose: number | null
  // ESTIMATED suit load, see suitLoad in plan.ts.
  peakW: number
  peakLimitW: number
  oxygenKg: number
  waterKg: number
}

// ready: the route as last assessed. updating and failed: the route changed
// in the planner and the one kept here is the last one assessed. none: the
// plan has no start or no target.
export type HudStatus = 'none' | 'ready' | 'updating' | 'failed'
export type HudSnapshot = { version: 1, savedAt: number, status: HudStatus, route: HudRoute | null }

const KEY = 'nimbs.hud'
export const hudKey = (missionId?: string | null) => (missionId ? `${KEY}:${missionId}` : KEY)

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

export function hudRoute(input: {
  plan: Plan
  limits: Limits
  samples: ProfileSample[]
  assessment: Assessment
  marks: number[]
  // Terrain detail in meters past which slope is a smoothed lower bound.
  coarseDetail: number
  peakLimitW: number
}): HudRoute {
  const { plan, limits, samples, assessment } = input
  const when = plan.when ? Date.parse(plan.when) : NaN
  return {
    startName: plan.startName ?? null,
    when: Number.isFinite(when) ? when : null,
    limits,
    samples: samples.map((s) => ({
      d: round(s.d, 1),
      point: [round(s.point[0], 6), round(s.point[1], 6)],
      elevation: s.elevation === null ? null : round(s.elevation, 1),
      slope: s.slope === null ? null : round(s.slope, 1),
      coarse: s.detail != null && s.detail > input.coarseDetail,
    })),
    // Rounded like the samples. hudLegs tells the target from a stop by
    // comparing a mark with the last sample's distance.
    marks: input.marks.map((d) => round(d, 1)),
    verdict: assessment.verdict,
    reasons: assessment.reasons,
    distance: assessment.distance,
    timeOut: assessment.timeOut,
    timeBack: assessment.timeBack,
    total: assessment.total,
    maxSlope: assessment.maxSlope,
    walkBack: assessment.walkBack,
    dose: assessment.dose,
    peakW: assessment.suit.peakW,
    peakLimitW: input.peakLimitW,
    oxygenKg: assessment.suit.oxygenKg,
    waterKg: assessment.suit.waterKg,
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const STATUSES: HudStatus[] = ['none', 'ready', 'updating', 'failed']

// Null when nothing was saved, or when what is there is not a snapshot this
// version wrote.
export function loadHud(missionId?: string | null, storage: Pick<Storage, 'getItem'> = localStorage): HudSnapshot | null {
  try {
    const saved: unknown = JSON.parse(storage.getItem(hudKey(missionId)) ?? 'null')
    if (!record(saved) || saved.version !== 1 || typeof saved.savedAt !== 'number') return null
    if (!STATUSES.includes(saved.status as HudStatus)) return null
    const route = saved.route
    if (route === null) return saved as HudSnapshot
    if (!record(route) || !Array.isArray(route.samples) || route.samples.length < 2 || !Array.isArray(route.marks)) return null
    if (!Array.isArray(route.reasons) || !record(route.limits) || typeof route.total !== 'number') return null
    return saved as HudSnapshot
  } catch {
    return null
  }
}

export function saveHud(
  missionId: string | null | undefined,
  status: HudStatus,
  route: HudRoute | null,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  now = Date.now(),
): void {
  try {
    let snapshot: HudSnapshot = { version: 1, savedAt: now, status, route }
    // While the planner works out a changed route, the HUD keeps the last
    // assessed one and the time it was assessed, and says it is out of date.
    if (status === 'updating' || status === 'failed') {
      const last = loadHud(missionId, storage)
      snapshot = last?.route ? { ...last, status } : { version: 1, savedAt: now, status, route: null }
    }
    storage.setItem(hudKey(missionId), JSON.stringify(snapshot))
  } catch {
    // A blocked or full browser store must not interrupt planning.
  }
}

export type HudLeg = {
  index: number
  from: LatLon
  to: LatLon
  length: number
  // Straight from stop to stop, degrees clockwise from north. The route
  // between them may wind.
  bearing: number
  maxSlope: number | null
  // Meters over the slope limit.
  over: number
}

function sampleAt(samples: HudSample[], d: number) {
  let best = samples[0]
  for (const s of samples) if (Math.abs(s.d - d) < Math.abs(best.d - d)) best = s
  return best
}

// One leg per stop: start to the first stop, and so on to the target.
export function hudLegs(route: HudRoute): HudLeg[] {
  const { samples } = route
  const total = samples.at(-1)!.d
  const ends = [...route.marks.filter((d) => d > 0 && d < total), total]
  return ends.map((to, i) => {
    const from = i === 0 ? 0 : ends[i - 1]
    let maxSlope: number | null = null
    let over = 0
    for (let k = 1; k < samples.length; k++) {
      const mid = (samples[k].d + samples[k - 1].d) / 2
      if (mid <= from || mid > to) continue
      const { slope } = samples[k]
      if (slope !== null) maxSlope = Math.max(maxSlope ?? 0, slope)
      if (slopeLevel(slope, route.limits.slope) === 'hazard') over += samples[k].d - samples[k - 1].d
    }
    const a = sampleAt(samples, from).point
    const b = sampleAt(samples, to).point
    return { index: i + 1, from: a, to: b, length: to - from, bearing: bearing(a, b), maxSlope, over }
  })
}

// Height gained and lost on the way out, and the lowest and highest ground.
export function hudRelief(samples: HudSample[]) {
  let climb = 0
  let descent = 0
  let low = Infinity
  let high = -Infinity
  let previous: number | null = null
  for (const { elevation } of samples) {
    if (elevation === null) continue
    low = Math.min(low, elevation)
    high = Math.max(high, elevation)
    if (previous !== null) {
      if (elevation > previous) climb += elevation - previous
      else descent += previous - elevation
    }
    previous = elevation
  }
  return { climb, descent, low: Number.isFinite(low) ? low : null, high: Number.isFinite(high) ? high : null }
}
