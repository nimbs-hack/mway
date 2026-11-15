import { Cartesian3, Cartographic, Math as CesiumMath, Matrix4, Ray, Transforms, type Viewer } from 'cesium'

export const EYE_HEIGHT = 1.7
// Navigation speeds for the preview, not an EVA resource calculation.
export const WALK_SPEED = 12
export const RUN_SPEED = 60
// Finer than the map's resting 2 px, so the ground under the camera loads
// the deepest terrain and imagery tiles. Restored on exit.
const STREET_SCREEN_SPACE_ERROR = 1
const LOOK_SPEED = 0.002
const MAX_PITCH = CesiumMath.toRadians(85)

/** A tangent step on the viewer's Mars ellipsoid. Coordinates stay in radians. */
export function walkDestination(
  ellipsoid: Viewer['scene']['ellipsoid'], position: Cartographic,
  heading: number, forward: number, right: number, seconds: number, speed = WALK_SPEED,
): Cartographic {
  const length = Math.hypot(forward, right)
  if (!length) return Cartographic.clone(position)
  const distance = speed * Math.min(Math.max(seconds, 0), 0.1) / length
  const east = (Math.sin(heading) * forward + Math.cos(heading) * right) * distance
  const north = (Math.cos(heading) * forward - Math.sin(heading) * right) * distance
  const origin = ellipsoid.cartographicToCartesian(position)
  const frame = Transforms.eastNorthUpToFixedFrame(origin, ellipsoid)
  const next = Matrix4.multiplyByPoint(frame, new Cartesian3(east, north, 0), new Cartesian3())
  return ellipsoid.cartesianToCartographic(next)
}

// Start of the downward ray that finds the drawn surface. No step climbs this far.
const PICK_ABOVE = 2000

/**
 * Ground height under a point. getHeight reads the deepest loaded tile, but
 * the tile on screen can be coarser and meters higher, which put the eye
 * under the drawn surface and showed tile skirts as walls. A downward pick
 * hits only drawn tiles, so the eye takes the higher of the two.
 */
export function groundHeight(scene: Viewer['scene'], at: Cartographic, near: number): number | undefined {
  const loaded = scene.globe.getHeight(at)
  const fallback = loaded !== undefined && Number.isFinite(loaded) ? loaded : undefined
  if (typeof scene.globe.pick !== 'function') return fallback
  const top = scene.ellipsoid.cartographicToCartesian(new Cartographic(at.longitude, at.latitude, near + PICK_ABOVE))
  const down = Cartesian3.negate(scene.ellipsoid.geodeticSurfaceNormal(top, new Cartesian3()), new Cartesian3())
  const hit = scene.globe.pick(new Ray(top, down), scene)
  const drawn = hit ? scene.ellipsoid.cartesianToCartographic(hit).height : undefined
  if (drawn === undefined || !Number.isFinite(drawn)) return fallback
  return fallback === undefined ? drawn : Math.max(drawn, fallback)
}

/** Owns the camera until dispose restores the exact map view and input settings. */
export function createStreetCamera(viewer: Viewer, ground: Cartesian3) {
  const { scene, camera } = viewer
  const controls = scene.screenSpaceCameraController
  let position = scene.ellipsoid.cartesianToCartographic(ground)
  const height = groundHeight(scene, position, position.height)
  if (height === undefined) return null
  const saved = {
    destination: Cartesian3.clone(camera.positionWC),
    direction: Cartesian3.clone(camera.directionWC), up: Cartesian3.clone(camera.upWC),
    inputs: controls.enableInputs, collision: controls.enableCollisionDetection,
    near: camera.frustum.near,
    error: scene.globe.maximumScreenSpaceError,
    relief: scene.verticalExaggeration,
  }
  let heading = camera.heading
  let pitch = 0
  let disposed = false
  let ready = saved.relief === 1
  let stopTransition: (() => void) | undefined
  camera.cancelFlight()
  controls.enableInputs = false
  controls.enableCollisionDetection = false
  camera.frustum.near = 0.1
  scene.globe.maximumScreenSpaceError = STREET_SCREEN_SPACE_ERROR
  // Map exaggeration turns low ridges into cliffs at eye level.
  scene.verticalExaggeration = 1

  const place = (height: number) => {
    position.height = height + EYE_HEIGHT
    camera.setView({
      destination: scene.ellipsoid.cartographicToCartesian(position),
      orientation: { heading, pitch, roll: 0 },
    })
    scene.requestRender()
  }
  if (ready) {
    place(height)
  } else {
    // Keep the overhead view until Cesium has rebuilt the exaggerated
    // meshes. Picking during that rebuild can put the eye below the ground.
    const reference = scene.verticalExaggerationRelativeHeight
    const unscaled = reference + (height - reference) / saved.relief
    stopTransition = scene.postRender.addEventListener(() => {
      if (disposed || ready) return
      const surface = groundHeight(scene, position, unscaled)
      if (surface === undefined) return
      ready = true
      stopTransition?.()
      place(surface)
    })
    scene.requestRender()
  }

  return {
    step(seconds: number, forward: number, right: number, run = false): boolean {
      if (disposed || viewer.isDestroyed() || !ready) return false
      // The map's motion tuning coarsens tiles after big height changes.
      // Street view keeps full detail.
      scene.globe.maximumScreenSpaceError = STREET_SCREEN_SPACE_ERROR
      const next = walkDestination(scene.ellipsoid, position, heading, forward, right, seconds, run ? RUN_SPEED : WALK_SPEED)
      const ground = groundHeight(scene, next, position.height)
      // Hold position at a terrain gap. Never substitute a flat, safe-looking floor.
      if (ground === undefined) return false
      const changed = forward !== 0 || right !== 0 || Math.abs(position.height - ground - EYE_HEIGHT) > 0.01
      position = next
      if (changed) place(ground)
      return true
    },
    look(dx: number, dy: number) {
      if (disposed || viewer.isDestroyed()) return
      heading = CesiumMath.zeroToTwoPi(heading + dx * LOOK_SPEED)
      pitch = CesiumMath.clamp(pitch - dy * LOOK_SPEED, -MAX_PITCH, MAX_PITCH)
      camera.setView({ orientation: { heading, pitch, roll: 0 } })
      scene.requestRender()
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopTransition?.()
      if (viewer.isDestroyed()) return
      camera.cancelFlight()
      controls.enableInputs = saved.inputs
      controls.enableCollisionDetection = saved.collision
      camera.frustum.near = saved.near
      scene.globe.maximumScreenSpaceError = saved.error
      scene.verticalExaggeration = saved.relief
      camera.setView({ destination: saved.destination, orientation: { direction: saved.direction, up: saved.up } })
      scene.requestRender()
    },
  }
}
