import { Cartesian2, Cartesian3, Cartographic, EllipsoidalOccluder } from 'cesium'
import type { Viewer } from 'cesium'
import { DATUM_OFFSET } from '../data/terrain.js'
import { cumulative } from '../data/geo'
import type { LatLon } from '../data/geo'
import { TIGHT_MARGIN, screenFraction, segmentClipper, tracePieces } from './overlay-clip'
import type { End, Piece } from './overlay-clip'

export type PlanVertex = { point: LatLon, kind: 'start' | 'waypoint' | 'target', label: string }
export type RoutePoint = { point: LatLon, level: string }
// A suggested route drawn dashed under the plan. `focus` draws it brighter.
export type Alternative = { id: string, points: LatLon[], color: string, focus: boolean }
export type PlanColors = { text: string, bg: string, surface: string, dim: string, hazard: string, accent: string, ok: string }

// Line styles ported from deploy-v1 (apps/web/src/components/MapView.tsx).
// Selected: a dark 6.5 px halo at 72% under a solid 3.5 px accent line at
// 98%. Candidates keep deploy-v1's 6 5 dash on a continuous dark band, so
// they stay readable on ground of their own color and the gaps read as
// dark, not as grey ground. Unfocused lines fade slightly.
const CANDIDATE = { dash: [6, 5], width: 2.5, alpha: 0.9, casing: 5.5, casingAlpha: 0.85 }
const SELECTED = { halo: 6.5, haloAlpha: 0.72, width: 3.5, alpha: 0.98 }
// Over-limit stretches of the plan: red, and wider than the plan line.
const HAZARD = { halo: 9, width: 6 }
// How close the pointer must be to a candidate line to hover or pick it.
const LINE_HIT = 6

type Projected = End & { location: Cartographic }

const HIT_RADIUS = 14
// A terrain height is a ray cast against the tile mesh. While tiles stream
// in during a zoom they would be redone for every point on every frame, so
// tile changes refresh heights at most this often. New points and a new
// elevation scale are placed at once.
const HEIGHTS_MS = 400
const LABEL_FONT = '600 12px Inter, system-ui, sans-serif'

/**
 * Draws the EVA plan over the map on a 2D canvas, like route-overlay.ts:
 * the sampled route colored by slope level, or straight dashed legs until
 * samples arrive, plus start, waypoint and target handles. Coordinates are
 * planetocentric latitude and east longitude, -180 to 180.
 */
