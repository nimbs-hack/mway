import { Cartesian2, Cartesian3, Cartographic, EllipsoidalOccluder } from 'cesium'
import type { Viewer } from 'cesium'
import { DATUM_OFFSET } from '../data/terrain.js'

// A terrain height is a ray cast against the tile mesh, about a quarter of a
// millisecond. Thousands in one frame freeze the page, and tiles arrive many
// times a second while the map loads. So heights are refreshed a few
// milliseconds at a time, only for points in view, at most one pass a second.
const HEIGHT_BUDGET_MS = 6
const PASS_GAP_MS = 1000
const PASS_FRAME_MS = 50
// From this far up the relief along a route is less than a pixel.
const FLAT_ABOVE_M = 400_000

// GroundPolylineGeometry uses Earth's approximate terrain heights. Project
// the Mars routes over the rendered map instead, without a depth test.
export function addRouteOverlay(viewer: Viewer, paths: number[][][], color: string, outline: string) {
  const { scene } = viewer
  const canvas = document.createElement('canvas')
  canvas.className = 'route-overlay'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')
  if (!context) return () => {}
  viewer.container.appendChild(canvas)

  // Coordinates are planetocentric, east longitude [-180, 180], heights in
  // meters in Trek's shifted reference, matching scene.globe.getHeight().
  // Every point starts on the datum, so the route draws before any terrain.
  const routes = paths.map((path) => path.map(([lat, lon]) => {
    const location = Cartographic.fromDegrees(lon, lat, DATUM_OFFSET)
    return { location, position: scene.ellipsoid.cartographicToCartesian(location, new Cartesian3()) }
  }))
  const points = routes.flat()
  const occluder = new EllipsoidalOccluder(scene.ellipsoid, viewer.camera.positionWC)
  const screen = new Cartesian2()
  // `stale`: terrain or the view changed since the last pass began.
  // `next`: where the running pass is. points.length means no pass is running.
  let stale = true
  let next = points.length
  let lastPass = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  let exaggeration = scene.verticalExaggeration
  const markStale = () => { stale = true }
  const removeProgress = scene.globe.tileLoadProgressEvent.addEventListener(markStale)
  // Points that scroll into view need their height too, even with no new tiles.
  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
    stale = true
    scene.requestRender()
  })
  const later = (delay: number) => {
    timer ??= setTimeout(() => {
      timer = undefined
      scene.requestRender()
    }, delay)
  }

  const refreshHeights = (width: number, height: number) => {
    const now = performance.now()
    if (exaggeration !== scene.verticalExaggeration) {
      // The whole route moves at once, so this pass may not wait.
      exaggeration = scene.verticalExaggeration
      stale = true
      lastPass = -Infinity
    }
    if (next >= points.length && stale && now - lastPass >= PASS_GAP_MS) {
      stale = false
      lastPass = now
      next = viewer.camera.positionCartographic.height > FLAT_ABOVE_M ? points.length : 0
    }
    const deadline = now + HEIGHT_BUDGET_MS
    while (next < points.length) {
      const point = points[next++]
      const at = occluder.isPointVisible(point.position) && scene.cartesianToCanvasCoordinates(point.position, screen)
      if (at && at.x >= 0 && at.y >= 0 && at.x <= width && at.y <= height) {
        // getHeight already includes the scene's elevation exaggeration.
        point.location.height = scene.globe.getHeight(point.location) ?? DATUM_OFFSET
        scene.ellipsoid.cartographicToCartesian(point.location, point.position)
        if (performance.now() > deadline) break
      }
    }
    if (next < points.length) later(PASS_FRAME_MS)
    else if (stale) later(PASS_GAP_MS)
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
    refreshHeights(width, height)
    context.beginPath()
    for (const route of routes) {
      let connected = false
      for (const point of route) {
        if (!occluder.isPointVisible(point.position) ||
          !scene.cartesianToCanvasCoordinates(point.position, screen)) {
          connected = false
          continue
        }
        if (connected) context.lineTo(screen.x, screen.y)
        else context.moveTo(screen.x, screen.y)
        connected = true
      }
    }
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.strokeStyle = outline
    context.lineWidth = 4
    context.stroke()
    context.strokeStyle = color
    context.lineWidth = 2
    context.stroke()
  }

  const removeRender = scene.postRender.addEventListener(draw)
  scene.requestRender()
  return () => {
    clearTimeout(timer)
    removeProgress()
    removeMoveEnd()
    removeRender()
    canvas.remove()
  }
}
