import { expect, test } from 'bun:test'
import { coverage, detailLabel, detailMeters, levelAt, outline, slopeBaseline } from './terrain-detail'

test('tile levels map to ground detail', () => {
  expect(detailMeters(9)).toBeCloseTo(325.6, 0)
  expect(detailMeters(12)).toBeCloseTo(40.7, 0)
  expect(detailMeters(17)).toBeCloseTo(1.27, 2)
  expect(detailLabel(1.27)).toBe('1.3 m')
  expect(detailLabel(40.7)).toBe('41 m')
})

test('coverage turns tile ranges into boxes', () => {
  // Level 1 is 4 by 2 tiles of 90°. Tile x 2, y 1 is the north-east of 0°E.
  const boxes = coverage([[], [{ startX: 2, startY: 1, endX: 2, endY: 1 }]], 1)
  expect(boxes).toEqual([[0, 0, 90, 90]])
  expect(outline(boxes[0])).toEqual([[90, 0], [90, 90], [0, 90], [0, 0], [90, 0]])
  expect(coverage([], 5)).toEqual([])
})

test('slope baseline follows the terrain detail within bounds', () => {
  expect(slopeBaseline(1.27)).toBe(5.08)
  expect(slopeBaseline(0.5)).toBe(5)
  expect(slopeBaseline(326)).toBe(60)
})

test('level lookup is null until availability loads', () => {
  expect(levelAt(null, [0, 0])).toBeNull()
  expect(levelAt({ availability: { computeMaximumLevelAtPosition: () => 17 } }, [18.4, 77.5])).toBe(17)
})