export function addPlanOverlay(viewer: Viewer, colors: PlanColors) {
  const { scene } = viewer
  const canvas = document.createElement('canvas')
  canvas.className = 'route-overlay'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')!
  viewer.container.appendChild(canvas)

  const occluder = new EllipsoidalOccluder(scene.ellipsoid, viewer.camera.positionWC)
  const clipper = segmentClipper(scene, occluder)
  let vertices: (PlanVertex & Projected)[] = []
  let route: (RoutePoint & Projected)[] = []
  // `along` is each point's ground distance from the route's start, which
  // anchors the dashes to the terrain. `pieces` is what the last frame drew.
  let alternatives: (Omit<Alternative, 'points'> & { points: ({ point: LatLon } & Projected)[], along: number[], pieces: Piece[] })[] = []
  let dragging: number | null = null
  // `heightsNow`: place every point this frame. `heightsStale`: tiles have
  // changed since the last pass. `heightsDirty` is set for one draw.
  let heightsDirty = false
  let heightsNow = true
  let heightsStale = false
  let lastHeights = 0
  let later: ReturnType<typeof setTimeout> | undefined
  let exaggeration = scene.verticalExaggeration
  const removeProgress = scene.globe.tileLoadProgressEvent.addEventListener(() => { heightsStale = true })

  const project = <T extends { point: LatLon }>(item: T): T & Projected => ({
    ...item,
    location: Cartographic.fromDegrees(item.point[1], item.point[0], DATUM_OFFSET),
    position: new Cartesian3(),
    screen: null,
    depth: 0,
    hidden: false,
  })

  const place = (p: Projected) => {
    if (heightsDirty) {
      // getHeight already includes the scene's elevation exaggeration.
      p.location.height = scene.globe.getHeight(p.location) ?? DATUM_OFFSET
      scene.ellipsoid.cartographicToCartesian(p.location, p.position)
    }
    return clipper.place(p)
  }

  // Candidates are drawn one at a time here, then copied over, so cutting the
  // middle out of one outline never erases a line drawn before it.
  const scratch = document.createElement('canvas')
  const scratchContext = scratch.getContext('2d')!

  const strokeSelected = () => {
    context.globalAlpha = SELECTED.haloAlpha
    context.strokeStyle = colors.bg
    context.lineWidth = SELECTED.halo
    context.stroke()
    context.globalAlpha = SELECTED.alpha
    context.strokeStyle = colors.accent
    context.lineWidth = SELECTED.width
    context.stroke()
    context.globalAlpha = 1
  }

  // The plan is the selected route. Stretches over the slope limit go red
  // on top of it, since a hand-drawn plan can cross the limit. They are
  // drawn wider too, so they differ by more than color (V2 10045).
  const drawRoute = () => {
    for (const p of route) place(p)
    const pieces = clipper.pieces(route)
    tracePieces(context, pieces)
    strokeSelected()
    context.beginPath()
    for (const piece of pieces) {
      if (route[piece.index].level !== 'hazard') continue
      context.moveTo(piece.ax, piece.ay)
      context.lineTo(piece.bx, piece.by)
    }
    context.globalAlpha = SELECTED.haloAlpha
    context.strokeStyle = colors.bg
    context.lineWidth = HAZARD.halo
    context.stroke()
    context.globalAlpha = 1
    context.strokeStyle = colors.hazard
    context.lineWidth = HAZARD.width
    context.stroke()
  }

  // Straight legs while terrain samples load, or while a handle is dragged.
  const drawLegs = () => {
    tracePieces(context, clipper.pieces(vertices))
    context.setLineDash(CANDIDATE.dash)
    strokeSelected()
    context.setLineDash([])
  }

  // Dashes fixed to the ground, so they don't slide as the camera moves.
  // The period is the power of two in meters nearest to the 6 5 pattern's
  // 11 px at the current zoom. Zooming past a step halves or doubles it, and
  // every other dash boundary stays where it was.
  // Only the stretch in view is measured and dashed, so a leg that runs
  // kilometers past the edge costs nothing.
  const groundDashes = (target: CanvasRenderingContext2D, pieces: Piece[], along: number[]) => {
    const meter = (p: Piece, t: number) => along[p.index - 1] + t * (along[p.index] - along[p.index - 1])
    let pixels = 0
    let meters = 0
    for (const p of pieces) {
      pixels += Math.hypot(p.bx - p.ax, p.by - p.ay)
      meters += meter(p, p.tb) - meter(p, p.ta)
    }
    target.beginPath()
    if (pixels <= 0 || meters <= 0) return
    const pattern = CANDIDATE.dash[0] + CANDIDATE.dash[1]
    const period = 2 ** Math.round(Math.log2((pattern * meters) / pixels))
    const on = (period * CANDIDATE.dash[0]) / pattern
    for (const p of pieces) {
      const d0 = meter(p, p.ta)
      const d1 = meter(p, p.tb)
      if (d1 <= d0) continue
      const at = (d: number) => {
        const s = screenFraction((d - d0) / (d1 - d0), p.wa, p.wb)
        return [p.ax + (p.bx - p.ax) * s, p.ay + (p.by - p.ay) * s]
      }
      for (let start = Math.floor(d0 / period) * period; start < d1; start += period) {
        const from = Math.max(d0, start)
        const to = Math.min(d1, start + on)
        if (to <= from) continue
        const [x0, y0] = at(from)
        const [x1, y1] = at(to)
        target.moveTo(x0, y0)
        target.lineTo(x1, y1)
      }
    }
  }

  const drawAlternatives = (scale: number) => {
    if (scratch.width !== canvas.width || scratch.height !== canvas.height) {
      scratch.width = canvas.width
      scratch.height = canvas.height
    }
    const sc = scratchContext
    // Unfocused first, so the focused one lands on top.
    for (const alt of [...alternatives].sort((a, b) => Number(a.focus) - Number(b.focus))) {
      for (const p of alt.points) place(p)
      const width = alt.focus ? SELECTED.width : CANDIDATE.width
      sc.setTransform(1, 0, 0, 1, 0, 0)
      sc.clearRect(0, 0, scratch.width, scratch.height)
      sc.setTransform(scale, 0, 0, scale, 0, 0)
      sc.lineJoin = 'round'
      sc.lineCap = 'round'
      alt.pieces = clipper.pieces(alt.points, TIGHT_MARGIN)
      tracePieces(sc, alt.pieces)
      // A solid dark band under the whole line.
      sc.globalAlpha = CANDIDATE.casingAlpha
      sc.strokeStyle = colors.bg
      sc.lineWidth = width + CANDIDATE.casing - CANDIDATE.width
      sc.stroke()
      sc.globalAlpha = 1
      sc.lineWidth = width
      // The dashes on the band, measured on the ground.
      groundDashes(sc, alt.pieces, alt.along)
      sc.lineCap = 'butt'
      sc.strokeStyle = alt.color
      sc.stroke()
      context.save()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.globalAlpha = alt.focus ? 1 : CANDIDATE.alpha
      context.drawImage(scratch, 0, 0)
      context.restore()
    }
  }

  // Start and target are deploy-v1's A and B pins: 24 px squares, surface
  // fill, accent border for A and ok border for B. Waypoints are smaller
  // squares with their number.
  const drawVertex = (v: PlanVertex & Projected, index: number) => {
    const s = v.screen
    if (!s) return
    const active = index === dragging
    const pin = v.kind !== 'waypoint'
    const size = pin ? 24 : 18
    const half = size / 2
    context.fillStyle = active ? colors.text : colors.surface
    context.fillRect(s.x - half, s.y - half, size, size)
    context.lineWidth = 2
    context.strokeStyle = v.kind === 'start' ? colors.accent : v.kind === 'target' ? colors.ok : colors.text
    context.strokeRect(s.x - half + 1, s.y - half + 1, size - 2, size - 2)
    context.font = pin ? '700 12px Inter, system-ui, sans-serif' : LABEL_FONT
    context.textBaseline = 'middle'
    context.textAlign = 'center'
    context.fillStyle = active ? colors.bg : colors.text
    context.fillText(v.label, s.x, s.y + 0.5)
  }

  const draw = () => {
    const width = scene.canvas.clientWidth
    const height = scene.canvas.clientHeight
    const scale = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
    }
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, width, height)
    occluder.cameraPosition = viewer.camera.positionWC
    clipper.frame()
    heightsNow ||= exaggeration !== scene.verticalExaggeration
    exaggeration = scene.verticalExaggeration
    const now = performance.now()
    heightsDirty = heightsNow || (heightsStale && now - lastHeights >= HEIGHTS_MS)
    if (heightsDirty) {
      lastHeights = now
      heightsNow = false
      heightsStale = false
    } else if (heightsStale) {
      later ??= setTimeout(() => {
        later = undefined
        scene.requestRender()
      }, HEIGHTS_MS)
    }
    context.lineJoin = 'round'
    context.lineCap = 'round'

    for (const v of vertices) place(v)
    drawAlternatives(scale)
    if (route.length > 1 && dragging === null) drawRoute()
    else drawLegs()
    vertices.forEach(drawVertex)
    heightsDirty = false
  }

  const removeRender = scene.postRender.addEventListener(draw)
  const redraw = () => {
    heightsNow = true
    scene.requestRender()
  }

  return {
    set(nextVertices: PlanVertex[], nextRoute: RoutePoint[] | null) {
      vertices = nextVertices.map(project)
      route = (nextRoute ?? []).map(project)
      redraw()
    },
    setAlternatives(next: Alternative[]) {
      alternatives = next.map((alt) => ({ ...alt, points: alt.points.map((point) => project({ point })), along: cumulative(alt.points), pieces: [] }))
      redraw()
    },
    // Id of the candidate line under a canvas position, if any.
    alternativeAt(position: Cartesian2) {
      let best: string | null = null
      let bestDistance = LINE_HIT
      for (const alt of alternatives) {
        for (const p of alt.pieces) {
          const dx = p.bx - p.ax
          const dy = p.by - p.ay
          const t = Math.max(0, Math.min(1, ((position.x - p.ax) * dx + (position.y - p.ay) * dy) / (dx * dx + dy * dy || 1)))
          const d = Math.hypot(position.x - (p.ax + t * dx), position.y - (p.ay + t * dy))
          if (d < bestDistance) {
            bestDistance = d
            best = alt.id
          }
        }
      }
      return best
    },
    // Index of the handle under a canvas position, if any.
    handleAt(position: Cartesian2) {
      let best: number | null = null
      let bestDistance = HIT_RADIUS
      vertices.forEach((v, i) => {
        if (!v.screen) return
        const d = Math.hypot(v.screen.x - position.x, v.screen.y - position.y)
        if (d <= bestDistance) {
          best = i
          bestDistance = d
        }
      })
      return best
    },
    // Moves a handle while it is dragged. Pass null to end the drag.
    drag(index: number | null, point?: LatLon) {
      dragging = index
      if (index !== null && point && vertices[index]) vertices[index] = project({ ...vertices[index], point })
      redraw()
    },
    destroy() {
      clearTimeout(later)
      removeProgress()
      removeRender()
      canvas.remove()
    },
  }
}

export type PlanOverlay = ReturnType<typeof addPlanOverlay>
