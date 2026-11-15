import { expect, test } from 'bun:test'
import { missionRegion, intersectBounds } from './region'

test('no mission location means no terrain region', () => {
  expect(missionRegion([])).toBeNull()
  expect(missionRegion([[NaN, 20], [100, 20]])).toBeNull()
})
test('a lone site loads a local segment with a crew buffer', () => {
  const { bounds } = missionRegion([[-4.6,137.4]])!
  expect(bounds.north-bounds.south).toBeLessThan(0.02)
  expect(bounds.east-bounds.west).toBeLessThan(0.02)
  expect(bounds.west).toBeLessThan(137.4)
  expect(bounds.east).toBeGreaterThan(137.4)
})
test('date-line missions use a short arc, not the whole planet', () => {
  const { bounds } = missionRegion([[0,179.99],[0,-179.99]])!
  expect(bounds.east-bounds.west).toBeLessThan(0.05)
  const zero = missionRegion([[0,359.99],[0,0.01]])!
  expect(zero.bounds.east-zero.bounds.west).toBeLessThan(0.05)
})
test('camera tile requests stay inside the mission segment', () => {
  const region = missionRegion([[-4.6,137.4],[-4.61,137.42]])!
  const world = {south:-90,north:90,west:-180,east:540}
  expect(intersectBounds(world,region.bounds)).toEqual(region.bounds)
  expect(intersectBounds({south:20,north:21,west:0,east:1},region.bounds)).toBeNull()
})
test('polar bounds remain finite and within latitude limits', () => {
  for(const lat of [-90,90]) {
    const region=missionRegion([[lat,0]])!
    expect(region.bounds.south).toBeGreaterThanOrEqual(-90)
    expect(region.bounds.north).toBeLessThanOrEqual(90)
    expect(Number.isFinite(region.bounds.east)).toBe(true)
  }
})
