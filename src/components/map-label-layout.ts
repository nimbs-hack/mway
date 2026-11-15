export type Rect = { x: number; y: number; width: number; height: number }
// `radius` is the ring a cluster draws around its points; a pin has none.
export type LabelAnchor = { id: string; x: number; y: number; width: number; selected?: boolean; members?: string[]; radius?: number }
export type Side = 'left' | 'right'
// Where a label sits relative to its anchor, in screen pixels.
export type Offset = { side: Side; dx: number; dy: number }
export type PlacedLabel = LabelAnchor & { box: Rect; side: Side; offset: Offset }
export const LABEL_HEIGHT = 28
const GAP = 4
const INSET = 12
const ELBOW = 12
const PIN = 9
// Anchors closer than this on screen read as one spot.
export const CLUSTER_RADIUS = 36
// A cluster holds together until its points spread this much further, so
// a slow zoom does not make it flicker apart and back.
const CLUSTER_HOLD = 1.5
// More leaders than this from one spot turn into a fan nobody can trace.
export const MAX_FAN = 3

// Nearest spots first: straight across, then a row up or down, then further out.
const OFFSETS: Offset[] = (() => {
  const out: Offset[] = []
  for (const dx of [20, 44, 84]) {
    for (const dy of [0, -32, 32, -64, 64, -96, 96, -128, 128]) {
      for (const side of ['right', 'left'] as const) out.push({ side, dx, dy })
    }
  }
  return out.sort((a, b) => a.dx + Math.abs(a.dy) - (b.dx + Math.abs(b.dy)))
})()

export function overlaps(a: Rect, b: Rect, gap = GAP): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}

type Point = { x: number; y: number }
type Segment = [Point, Point]

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

export function segmentsCross([a, b]: Segment, [c, d]: Segment): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function segmentHitsRect(segment: Segment, rect: Rect): boolean {
  const inside = (p: Point) => p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height
  if (inside(segment[0]) || inside(segment[1])) return true
  const tl = { x: rect.x, y: rect.y }
  const tr = { x: rect.x + rect.width, y: rect.y }
  const bl = { x: rect.x, y: rect.y + rect.height }
  const br = { x: rect.x + rect.width, y: rect.y + rect.height }
  return ([[tl, tr], [tr, br], [br, bl], [bl, tl]] as Segment[]).some((edge) => segmentsCross(segment, edge))
}

// The box for a label at an offset, and the leader from the anchor (or its
// ring edge) to the elbow and on to the box.
export function labelGeometry(anchor: LabelAnchor, offset: Offset) {
  const reach = (anchor.radius ?? 0) + offset.dx
  const x = offset.side === 'right' ? anchor.x + reach : anchor.x - reach - anchor.width
  const box = { x, y: anchor.y + offset.dy - LABEL_HEIGHT / 2, width: anchor.width, height: LABEL_HEIGHT }
  return { box, leader: leaderPath(anchor, box, offset.side) }
}

export function leaderPath(anchor: LabelAnchor, box: Rect, side: Side): Point[] {
  const endX = side === 'right' ? box.x : box.x + box.width
  const endY = box.y + box.height / 2
  const elbow = { x: endX + (side === 'right' ? -ELBOW : ELBOW), y: endY }
  const toElbow = Math.hypot(elbow.x - anchor.x, elbow.y - anchor.y) || 1
  const ring = Math.min(1, (anchor.radius ?? 0) / toElbow)
  const start = { x: anchor.x + (elbow.x - anchor.x) * ring, y: anchor.y + (elbow.y - anchor.y) * ring }
  return [start, elbow, { x: endX, y: endY }]
}

