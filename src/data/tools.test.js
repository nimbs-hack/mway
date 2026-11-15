import { expect, test } from 'bun:test'
import { distance } from './geo'
import { DEFAULT_LIMITS } from './plan'
import { flatReach, lastBearing, lineOfSight, pathLength, ring, terrainAlong } from './tools'

test('path length adds up the segments', () => {
  const points = [[0, 0], [0, 0.01], [0.01, 0.01]]
  expect(pathLength(points)).toBeCloseTo(distance(points[0], points[1]) + distance(points[1], points[2]), 6)
  expect(pathLength([[0, 0]])).toBe(0)
  expect(lastBearing(points)).toBeCloseTo(0, 3)
})

test('a ring keeps its radius all the way round', () => {
  const center = [-4.6, 137.4]
  for (const point of ring(center, 3000, 24)) expect(distance(center, point)).toBeCloseTo(3000, -1)
})

test('flat reach is half the walking time at flat pace', () => {
  const reach = flatReach(DEFAULT_LIMITS)
  expect(reach).toBeCloseTo(((DEFAULT_LIMITS.eva - DEFAULT_LIMITS.work) / 2) * DEFAULT_LIMITS.pace, 6)
  expect(flatReach({ ...DEFAULT_LIMITS, work: DEFAULT_LIMITS.eva * 2 })).toBe(0)
})

const flat = (n, length, bump = () => 0) => Array.from({ length: n }, (_, i) => {
  const d = (length * i) / (n - 1)
  return { d, elevation: bump(d) }
})

test('flat ground in short range is visible', () => {
  const sight = lineOfSight(flat(101, 1000), 1.8, 2)
  expect(sight.visible).toBe(true)
  expect(sight.clearance).toBeGreaterThan(1.5)
})

test('a ridge between blocks the view and says where', () => {
  const ridge = (d) => (d > 400 && d < 500 ? 30 : 0)
  const sight = lineOfSight(flat(101, 1000, ridge), 1.8, 2)
  expect(sight.visible).toBe(false)
  expect(sight.blockedAt).toBeGreaterThan(400)
  expect(sight.blockedAt).toBeLessThan(500)
  expect(sight.blockedBy).toBeGreaterThan(25)
})

test('the curve of Mars hides a low target far away', () => {
  // Over 10 km the ground bulges about 3.7 m above the chord.
  expect(lineOfSight(flat(201, 10_000), 1.8, 0.5).visible).toBe(false)
  expect(lineOfSight(flat(201, 10_000), 10, 10).visible).toBe(true)
})

test('terrain along a line sums climb and descent', () => {
  const t = terrainAlong([
    { d: 0, elevation: 0, slope: 2 }, { d: 1, elevation: 10, slope: 8 },
    { d: 2, elevation: 4, slope: 5 }, { d: 3, elevation: null, slope: null },
  ])
  expect(t).toEqual({ climb: 10, descent: 6, maxSlope: 8, low: 0, high: 10 })
})
