// Geometry on the Mars sphere used by the terrain tiles (radius 3,396,190 m).
// Coordinates are planetocentric latitude and east longitude in degrees,
// -180 to 180, the same convention as src/data/sites.js. Distances in meters.

export const MARS_RADIUS = 3_396_190
const rad = Math.PI / 180

export type LatLon = [lat: number, lon: number]

export function distance([lat1, lon1]: LatLon, [lat2, lon2]: LatLon) {
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Initial bearing from a to b, degrees clockwise from north, 0 to 360.
export function bearing([lat1, lon1]: LatLon, [lat2, lon2]: LatLon) {
  const dLon = (lon2 - lon1) * rad
  const y = Math.sin(dLon) * Math.cos(lat2 * rad)
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon)
  return ((Math.atan2(y, x) / rad) + 360) % 360
}

// Moves a point by north and east offsets in meters. Fine for offsets of a
// few hundred meters, which is all the slope sampling needs.
export function offset([lat, lon]: LatLon, north: number, east: number): LatLon {
  return [lat + (north / MARS_RADIUS) / rad, lon + (east / (MARS_RADIUS * Math.cos(lat * rad))) / rad]
}

export function cumulative(path: LatLon[]) {
  const out = [0]
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + distance(path[i - 1], path[i]))
  return out
}

// Point at a distance along the path, linear between vertices.
export function pointAt(path: LatLon[], along: number[], d: number): LatLon {
  if (d <= 0) return path[0]
  const last = path.length - 1
  if (d >= along[last]) return path[last]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (along[mid] <= d) lo = mid
    else hi = mid
  }
  const span = along[hi] - along[lo] || 1
  const t = (d - along[lo]) / span
  return [path[lo][0] + (path[hi][0] - path[lo][0]) * t, path[lo][1] + (path[hi][1] - path[lo][1]) * t]
}

// Evenly spaced samples along the path, always including both ends.
export function resample(path: LatLon[], count: number) {
  const along = cumulative(path)
  const total = along[along.length - 1]
  const n = Math.max(2, count)
  return Array.from({ length: n }, (_, i) => {
    const d = (total * i) / (n - 1)
    return { d, point: pointAt(path, along, d) }
  })
}

// The trailing part of a path that covers `meters`, for an EVA-sized segment.
export function tail(path: LatLon[], meters: number): LatLon[] {
  const along = cumulative(path)
  const total = along[along.length - 1]
  if (total <= meters) return path
  const start = total - meters
  const index = along.findIndex((d) => d >= start)
  return [pointAt(path, along, start), ...path.slice(index)]
}