// Collapse a dense spot into one cluster label, like map pin clustering.
// The selected anchor and any listed in `expanded` always keep their own row.
// `previous` maps an anchor id to the cluster it was in last frame.
export function clusterAnchors(
  anchors: LabelAnchor[],
  clusterWidth: (members: LabelAnchor[]) => number,
  expanded: ReadonlySet<string> = new Set(),
  previous: ReadonlyMap<string, string> = new Map(),
  radius = CLUSTER_RADIUS,
  maxFan = MAX_FAN,
): LabelAnchor[] {
  const loose = anchors.filter((a) => !a.selected && !expanded.has(a.id))
  const out = anchors.filter((a) => a.selected || expanded.has(a.id))
  const linked = (a: LabelAnchor, b: LabelAnchor) => {
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    if (distance < radius) return true
    const was = previous.get(a.id)
    return was !== undefined && was === previous.get(b.id) && distance < radius * CLUSTER_HOLD
  }
  const remaining = new Set(loose)
  while (remaining.size) {
    const first = remaining.values().next().value!
    remaining.delete(first)
    const group = [first]
    for (let i = 0; i < group.length; i++) {
      for (const candidate of remaining) {
        if (linked(candidate, group[i])) {
          group.push(candidate)
          remaining.delete(candidate)
        }
      }
    }
    if (group.length <= maxFan) {
      out.push(...group)
      continue
    }
    const members = group.map((a) => a.id).sort()
    const x = group.reduce((sum, a) => sum + a.x, 0) / group.length
    const y = group.reduce((sum, a) => sum + a.y, 0) / group.length
    out.push({
      id: `cluster:${members.join('|')}`,
      x,
      y,
      width: clusterWidth(group),
      members,
      radius: Math.max(...group.map((a) => Math.hypot(a.x - x, a.y - y))) + PIN,
    })
  }
  return out
}

// Each label sits near its own anchor. A label keeps last frame's offset
// while that spot stays clear, so labels ride along with the camera instead
// of being reshuffled. Labels that fit nowhere near their anchor are left
// out; the pin stays on the map.
export function placeMapLabels(
  anchors: LabelAnchor[],
  width: number,
  height: number,
  obstacles: Rect[] = [],
  previous: ReadonlyMap<string, Offset> = new Map(),
): PlacedLabel[] {
  const pins = anchors.map((a) => {
    const r = a.radius ?? PIN
    return { id: a.id, rect: { x: a.x - r, y: a.y - r, width: r * 2, height: r * 2 } }
  })
  const order = anchors.map((anchor, index) => ({ anchor, index })).sort((a, b) =>
    Number(Boolean(b.anchor.selected)) - Number(Boolean(a.anchor.selected))
    || Number(previous.has(b.anchor.id)) - Number(previous.has(a.anchor.id))
    || a.index - b.index)
  const boxes = [...obstacles]
  const leaders: Segment[] = []
  const placed: PlacedLabel[] = []
  for (const { anchor } of order) {
    const kept = previous.get(anchor.id)
    const candidates = kept ? [kept, ...OFFSETS] : OFFSETS
    let fallback: PlacedLabel | undefined
    let crowded: PlacedLabel | undefined
    let found: PlacedLabel | undefined
    for (const offset of candidates) {
      const { box, leader } = labelGeometry(anchor, offset)
      if (box.x < INSET || box.y < INSET || box.x + box.width > width - INSET || box.y + box.height > height - INSET) continue
      if (boxes.some((rect) => overlaps(box, rect))) continue
      if (pins.some((pin) => pin.id !== anchor.id && overlaps(box, pin.rect, 0))) continue
      const own: Segment[] = [[leader[0], leader[1]], [leader[1], leader[2]]]
      const label = { ...anchor, box, side: offset.side, offset }
      if (own.some((segment) => boxes.some((rect) => segmentHitsRect(segment, rect))) || leaders.some((segment) => segmentHitsRect(segment, box))) {
        // Crew can share a ground point with a site. Keep their names apart
        // even when a leader must pass behind another label to leave it.
        crowded ??= label
        continue
      }
      if (own.some((segment) => leaders.some((other) => segmentsCross(segment, other)))) {
        fallback ??= label
        continue
      }
      found = label
      break
    }
    found ??= fallback ?? crowded
    // A narrow view may have no room beside the selected anchor. Pull its
    // label inside the view rather than lose it.
    if (!found && anchor.selected) {
      const w = Math.min(anchor.width, width - INSET * 2)
      for (const offset of OFFSETS) {
        const at = labelGeometry({ ...anchor, width: w }, offset).box
        const box = { ...at, x: Math.max(INSET, Math.min(width - INSET - w, at.x)) }
        if (box.y < INSET || box.y + box.height > height - INSET || boxes.some((rect) => overlaps(box, rect))) continue
        found = { ...anchor, width: w, box, side: offset.side, offset }
        break
      }
    }
    if (!found) continue
    placed.push(found)
    boxes.push(found.box)
    const leader = leaderPath(found, found.box, found.side)
    leaders.push([leader[0], leader[1]], [leader[1], leader[2]])
  }
  return placed
}
