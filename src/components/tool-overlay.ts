import { Cartesian3, Cartographic, EllipsoidalOccluder } from 'cesium'
import type { Viewer } from 'cesium'
import { DATUM_OFFSET } from '../data/terrain.js'
import type { LatLon } from '../data/geo'
import { segmentClipper, tracePieces } from './overlay-clip'
import type { End } from './overlay-clip'

// What a map tool draws. Lines can be dashed. Dots carry an optional label.
export type ToolLine = { points: LatLon[], color: string, dash?: number[], width?: number }
// `bare` draws the label alone. `maxHeight` hides the dot when the camera is
// higher than that many meters, so context labels don't litter a globe view.
export type ToolDot = { point: LatLon, color: string, label?: string, hollow?: boolean, bare?: boolean, maxHeight?: number }
export type ToolShapes = { lines: ToolLine[], dots: ToolDot[] }

type Projected = End & { location: Cartographic }

const LABEL_FONT = '600 12px Inter, system-ui, sans-serif'
// Tile changes refresh heights at most this often, as in plan-overlay.ts.
const HEIGHTS_MS = 400

/**
 * Canvas layer for the ruler, range rings and line of sight, drawn over the
 * plan the same way plan-overlay.ts draws it: points are placed on the
 * rendered terrain and hidden behind the planet's limb.
 */
export function addToolOverlay(viewer: Viewer, background: string) {
  const { scene } = viewer
  const canvas = document.createElement('canvas')
  canvas.className = 'route-overlay'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')!
  viewer.container.appendChild(canvas)

  const occluder = new EllipsoidalOccluder(scene.ellipsoid, viewer.camera.positionWC)
  const clipper = segmentClipper(scene, occluder)
  let lines: (ToolLine & { projected: Projected[] })[] = []
  let dots: (ToolDot & Projected)[] = []
  // `heightsNow`: place every point this frame. `heightsStale`: tiles have
  // changed since the last pass. `heightsDirty` is set for one draw.
  let heightsDirty = false
  let heightsNow = true
  let heightsStale = false
  let lastHeights = 0
  let later: ReturnType<typeof setTimeout> | undefined
  let exaggeration = scene.verticalExaggeration
  const removeProgress = scene.globe.tileLoadProgressEvent.addEventListener(() => { heightsStale = true })

  const project = ([lat, lon]: LatLon): Projected => ({
    location: Cartographic.fromDegrees(lon, lat, DATUM_OFFSET),
    position: new Cartesian3(),
    screen: null,
    depth: 0,
    hidden: false,
  })

  const place = (p: Projected) => {
    if (heightsDirty) {
      p.location.height = scene.globe.getHeight(p.location) ?? DATUM_OFFSET
      scene.ellipsoid.cartographicToCartesian(p.location, p.position)
    }
    return clipper.place(p)
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

    for (const line of lines) {
      for (const p of line.projected) place(p)
      tracePieces(context, clipper.pieces(line.projected))
      const w = line.width ?? 2
      context.setLineDash(line.dash ?? [])
      context.strokeStyle = background
      context.lineWidth = w + 3
      context.stroke()
      context.strokeStyle = line.color
      context.lineWidth = w
      context.stroke()
      context.setLineDash([])
    }

    context.font = LABEL_FONT
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    const cameraHeight = viewer.camera.positionCartographic.height
    for (const dot of dots) {
      if (dot.maxHeight !== undefined && cameraHeight > dot.maxHeight) continue
      const s = place(dot)
      if (!s) continue
      if (!dot.bare) {
        context.beginPath()
        context.arc(s.x, s.y, 5, 0, Math.PI * 2)
        context.fillStyle = dot.hollow ? background : dot.color
        context.fill()
        context.lineWidth = 2
        context.strokeStyle = dot.color
        context.stroke()
      }
      if (!dot.label) continue
      const w = context.measureText(dot.label).width + 10
      const x = dot.bare ? s.x + 4 : s.x + 9
      const y = dot.bare ? s.y + 13 : s.y
      context.fillStyle = background
      context.fillRect(x, y - 9, w, 18)
      context.fillStyle = dot.color
      context.fillText(dot.label, x + 5, y + 0.5)
    }
    heightsDirty = false
  }

  const removeRender = scene.postRender.addEventListener(draw)
  return {
    set(shapes: ToolShapes) {
      lines = shapes.lines.map((line) => ({ ...line, projected: line.points.map(project) }))
      dots = shapes.dots.map((dot) => ({ ...dot, ...project(dot.point) }))
      heightsNow = true
      scene.requestRender()
    },
    destroy() {
      clearTimeout(later)
      removeProgress()
      removeRender()
      canvas.remove()
    },
  }
}

export type ToolOverlay = ReturnType<typeof addToolOverlay>
