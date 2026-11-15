import { expect, test } from 'bun:test'
import type { Mission } from '../api'
import { distance } from '../data/geo'
import { ROW_GAP, SIDE_GAP, WALK_SPEED, advanceSimulation, simulatedPositions } from './live'

const mission = {
  crew: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }],
  sites: [{ name: 'Base', lat: -4.6, lon: 137.4 }],
} as Mission

test('each crew member gets a distinct position and only the chosen person is You', () => {
  const positions = simulatedPositions(mission, 0, 1)
  expect(positions.map((p) => p.name)).toEqual(['Alex', 'Sam', 'Jo'])
  expect(positions.filter((p) => p.self).map((p) => p.member)).toEqual([1])
  expect(new Set(positions.map((p) => `${p.lat},${p.lon}`)).size).toBe(3)
  for (const p of positions) expect(distance([p.lat, p.lon], [-4.6, 137.4])).toBeLessThan(170)
})

test('positions move without changing the mission or inventing people', () => {
  const original = JSON.stringify(mission)
  expect(simulatedPositions(mission, 10, 0)).not.toEqual(simulatedPositions(mission, 0, 0))
  expect(JSON.stringify(mission)).toBe(original)
  expect(simulatedPositions({ crew: [], sites: mission.sites }, 0, 0)).toEqual([])
  expect(simulatedPositions({ crew: mission.crew, sites: [] }, 0, 0)).toEqual([])
})

test('positions stay finite and east-positive at the date line and poles', () => {
  for (const lat of [-90, 90, 0]) {
    const points = simulatedPositions({ ...mission, sites: [{ name: 'Base', lat, lon: -0.001 }] }, 100, 0)
    for (const p of points) {
      expect(p.lat).toBeGreaterThanOrEqual(-90)
      expect(p.lat).toBeLessThanOrEqual(90)
      expect(p.lon).toBeGreaterThanOrEqual(0)
      expect(p.lon).toBeLessThan(360)
    }
  }
})

// Two sites about 1.2 km apart along the equator, then one north of the second.
const route = {
  crew: mission.crew,
  sites: [
    { name: 'Base', lat: 0, lon: 359.99 },
    { name: 'Ridge', lat: 0, lon: 0.01 },
    { name: 'Crater', lat: 0.02, lon: 0.01 },
  ],
} as Mission
const firstLeg = distance([0, 359.99], [0, 0.01])
const secondLeg = distance([0, 0.01], [0.02, 0.01])

test('with a route, the crew walks beside its legs and nowhere else', () => {
  // Half a row's width either side of the line, in degrees here at the equator.
  const off = (SIDE_GAP / 2) / distance([0, 0], [0, 1]) + 1e-9
  for (const seconds of [0, 300, 1000, 1500, 2200, 4000]) {
    for (const p of simulatedPositions(route, seconds, 0)) {
      // Beside the first leg: by the equator between the two sites, across the date line.
      const onFirst = Math.abs(p.lat) <= off && (p.lon >= 359.99 - off || p.lon <= 0.01 + off)
      // Beside the second leg: by the 0.01° meridian between the two latitudes.
      const onSecond = Math.abs(p.lon - 0.01) <= off && p.lat >= -off && p.lat <= 0.02 + off
      expect(onFirst || onSecond).toBe(true)
    }
  }
})

test('the last person starts at the first site, reaches the last, and turns back', () => {
  const total = firstLeg + secondLeg
  const last = (seconds: number) => simulatedPositions(route, seconds, 0).at(-1)!
  expect(distance([last(0).lat, last(0).lon], [0, 359.99])).toBeLessThan(1)
  const out = total / WALK_SPEED
  expect(distance([last(out).lat, last(out).lon], [0.02, 0.01])).toBeLessThan(1)
  expect(distance([last(2 * out).lat, last(2 * out).lon], [0, 359.99])).toBeLessThan(1)
  const later = last(60)
  expect(distance([later.lat, later.lon], [0, 359.99])).toBeCloseTo(60 * WALK_SPEED, 0)
})

test('at the start everyone walks away from the first site', () => {
  const now = simulatedPositions(route, 0, 0)
  const soon = simulatedPositions(route, 10, 0)
  now.forEach((p, i) => {
    const q = soon[i]!
    expect(distance([q.lat, q.lon], [0, 359.99])).toBeGreaterThan(distance([p.lat, p.lon], [0, 359.99]))
  })
})

test('the crew walks as one group, two abreast', () => {
  const group = simulatedPositions(route, 200, 0)
  const [a, b, c] = group
  expect(distance([a!.lat, a!.lon], [b!.lat, b!.lon])).toBeCloseTo(SIDE_GAP, 1)
  expect(distance([a!.lat, a!.lon], [c!.lat, c!.lon])).toBeCloseTo(Math.hypot(ROW_GAP, SIDE_GAP / 2), 1)
  for (const p of group) for (const q of group) expect(distance([p.lat, p.lon], [q.lat, q.lon])).toBeLessThan(15)
})

test('pause and hidden tabs freeze time, resume does not jump', () => {
  expect(advanceSimulation(20, 1000, false)).toBe(20)
  expect(advanceSimulation(20, 1000, true)).toBe(21)
  expect(advanceSimulation(20, 60000, true)).toBe(21.5)
  expect(advanceSimulation(20, -100, true)).toBe(20)
})
