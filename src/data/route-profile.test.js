import { expect, test } from 'bun:test'
import { bearing, distance, offset, resample, tail } from './geo'
import { pixelValue, rampPosition, tileFor } from './raster-sample'
import { guidance, slopeLevel, summarize, waypoints } from './route-profile'
import { slopeFromNeighbors } from './terrain-sample'

test('distances and bearings use the Mars sphere', () => {
  // One degree of latitude on a 3,396,190 m sphere.
  expect(distance([0, 0], [1, 0])).toBeCloseTo(59275, 0)
  expect(bearing([0, 0], [1, 0])).toBeCloseTo(0, 5)
  expect(bearing([0, 0], [0, 1])).toBeCloseTo(90, 5)
  const [lat, lon] = offset([-4.6, 137.4], 100, 0)
  expect(distance([-4.6, 137.4], [lat, lon])).toBeCloseTo(100, 3)
})

test('resampling keeps both ends and the tail covers the requested length', () => {
  const path = [[0, 0], [0, 0.01], [0, 0.02], [0, 0.05]]
  const samples = resample(path, 11)
  expect(samples).toHaveLength(11)
  expect(samples[0].point).toEqual([0, 0])
  expect(samples.at(-1).point).toEqual([0, 0.05])
  const end = tail(path, 1000)
  expect(end.at(-1)).toEqual([0, 0.05])
  const along = end.slice(1).reduce((sum, point, i) => sum + distance(end[i], point), 0)
  expect(along).toBeCloseTo(1000, 3)
  expect(tail(path, 1e9)).toBe(path)
})

test('slope comes from a centered difference', () => {
  expect(slopeFromNeighbors(10, 10, 10, 10, 60)).toBe(0)
  // 120 m rise across 120 m east-west baseline is 45°.
  expect(slopeFromNeighbors(0, 0, 60, -60, 60)).toBeCloseTo(45, 6)
  expect(slopeLevel(null)).toBe('unknown')
  expect(slopeLevel(14.9)).toBe('ok')
  expect(slopeLevel(15)).toBe('caution')
  expect(slopeLevel(20.1)).toBe('hazard')
})

test('tiles follow the north-origin grid with twice as many columns as rows', () => {
  expect(tileFor([89.9, -179.9], 0, 256)).toMatchObject({ x: 0, y: 0, px: 0, py: 0 })
  expect(tileFor([-89.9, 179.9], 0, 256)).toMatchObject({ x: 1, y: 0, px: 255, py: 255 })
  expect(tileFor([0.1, 0.1], 1, 256)).toMatchObject({ x: 2, y: 0 })
  expect(tileFor([-4.6, 137.4], 9, 256).x).toBe(Math.floor((137.4 + 180) / 360 * 1024))
})

test('pixels map to legend positions and transparent pixels mean no data', () => {
  const pixels = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]) }
  expect(pixelValue(pixels, 0, 0, [])).toBeCloseTo(1, 6)
  expect(pixelValue(pixels, 1, 0, [])).toBeNull()
  const stops = ['#000000', '#ff0000', '#ffffff']
  expect(rampPosition([0, 0, 0], stops)).toBe(0)
  expect(rampPosition([255, 0, 0], stops)).toBeCloseTo(0.5, 6)
  expect(rampPosition([255, 255, 255], stops)).toBe(1)
})

const sample = (d, elevation, slope) => ({ d, point: [0, d / 59275], elevation, slope, layers: {} })

test('summary totals climb, descent and distance over the limit', () => {
  const samples = [sample(0, 0, 5), sample(100, 10, 16), sample(200, 4, 25), sample(300, null, null), sample(400, 20, 3)]
  const summary = summarize(samples)
  expect(summary).toMatchObject({ distance: 400, climb: 10, descent: 6, maxSlope: 25, overLimit: 100, caution: 100, low: 0, high: 20 })
})

test('guidance points at the next waypoint and the steepest slope ahead', () => {
  const samples = Array.from({ length: 61 }, (_, i) => sample(i * 10, i, i === 33 ? 22 : 4))
  expect(waypoints(samples, 250).map((w) => w.d)).toEqual([250, 500, 600])
  const g = guidance(samples, 260)
  expect(g.next.index).toBe(2)
  expect(g.toNext).toBe(240)
  expect(g.slopeAhead).toBe(22)
  expect(g.heading).toBeCloseTo(90, 3)
  expect(g.remaining).toBe(340)
})
