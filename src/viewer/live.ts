import type { Mission } from '../api'
import { type LatLon, MARS_RADIUS } from '../data/geo'

export interface CrewPosition {
  member: number
  name: string
  self: boolean
  // Planetocentric latitude, east-positive longitude in [0, 360).
  lat: number
  lon: number
}

const METERS_PER_DEGREE = (MARS_RADIUS * Math.PI) / 180
// A slow suited walk, meters a second.
export const WALK_SPEED = 1.2
// The crew walks as one group, two abreast: meters between rows, and
// between the two people of a row.
// Wide enough that the markers part at the map's closest zoom.
export const ROW_GAP = 8
export const SIDE_GAP = 6
// A route shorter than this, in meters, is treated as no route at all.
const MIN_ROUTE = 1

// A local simulation, not telemetry or a traversability assessment. The crew
// walks as a group along `path`: the route the map draws through the plan's
// stops, or the stops themselves before the route is found. Without a path,
// the sites in file order. At the end they turn back. A mission with one site has no route, so the crew
// circles it. These positions never enter the file.
export function simulatedPositions(mission: Pick<Mission, 'crew' | 'sites'>, seconds: number, self: number, path?: LatLon[]): CrewPosition[] {
  const points = path ?? mission.sites.map((site): LatLon => [site.lat, site.lon])
  const sites = points.filter(([lat, lon]) => Number.isFinite(lat + lon) && Math.abs(lat) <= 90).map(([lat, lon]) => ({ lat, lon }))
  const anchor = sites[0]
  if (!anchor) return []
  // Meters east and north of the first site. Exact enough for one site and
  // the legs around it, which is what the viewer shows.
  const east = METERS_PER_DEGREE * Math.max(0.01, Math.cos((anchor.lat * Math.PI) / 180))
  const local = sites.map(
    (site) => [((((site.lon - anchor.lon + 540) % 360) + 360) % 360 - 180) * east, (site.lat - anchor.lat) * METERS_PER_DEGREE] as const,
  )
  const ends = [0]
  for (let i = 1; i < local.length; i++) ends.push(ends[i - 1]! + Math.hypot(local[i]![0] - local[i - 1]![0], local[i]![1] - local[i - 1]![1]))
  const length = ends.at(-1)!

  // The point `along` meters down the route, moved `side` meters to the
  // right of its leg. The side follows the leg, not the walking direction,
  // so nobody swaps sides when the group turns back.
  const at = (along: number, side: number): [number, number] => {
    let leg = 1
    while (leg < ends.length - 1 && ends[leg]! < along) leg++
    const span = ends[leg]! - ends[leg - 1]!
    const t = span > 0 ? (along - ends[leg - 1]!) / span : 0
    const [ax, ay] = local[leg - 1]!
    const [bx, by] = local[leg]!
    const [rx, ry] = span > 0 ? [(by - ay) / span, -(bx - ax) / span] : [0, 0]
    return [ax + (bx - ax) * t + rx * side, ay + (by - ay) * t + ry * side]
  }
  // Without a route: a circle of its own for each person around the site.
  const circle = (member: number): [number, number] => {
    const angle = member * 2.4 + seconds / (100 + member * 15)
    const radius = 45 + (member % 6) * 24
    return [Math.cos(angle) * radius, Math.sin(angle) * radius]
  }

  return mission.crew.map((person, member) => {
    let point: [number, number]
    if (length < MIN_ROUTE) point = circle(member)
    else {
      // Out to the last site and back again. At the start the back row is at
      // the first site and the others are just ahead of it. A person alone in
      // the last row walks in the middle.
      const rows = Math.ceil(mission.crew.length / 2)
      const row = Math.floor(member / 2)
      const alone = member === mission.crew.length - 1 && member % 2 === 0
      const side = alone ? 0 : ((member % 2) - 0.5) * SIDE_GAP
      const lap = 2 * length
      const walked = (((seconds * WALK_SPEED + (rows - 1 - row) * ROW_GAP) % lap) + lap) % lap
      point = at(walked <= length ? walked : lap - walked, side)
    }
    return {
      member,
      name: person.name,
      self: member === self,
      lat: Math.max(-90, Math.min(90, anchor.lat + point[1] / METERS_PER_DEGREE)),
      lon: (((anchor.lon + point[0] / east) % 360) + 360) % 360,
    }
  })
}

// Hidden tabs and a paused simulation do not accrue time or trigger frames.
export function advanceSimulation(seconds: number, elapsedMs: number, running: boolean): number {
  return seconds + (running ? Math.max(0, Math.min(elapsedMs, 1500)) / 1000 : 0)
}
