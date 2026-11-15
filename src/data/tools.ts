import { MARS_RADIUS, bearing, cumulative, offset } from './geo'
import type { LatLon } from './geo'
import type { Limits } from './plan'

// Geometry for the map tools: ruler, range rings and line of sight.
// Coordinates are planetocentric latitude and east longitude, -180 to 180.
// Distances and heights in meters.

// Total length of a polyline over the surface.
export function pathLength(points: LatLon[]) {
  return points.length < 2 ? 0 : cumulative(points).at(-1)!
}

// Bearing of the last segment, degrees clockwise from north, or null.
export function lastBearing(points: LatLon[]) {
  return points.length < 2 ? null : bearing(points.at(-2)!, points.at(-1)!)
}

// A closed ring of points `radius` meters around `center`. Uses flat
// offsets, fine up to a few tens of kilometers.
export function ring(center: LatLon, radius: number, steps = 96): LatLon[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI
    return offset(center, radius * Math.cos(angle), radius * Math.sin(angle))
  })
}

/**
 * How far out the astronaut can walk on flat ground and still get back in
 * the EVA budget, after the time spent at the target.
 */
export function flatReach(limits: Limits) {
  return Math.max(0, ((limits.eva - limits.work) / 2) * limits.pace)
}

export type SightSample = { d: number, elevation: number | null }

export type Sight = {
  visible: boolean
  // Where the terrain cuts the sight line, and by how much it pokes above.
  blockedAt: number | null
  blockedBy: number
  // Smallest gap between the sight line and the ground, negative if blocked.
  clearance: number
}

/**
 * Line of sight from an observer to a target over sampled terrain. Heights
 * are above the ground at each end. The sight line is a straight chord, and
 * the curve of Mars lifts the ground between by d1 * d2 / 2R above it.
 */
export function lineOfSight(samples: SightSample[], observerHeight: number, targetHeight: number): Sight | null {
  const known = samples.filter((s): s is { d: number, elevation: number } => s.elevation !== null)
  if (known.length < 2) return null
  const first = known[0]
  const last = known.at(-1)!
  const total = last.d - first.d
  if (total <= 0) return null
  const eye = first.elevation + observerHeight
  const goal = last.elevation + targetHeight
  let clearance = Infinity
  let blockedAt: number | null = null
  let blockedBy = 0
  for (const s of known.slice(1, -1)) {
    const along = s.d - first.d
    const line = eye + (goal - eye) * (along / total)
    const bulge = (along * (total - along)) / (2 * MARS_RADIUS)
    const gap = line - (s.elevation + bulge)
    if (gap < clearance) clearance = gap
    if (gap < 0 && blockedAt === null) blockedAt = along
    if (gap < 0) blockedBy = Math.max(blockedBy, -gap)
  }
  if (clearance === Infinity) clearance = Math.min(observerHeight, targetHeight)
  return { visible: blockedAt === null, blockedAt, blockedBy, clearance }
}

export type Terrain = { climb: number, descent: number, maxSlope: number | null, low: number | null, high: number | null }

// Climb, descent and steepest slope along sampled terrain.
export function terrainAlong(samples: (SightSample & { slope?: number | null })[]): Terrain {
  let climb = 0
  let descent = 0
  let maxSlope: number | null = null
  let low: number | null = null
  let high: number | null = null
  for (let i = 0; i < samples.length; i++) {
    const { elevation, slope } = samples[i]
    if (slope != null) maxSlope = Math.max(maxSlope ?? 0, slope)
    if (elevation === null) continue
    low = low === null ? elevation : Math.min(low, elevation)
    high = high === null ? elevation : Math.max(high, elevation)
    const before = samples[i - 1]?.elevation
    if (before == null) continue
    if (elevation > before) climb += elevation - before
    else descent += before - elevation
  }
  return { climb, descent, maxSlope, low, high }
}
