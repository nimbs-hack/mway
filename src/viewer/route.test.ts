import { expect, test } from 'bun:test'
import { type LatLon, distance } from '../data/geo'
import { DEFAULT_LIMITS } from '../data/limits'
import { routeLine, routeSites } from './route'

// Three sites about a kilometer apart near Gale crater.
const sites: LatLon[] = [
  [-4.6, 137.4],
  [-4.6, 137.417],
  [-4.583, 137.417],
]
const flat = () => 0

test('on flat ground every leg is found and runs from site to site', () => {
  const route = routeSites(sites, flat)
  expect(route.legs.map((leg) => leg.status)).toEqual(['ok', 'ok'])
  route.legs.forEach((leg, i) => {
    expect(leg.points[0]).toEqual(sites[i]!)
    expect(leg.points.at(-1)).toEqual(sites[i + 1]!)
    // Flat ground: the shortest path is the straight one, give or take the grid.
    expect(leg.distance).toBeLessThan(distance(sites[i]!, sites[i + 1]!) * 1.1)
  })
  const line = routeLine(route)
  expect(line[0]).toEqual(sites[0]!)
  expect(line.at(-1)).toEqual(sites[2]!)
  expect(route.distance).toBeCloseTo(route.legs[0]!.distance + route.legs[1]!.distance, 6)
})

test('a ridge across the straight line is walked around', () => {
  // A wall 200 m high and 40 m wide halfway along the first leg, with a gap
  // to the south.
  const wall = (lat: number, lon: number) => (Math.abs(lon - 137.4085) < 0.0004 && lat > -4.6025 ? 200 : 0)
  const [leg] = routeSites(sites.slice(0, 2), wall).legs
  expect(leg!.status).toBe('ok')
  expect(leg!.points.some(([lat]) => lat <= -4.6025)).toBe(true)
  expect(leg!.distance).toBeGreaterThan(distance(sites[0]!, sites[1]!))
  expect(leg!.maxSlope!).toBeLessThanOrEqual(DEFAULT_LIMITS.slope)
})

test('a leg with no path under the limit is drawn straight and says what limit would work', () => {
  // A wall right across the corridor, too steep for 20 degrees.
  const wall = (_lat: number, lon: number) => (lon > 137.4085 ? 300 : 0)
  const [leg] = routeSites(sites.slice(0, 2), wall).legs
  expect(leg!.status).toBe('blocked')
  expect(leg!.points).toEqual([sites[0]!, sites[1]!])
  expect(leg!.needs).toBeGreaterThan(DEFAULT_LIMITS.slope)
})

test('missing terrain at an end leaves the leg unknown, not clear', () => {
  const [leg] = routeSites(sites.slice(0, 2), () => null).legs
  expect(leg!.status).toBe('unknown')
  expect(leg!.points).toEqual([sites[0]!, sites[1]!])
})

test('one site has no legs', () => {
  expect(routeSites(sites.slice(0, 1), flat).legs).toEqual([])
})
