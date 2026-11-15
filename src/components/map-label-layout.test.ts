import { expect, test } from 'bun:test'
import { clusterAnchors, leaderPath, overlaps, placeMapLabels, segmentsCross, type LabelAnchor, type PlacedLabel } from './map-label-layout'

const crowded: LabelAnchor[] = Array.from({ length: 15 }, (_, i) => ({ id: `station-${i}`, x: 370 + i * 5, y: 380 + i % 3, width: 260 }))
// Points spread over a site, like the demo mission at walking zoom.
const spread: LabelAnchor[] = [
  { id: 'a', x: 430, y: 650, width: 260 },
  { id: 'b', x: 580, y: 790, width: 200 },
  { id: 'c', x: 1260, y: 845, width: 220 },
  { id: 'd', x: 1520, y: 715, width: 240 },
  { id: 'e', x: 1528, y: 778, width: 280 },
  { id: 'f', x: 900, y: 400, width: 180 },
]

function leaders(label: PlacedLabel) {
  const [a, b, c] = leaderPath(label, label.box, label.side)
  return [[a, b], [b, c]] as const
}

function checkClean(placed: PlacedLabel[], anchors: LabelAnchor[], width: number, height: number) {
  for (const label of placed) {
    expect(label.x).toBe(anchors.find((a) => a.id === label.id)!.x)
    expect(label.box.x).toBeGreaterThanOrEqual(12)
    expect(label.box.y).toBeGreaterThanOrEqual(12)
    expect(label.box.x + label.box.width).toBeLessThanOrEqual(width - 12)
    expect(label.box.y + label.box.height).toBeLessThanOrEqual(height - 12)
    for (const other of placed) {
      if (other.id === label.id) continue
      expect(overlaps(label.box, other.box)).toBe(false)
      for (const mine of leaders(label)) for (const theirs of leaders(other)) expect(segmentsCross(mine, theirs)).toBe(false)
    }
  }
}

test('spread points get short leaders that do not cross', () => {
  const placed = placeMapLabels(spread, 1826, 1500)
  expect(placed).toHaveLength(spread.length)
  checkClean(placed, spread, 1826, 1500)
  for (const label of placed) expect(label.offset.dx + Math.abs(label.offset.dy)).toBeLessThanOrEqual(84)
})

test('labels keep their offset while the camera pans', () => {
  const first = placeMapLabels(spread, 1826, 1500)
  const offsets = new Map(first.map((label) => [label.id, label.offset]))
  const panned = spread.map((a) => ({ ...a, x: a.x - 37, y: a.y + 21 }))
  const second = placeMapLabels(panned, 1826, 1500, [], offsets)
  for (const label of second) expect(label.offset).toEqual(offsets.get(label.id)!)
})

test('labels avoid map controls and other pins', () => {
  const blockers = [{ x: 600, y: 600, width: 400, height: 120 }]
  const placed = placeMapLabels(spread, 1826, 1500, blockers)
  checkClean(placed, spread, 1826, 1500)
  for (const label of placed) {
    expect(overlaps(label.box, blockers[0])).toBe(false)
    for (const pin of spread) if (pin.id !== label.id) expect(overlaps(label.box, { x: pin.x - 9, y: pin.y - 9, width: 18, height: 18 }, 0)).toBe(false)
  }
})

test('the selected label is placed first when space is short', () => {
  const small = placeMapLabels(crowded.map((point, i) => ({ ...point, x: 150, y: 120, selected: i === 14 })), 320, 220)
  expect(small.find((label) => label.selected)).toBeDefined()
  checkClean(small, crowded.map((p) => ({ ...p, x: 150 })), 320, 220)
})

test('a dense spot collapses into one cluster label and keeps the selected row out', () => {
  const anchors = crowded.map((point, i) => ({ ...point, selected: i === 3 }))
  const grouped = clusterAnchors(anchors, (group) => group.length * 10)
  const clusters = grouped.filter((a) => a.members)
  expect(clusters).toHaveLength(1)
  expect(clusters[0].members).toHaveLength(14)
  expect(clusters[0].members).not.toContain('station-3')
  expect(clusters[0].width).toBe(140)
  expect(clusters[0].radius).toBeGreaterThan(30)
  expect(grouped).toHaveLength(2)
})

test('small groups keep their own leaders and expanded points stay separate', () => {
  const few = crowded.slice(0, 3)
  expect(clusterAnchors(few, () => 0)).toEqual(few)
  const expanded = new Set(crowded.map((point) => point.id))
  expect(clusterAnchors(crowded, () => 0, expanded).every((a) => !a.members)).toBe(true)
  const apart = crowded.map((point, i) => ({ ...point, x: i * 60 }))
  expect(clusterAnchors(apart, () => 0).every((a) => !a.members)).toBe(true)
})

test('a cluster holds together while its points drift slightly apart', () => {
  const four = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, x: 100 + i * 40, y: 100, width: 100 }))
  expect(clusterAnchors(four, () => 0).some((a) => a.members)).toBe(false)
  const previous = new Map(four.map((a) => [a.id, 'cluster:p0|p1|p2|p3']))
  expect(clusterAnchors(four, () => 0, new Set(), previous).filter((a) => a.members)).toHaveLength(1)
})

test('six portrait labels stay separate when the crew gathers beside a site', () => {
  const crew = Array.from({ length: 6 }, (_, i) => ({
    id: `crew-${i}`, x: 700 + i * 4, y: 520 - i * 5, width: i === 0 ? 172 : 140, selected: i === 0,
  }))
  const placed = placeMapLabels(crew, 1440, 1000, [{ x: 708, y: 485, width: 80, height: 24 }])
  expect(placed).toHaveLength(6)
  for (const label of placed) for (const other of placed) {
    if (label.id !== other.id) expect(overlaps(label.box, other.box)).toBe(false)
  }
})
