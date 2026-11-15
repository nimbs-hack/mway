import { deferTerrainShaders } from './terrain-shaders'

// What makes the globe cheap to draw. Both viewers use it: the Sites map and
// the Review globe. The target is integrated graphics, where the cost is
// filling pixels and uploading tiles, not triangle count.

// A flight or a long scroll passes through many zoom levels. Loading full
// detail for each would hold up the detail for where it ends, so once one
// movement has changed the camera height by ZOOM_JUMP, tiles are coarser
// until the camera has been still for REST_MS. A pan, or a zoom smaller than
// that, keeps full detail and loads it as it goes. Lowering the drawing
// resolution during motion was tried and dropped: the resize changes the
// camera's aspect ratio by a rounding error, Cesium reads that as movement,
// and the two chase each other.
const ZOOM_JUMP = 2.5
const MOTION_SCREEN_SPACE_ERROR = 6
const REST_SCREEN_SPACE_ERROR = 2
const REST_MS = 120
// Decoded tiles kept in memory, so going back over ground already seen, or
// zooming out and in again, draws at once.
const TILE_CACHE = 1024

/**
 * Options for `new Viewer()`.
 * @type {import('cesium').Viewer.ConstructorOptions}
 */
export const FAST_VIEWER_OPTIONS = {
  // Four samples a pixel quadruples the fill work to smooth the limb.
  msaaSamples: 1,
  // No buffers or shaders for the 2D and Columbus views.
  scene3DOnly: true,
  // Nothing translucent is drawn as geometry, so skip those framebuffers.
  orderIndependentTranslucency: false,
  shadows: false,
  // Draw only when something changed.
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
  contextOptions: { webgl: { powerPreference: 'high-performance', antialias: false } },
}

// Settings that need the scene. Returns a function that undoes the listeners.
export function tuneViewer(viewer) {
  const { scene } = viewer
  const stopShaders = deferTerrainShaders(scene)
  // Created by default and drawn every frame, though no sky is shown.
  if (scene.sun) scene.sun.show = false
  if (scene.moon) scene.moon.show = false
  scene.highDynamicRange = false
  scene.postProcessStages.fxaa.enabled = false
  // Fog lets Cesium load coarser tiles toward the horizon. Keep that part
  // and skip drawing the fog itself.
  scene.fog.enabled = true
  scene.fog.renderable = false
  scene.globe.tileCacheSize = TILE_CACHE
  // Don't load the tiles next to the ones on screen. The browser has six
  // connections to our server, and those extra tiles queued ahead of the
  // ones in view: in a benchmark at Jezero, pans settled in 964 ms with this
  // on and 512 ms with it off, and flights got faster too. The Go server
  // already fetches each tile's neighbours ahead (tiles/readahead.go), so a
  // pan still lands on tiles that come straight from its cache.
  scene.globe.preloadSiblings = false
  // Coarser parents first, so a zoom shows something at once and sharpens.
  scene.globe.preloadAncestors = true

  const { camera } = viewer
  let rest
  let startHeight = camera.positionCartographic.height
  let coarse = false
  const removeStart = camera.moveStart.addEventListener(() => {
    clearTimeout(rest)
    if (!coarse) startHeight = camera.positionCartographic.height
  })
  const removeChanged = camera.changed.addEventListener(() => {
    if (coarse) return
    const ratio = camera.positionCartographic.height / startHeight
    if (ratio < ZOOM_JUMP && ratio > 1 / ZOOM_JUMP) return
    coarse = true
    scene.globe.maximumScreenSpaceError = MOTION_SCREEN_SPACE_ERROR
  })
  const removeEnd = camera.moveEnd.addEventListener(() => {
    rest = setTimeout(() => {
      if (viewer.isDestroyed()) return
      coarse = false
      scene.globe.maximumScreenSpaceError = REST_SCREEN_SPACE_ERROR
      scene.requestRender()
    }, REST_MS)
  })
  return () => {
    stopShaders()
    clearTimeout(rest)
    removeStart()
    removeChanged()
    removeEnd()
  }
}

// Runs at most `max` of the given jobs at once and queues the rest.
export function limiter(max) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= max || queue.length === 0) return
    active++
    const { run, resolve, reject } = queue.shift()
    run().then(resolve, reject).finally(() => {
      active--
      next()
    })
  }
  return (run) => new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject })
    next()
  })
}
