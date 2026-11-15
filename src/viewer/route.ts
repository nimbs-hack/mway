// The route the crew walks between the mission's sites, in file order. Each
// leg is the planner's own route search (src/data/route-options.ts): A* on a
// grid laid along the leg, under the planner's default limits. The viewer
// runs it on the terrain it loaded for its map, so it reads no night
// infrared and offers one route per leg, the shortest under the slope limit.
// The planner's Sites stage can find others.
//
// Coordinates are planetocentric latitude and east longitude. Meters, SI.

import { type LatLon, distance } from '../data/geo'
import { DEFAULT_LIMITS, type Limits } from '../data/limits'
import { buildGrid, gridSlopes, routeOptions } from '../data/route-options'

export interface RouteLeg {
  // Index of the site the leg starts at. It ends at the next one.
  from: number
  // `ok` follows the terrain under the limit. `blocked` found no path under
  // it, and `unknown` had no terrain at an end: both are drawn straight.
  status: 'ok' | 'blocked' | 'unknown'
  points: LatLon[]
  distance: number
  // Steepest step on the path, from the search grid. Null when straight.
  maxSlope: number | null
  // For a blocked leg, the lowest slope limit that has a path, when known.
  needs: number | null
}

export interface SiteRoute {
  legs: RouteLeg[]
  limit: number
  distance: number
}

// Cells between the ends of a leg: about one per 20 m, as fine as the terrain
// the viewer loads, within what the search handles quickly.
const cellsFor = (length: number) => Math.min(120, Math.max(40, Math.round(length / 20)))

export function routeSites(sites: LatLon[], heightAt: (lat: number, lon: number) => number | null, limits: Limits = DEFAULT_LIMITS): SiteRoute {
  const legs = sites.slice(1).map((target, i): RouteLeg => {
    const start = sites[i]!
    const straight = (status: 'blocked' | 'unknown', needs: number | null = null): RouteLeg => ({
      from: i,
      status,
      points: [start, target],
      distance: distance(start, target),
      maxSlope: null,
      needs,
    })
    const grid = buildGrid(start, target, cellsFor(distance(start, target)))
    const elevation = grid.points.map(([lat, lon]) => heightAt(lat, lon))
    if (elevation[grid.start] === null || elevation[grid.target] === null) return straight('unknown')
    const field = { elevation, slope: gridSlopes(grid, elevation), thermal: elevation.map(() => null) }
    // Thermal and Detour need night infrared, which the viewer does not load.
    const plan = routeOptions(grid, field, limits, true)
    if (plan.status === 'blocked') return straight('blocked', plan.needs)
    const fast = plan.options[0]!
    return { from: i, status: 'ok', points: fast.line, distance: fast.distance, maxSlope: fast.maxSlope, needs: null }
  })
  return { legs, limit: limits.slope, distance: legs.reduce((sum, leg) => sum + leg.distance, 0) }
}

// Every point in walking order, from the first site to the last.
export const routeLine = (route: SiteRoute): LatLon[] => route.legs.flatMap((leg, i) => (i ? leg.points.slice(1) : leg.points))
