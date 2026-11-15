import { Cartesian2, Cartesian3 } from 'cesium'
import type { EllipsoidalOccluder, Scene } from 'cesium'

// One point of an overlay line. `depth` is meters in front of the camera
// along its view direction, negative behind it. `hidden` means the planet's
// limb covers the point. `screen` is null when the point can't be drawn.
export type End = { position: Cartesian3, screen: Cartesian2 | null, depth: number, hidden: boolean }

// The drawable part of the segment from points[index - 1] to points[index].
// `ta` and `tb` are its ends as fractions of the segment on the ground, and
// `wa` and `wb` the depths there.
export type Piece = { index: number, ax: number, ay: number, bx: number, by: number, ta: number, tb: number, wa: number, wb: number }

// How far past the canvas a line is kept, in pixels. Wide, so screen dashes
// start at the line's own point whenever that point is near the view.
export const WIDE_MARGIN = 4096
// Just enough to keep line caps out of view.
export const TIGHT_MARGIN = 64
// Bisection steps to find where a segment crosses the limb.
const LIMB_STEPS = 12

/**
 * Clips the segment (x0, y0)-(x1, y1) to a box. Returns the fractions of the
 * segment where it enters and leaves, or null when it misses the box.
 */
export function clipToBox(
  x0: number, y0: number, x1: number, y1: number,
  left: number, top: number, right: number, bottom: number,
): [number, number] | null {
  let enter = 0
  let leave = 1
  // Liang-Barsky: `p` is the speed toward an edge, `q` the room before it.
  const edge = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > leave) return false
      if (r > enter) enter = r
    } else {
      if (r < enter) return false
      if (r < leave) leave = r
    }
    return true
  }
  const dx = x1 - x0
  const dy = y1 - y0
  if (!edge(-dx, x0 - left) || !edge(dx, right - x0) || !edge(-dy, y0 - top) || !edge(dy, bottom - y0)) return null
  return [enter, leave]
}

// Perspective draws the near end of a segment larger, so a fraction of its
// length on screen is not the same fraction on the ground. These convert
// between the two for a segment whose ends are `wa` and `wb` deep.
export const groundFraction = (s: number, wa: number, wb: number) => (s * wa) / ((1 - s) * wb + s * wa)
export const screenFraction = (t: number, wa: number, wb: number) => (t * wb) / ((1 - t) * wa + t * wb)

/**
 * Finds the drawable part of each segment of a line. Testing only the points
 * loses a whole segment when one end is behind the camera or over the limb,
 * which happens to any long leg once the camera is close to the ground.
 */
export function segmentClipper(scene: Scene, occluder: EllipsoidalOccluder) {
  const offset = new Cartesian3()
  const middle = new Cartesian3()
  const first = new Cartesian2()
  const second = new Cartesian2()
  let near = 1
  let width = 0
  let height = 0

  const hiddenAt = (a: End, b: End, t: number) => (t === 0 ? a.hidden : t === 1 ? b.hidden
    : !occluder.isPointVisible(Cartesian3.lerp(a.position, b.position, t, middle)))
  const screenAt = (a: End, b: End, t: number, result: Cartesian2) => (t === 0 ? a.screen : t === 1 ? b.screen
    : scene.cartesianToCanvasCoordinates(Cartesian3.lerp(a.position, b.position, t, middle), result) ?? null)

  const piece = (a: End, b: End, index: number, margin: number): Piece | null => {
    if (a.depth < near && b.depth < near) return null
    const span = b.depth - a.depth
    let t0 = a.depth < near ? (near - a.depth) / span : 0
    let t1 = b.depth < near ? (near - a.depth) / span : 1
    const hidden0 = hiddenAt(a, b, t0)
    const hidden1 = hiddenAt(a, b, t1)
    if (hidden0 && hidden1) return null
    if (hidden0 || hidden1) {
      let shown = hidden0 ? t1 : t0
      let covered = hidden0 ? t0 : t1
      for (let i = 0; i < LIMB_STEPS; i++) {
        const t = (shown + covered) / 2
        if (hiddenAt(a, b, t)) covered = t
        else shown = t
      }
      if (hidden0) t0 = shown
      else t1 = shown
    }
    const p0 = screenAt(a, b, t0, first)
    const p1 = screenAt(a, b, t1, second)
    if (!p0 || !p1) return null
    const inside = clipToBox(p0.x, p0.y, p1.x, p1.y, -margin, -margin, width + margin, height + margin)
    if (!inside) return null
    const w0 = a.depth + t0 * span
    const w1 = a.depth + t1 * span
    const ta = t0 + groundFraction(inside[0], w0, w1) * (t1 - t0)
    const tb = t0 + groundFraction(inside[1], w0, w1) * (t1 - t0)
    return {
      index,
      ax: p0.x + (p1.x - p0.x) * inside[0],
      ay: p0.y + (p1.y - p0.y) * inside[0],
      bx: p0.x + (p1.x - p0.x) * inside[1],
      by: p0.y + (p1.y - p0.y) * inside[1],
      ta,
      tb,
      wa: a.depth + ta * span,
      wb: a.depth + tb * span,
    }
  }

  return {
    // Call once a frame, before placing points.
    frame() {
      // Cesium projects nothing closer than about twice the near plane.
      near = Math.max(1, 4 * scene.camera.frustum.near)
      width = scene.canvas.clientWidth
      height = scene.canvas.clientHeight
    },
    // Fills in depth, hidden and screen from the point's position.
    place(end: End) {
      const { camera } = scene
      end.depth = Cartesian3.dot(Cartesian3.subtract(end.position, camera.positionWC, offset), camera.directionWC)
      end.hidden = !occluder.isPointVisible(end.position)
      end.screen = !end.hidden && end.depth >= near
        ? scene.cartesianToCanvasCoordinates(end.position, end.screen ?? new Cartesian2()) ?? null
        : null
      return end.screen
    },
    // The drawable pieces of a line through placed points, in order.
    pieces(points: End[], margin = WIDE_MARGIN) {
      const out: Piece[] = []
      for (let i = 1; i < points.length; i++) {
        const next = piece(points[i - 1], points[i], i, margin)
        if (next) out.push(next)
      }
      return out
    },
  }
}

// Adds pieces to a new path. Whole neighbors stay joined, so screen dashes
// run through a point without restarting.
export function tracePieces(context: CanvasRenderingContext2D, pieces: Piece[]) {
  context.beginPath()
  let last: Piece | undefined
  for (const piece of pieces) {
    if (!last || last.index !== piece.index - 1 || last.tb !== 1 || piece.ta !== 0) context.moveTo(piece.ax, piece.ay)
    context.lineTo(piece.bx, piece.by)
    last = piece
  }
}
