import type { Astronaut } from '../api'
import { bearing, cumulative, MARS_RADIUS, type LatLon } from './geo'

export interface CrewTrack {
  id: string
  name: string
  positionAt: (seconds: number) => LatLon
}

const RAD = Math.PI / 180

// Planetocentric latitude, east longitude -180..180. Great-circle offsets
// keep generated positions valid across the date line and near the poles.
function destination([lat, lon]: LatLon, heading: number, meters: number): LatLon {
  const angle = meters / MARS_RADIUS
  const latitude = lat * RAD
  const direction = heading * RAD
  const next = Math.asin(Math.max(-1, Math.min(1,
    Math.sin(latitude) * Math.cos(angle) + Math.cos(latitude) * Math.sin(angle) * Math.cos(direction),
  )))
  const longitude = lon + Math.atan2(
    Math.sin(direction) * Math.sin(angle) * Math.cos(latitude),
    Math.cos(angle) - Math.sin(latitude) * Math.sin(next),
  ) / RAD
  return [next / RAD, ((longitude + 540) % 360) - 180]
}

// Generated movement for the presentation, with no telemetry or effect on
// route assessment, resource calculations, saved missions or HUD snapshots.
// Most of the crew stay at the start. One or two walk beside the route.
export function createCrewSimulation(crew: Pick<Astronaut, 'name'>[], route: LatLon[] | null, anchor: LatLon): CrewTrack[] {
  const path = route ?? []
  const along = path.length ? cumulative(path) : [0]
  const total = along[along.length - 1]
  const headings = path.slice(1).map((point, i) => bearing(path[i], point))
  const scouts = Math.min(2, Math.floor(crew.length / 2))
  const onRoute = (meters: number): LatLon => {
    const distance = Math.max(0, Math.min(total, meters))
    let lo = 0
    let hi = path.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (along[mid] <= distance) lo = mid
      else hi = mid
    }
    return destination(path[lo], headings[lo], distance - along[lo])
  }
  return crew.map((person, index) => {
    const speed = 1.1 + (index % 4) * 0.08
    const phase = (index + 1) / (crew.length + 1)
    return {
      id: `crew-${index}`,
      name: person.name.trim() || `Crew member ${index + 1}`,
      positionAt(seconds) {
        const elapsed = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
        if (index >= scouts || path.length < 2 || total < 1) {
          const radius = 12 + index * 4
          return destination(path[0] ?? anchor, phase * 360 + elapsed * 0.6, radius)
        }
        const roam = Math.min(40, total * 0.05)
        const distance = total * (0.3 + index * 0.25) + Math.sin(elapsed * speed / roam) * roam
        const heading = bearing(onRoute(distance - 20), onRoute(distance + 20))
        return destination(onRoute(distance), heading + (index % 2 ? -90 : 90), 12 + index * 6)
      },
    }
  })
}
