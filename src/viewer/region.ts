import { MARS_RADIUS } from '../data/geo'
import type { Bounds } from './tiles'

const METERS_PER_DEGREE = MARS_RADIUS * Math.PI / 180
export interface MissionRegion {
  lat: number
  lon: number
  bounds: Bounds
}

// Planetocentric latitude and east longitude. Keep the smallest longitude
// arc continuous through the date line; tile columns wrap only at fetch.
export function missionRegion(points: ReadonlyArray<readonly [number, number]>): MissionRegion | null {
  const valid = points.filter(([lat, lon]) => Number.isFinite(lat + lon) && Math.abs(lat) <= 90)
  if (!valid.length) return null
  const lons = valid.map(([, lon]) => ((lon % 360) + 360) % 360).sort((a, b) => a - b)
  let gap = -1, after = 0
  for (let i = 0; i < lons.length; i++) {
    const next = (lons[(i + 1) % lons.length]! + (i === lons.length - 1 ? 360 : 0)) - lons[i]!
    if (next > gap) { gap = next; after = (i + 1) % lons.length }
  }
  const west = lons[after]!, east = west + 360 - gap
  const south = Math.min(...valid.map(([lat]) => lat)), north = Math.max(...valid.map(([lat]) => lat))
  const lat = (south + north) / 2, lon = (west + east) / 2
  // The route search looks up to 35% of a leg's length to either side of it
  // (src/data/route-options.ts), so the region reaches 40% of the mission's
  // longer side past each edge. 500 m at least, for the crew around a lone
  // site.
  const cos = Math.max(0.01, Math.cos(lat * Math.PI / 180))
  const reach = Math.max(500, 0.4 * Math.max((north - south) * METERS_PER_DEGREE, (east - west) * METERS_PER_DEGREE * cos))
  const latPad = reach / METERS_PER_DEGREE
  const lonPad = reach / (METERS_PER_DEGREE * cos)
  return { lat, lon, bounds: { south: Math.max(-90, south - latPad), north: Math.min(90, north + latPad), west: west - lonPad, east: east + lonPad } }
}

export function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const bounds = { south: Math.max(a.south,b.south), north: Math.min(a.north,b.north), west: Math.max(a.west,b.west), east: Math.min(a.east,b.east) }
  return bounds.south < bounds.north && bounds.west < bounds.east ? bounds : null
}
