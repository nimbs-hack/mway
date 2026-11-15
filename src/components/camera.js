// Camera controls modeled on Google Earth:
//   drag                      pan
//   right drag, ctrl/shift drag, middle drag, two-finger drag   tilt and turn
//   scroll, pinch             zoom toward the cursor
//   double click              fly halfway to that spot
// plus helpers for the on-screen compass, tilt and zoom buttons.
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  CameraEventType,
  HeadingPitchRange,
  IntersectionTests,
  KeyboardEventModifier,
  Math as CesiumMath,
  Matrix4,
  Ray,
  ScreenSpaceEventType,
  Transforms,
} from 'cesium'

// Highest terrain in Trek's heights (Olympus Mons, about 29.4 km above the
// sphere), with headroom. Cesium only checks for terrain collisions below
// this height. Its default for a Mars-sized body is 8.5 km, which let the
// camera sink into anything taller.
const COLLISION_CEILING = 45_000
// Below this height Cesium pivots on the terrain instead of the bare sphere.
const TERRAIN_PICK_CEILING = 200_000
// Close inspection is useful for separating nearby plan points even when
// imagery is coarse. Zoom does not increase the source's 5 m resolution.
export const MIN_GROUND_CLEARANCE = 40
// Steepest tilt, measured from straight down. 90° would be the horizon.
const MAX_TILT = CesiumMath.toRadians(80)
// Like Google Earth, allowed tilt shrinks with altitude so Mars stays under
// the middle of the screen. Full tilt below FULL_TILT_HEIGHT, straight down
// only above NO_TILT_HEIGHT, log-scaled in between.
const FULL_TILT_HEIGHT = 30_000
const NO_TILT_HEIGHT = 2_000_000
const TILT_SLACK = 0.01

/** Steepest tilt from straight down allowed at a camera height in meters. */
export function tiltLimit(height) {
  if (height <= FULL_TILT_HEIGHT) return MAX_TILT
  if (height >= NO_TILT_HEIGHT) return 0
  const t = Math.log(height / FULL_TILT_HEIGHT) / Math.log(NO_TILT_HEIGHT / FULL_TILT_HEIGHT)
  return MAX_TILT * (1 - t)
}
const TOP_DOWN = CesiumMath.toRadians(-90)
const TILTED = CesiumMath.toRadians(-40)
const FLAT_ENOUGH = CesiumMath.toRadians(-80)

const MOVE_SECONDS = 0.5

export function setupControls(viewer) {
  const { scene } = viewer
  const controls = scene.screenSpaceCameraController
  controls.minimumCollisionTerrainHeight = COLLISION_CEILING
  controls.minimumPickingTerrainHeight = TERRAIN_PICK_CEILING
  controls.minimumZoomDistance = MIN_GROUND_CLEARANCE
  controls.maximumZoomDistance = scene.ellipsoid.maximumRadius * 4
  const removeTiltLimit = scene.preUpdate.addEventListener(() => limitTilt(scene))
  // Free look turns the camera in place and loses the ground. Google's
  // tools don't have it, and it's how people end up staring at the sky.
  controls.enableLook = false
  controls.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH]
  controls.tiltEventTypes = [
    CameraEventType.RIGHT_DRAG,
    CameraEventType.MIDDLE_DRAG,
    CameraEventType.PINCH,
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT },
  ]

  // Replace the viewer's double click (track an entity) with fly-in.
  const handler = viewer.screenSpaceEventHandler
  handler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  handler.setInputAction(({ position }) => {
    if (!controls.enableInputs) return
    const target = pickGround(viewer, position)
    if (target) moveToward(viewer, target, 0.5)
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  return () => {
    removeTiltLimit()
  }
}

const limitRay = new Ray()
const limitPivot = new Cartesian3()
const limitFrame = new Matrix4()
const limitDirection = new Cartesian3()

// Runs every frame, after input and flights have moved the camera. Sets the
// tilt cap for mouse input, then pulls the camera back to it if zooming out,
// a flight or Cesium's grazing-angle tilt above COLLISION_CEILING left it
// looking past the limb.
function limitTilt(scene) {
  const { camera, ellipsoid } = scene
  // Ground-level navigation owns the camera while map inputs are suspended.
  if (!scene.screenSpaceCameraController.enableInputs) return
  if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) return
  const limit = tiltLimit(camera.positionCartographic.height)
  scene.screenSpaceCameraController.maximumTiltAngle = limit

  Cartesian3.clone(camera.positionWC, limitRay.origin)
  Cartesian3.clone(camera.directionWC, limitRay.direction)
  const hit = IntersectionTests.rayEllipsoid(limitRay, ellipsoid)
  // Exaggerated crater floors can sit below the reference sphere. From
  // inside it, the ray starts at the camera, so orbiting that hit would
  // normalize a zero-length direction and stop Cesium's render loop.
  // Limit the angle in place until the camera is above the sphere again.
  if (hit && hit.start <= CesiumMath.EPSILON6) {
    const pitch = limit - Math.PI / 2
    if (camera.pitch > pitch + TILT_SLACK) {
      camera.setView({ orientation: { heading: camera.heading, pitch, roll: 0 } })
    }
    return
  }
  let pivot
  if (hit) {
    pivot = Ray.getPoint(limitRay, hit.start, limitPivot)
  } else {
    const grazing = IntersectionTests.grazingAltitudeLocation(limitRay, ellipsoid)
    pivot = grazing && ellipsoid.scaleToGeodeticSurface(grazing, limitPivot)
    if (!pivot) return
  }

  // View direction in east-north-up axes at the pivot.
  Transforms.eastNorthUpToFixedFrame(pivot, ellipsoid, limitFrame)
  Matrix4.inverseTransformation(limitFrame, limitFrame)
  const local = Matrix4.multiplyByPointAsVector(limitFrame, camera.directionWC, limitDirection)
  const tilt = Math.acos(CesiumMath.clamp(-local.z, -1, 1))
  if (hit && tilt <= limit + TILT_SLACK) return

  const range = Cartesian3.distance(camera.positionWC, pivot)
  camera.lookAt(pivot, new HeadingPitchRange(Math.atan2(local.x, local.y), limit - Math.PI / 2, range))
  camera.lookAtTransform(Matrix4.IDENTITY)
}

// A picked point some GPUs fill with NaN, from a depth buffer they read
// back wrong. Anything that converts it to degrees then throws.
const usable = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)

/** The ground under a screen position, or undefined over empty space. */
export function pickGround(viewer, position) {
  const { scene, camera } = viewer
  const ray = camera.getPickRay(position)
  const hit = ray && scene.globe.pick(ray, scene)
  if (usable(hit)) return hit
  if (scene.pickPositionSupported) {
    const depth = scene.pickPosition(position)
    if (usable(depth)) return depth
  }
  const sphere = camera.pickEllipsoid(position, scene.ellipsoid)
  return usable(sphere) ? sphere : undefined
}

function screenCenter(viewer) {
  const canvas = viewer.scene.canvas
  return new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
}

/** Moves the camera `share` of the way to a point, keeping its heading and tilt. */
function moveToward(viewer, target, share) {
  const { camera, scene } = viewer
  const destination = Cartesian3.lerp(camera.positionWC, target, share, new Cartesian3())
  const point = scene.ellipsoid.cartesianToCartographic(destination)
  const ground = scene.globe.getHeight(point) ?? scene.ellipsoid.cartesianToCartographic(target).height
  point.height = Math.max(point.height, ground + scene.screenSpaceCameraController.minimumZoomDistance)
  scene.ellipsoid.cartographicToCartesian(point, destination)
  camera.flyTo({
    destination,
    orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
    duration: MOVE_SECONDS,
  })
}

/** Zoom buttons: factor below 1 moves in, above 1 moves out. */
export function zoomBy(viewer, factor) {
  const { camera, scene } = viewer
  const target = pickGround(viewer, screenCenter(viewer))
  if (!target) {
    const height = camera.positionCartographic.height
    if (factor < 1) camera.zoomIn(height * (1 - factor))
    else camera.zoomOut(height * (factor - 1))
    scene.requestRender()
    return
  }
  const max = scene.screenSpaceCameraController.maximumZoomDistance
  const distance = Cartesian3.distance(camera.positionWC, target)
  const share = 1 - Math.min(factor, max / distance)
  moveToward(viewer, target, share)
}

export function isTilted(viewer) {
  return viewer.camera.pitch > FLAT_ENOUGH
}

/**
 * Turns and tilts around the spot in the middle of the screen, the way
 * Google's compass and 2D/3D buttons do. Undefined keeps the current value.
 */
export function orbitCenter(viewer, { heading, pitch }) {
  const { camera } = viewer
  heading ??= camera.heading
  pitch ??= camera.pitch
  pitch = Math.min(pitch, tiltLimit(camera.positionCartographic.height) - Math.PI / 2)
  const target = pickGround(viewer, screenCenter(viewer))
  if (!target) {
    camera.flyTo({ destination: camera.positionWC, orientation: { heading, pitch, roll: 0 }, duration: MOVE_SECONDS })
    return
  }
  const clearance = viewer.scene.screenSpaceCameraController.minimumZoomDistance
  const range = Math.max(Cartesian3.distance(camera.positionWC, target), clearance / Math.max(0.1, -Math.sin(pitch)))
  camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(heading, pitch, range),
    duration: MOVE_SECONDS,
  })
}

export const resetNorth = (viewer) => orbitCenter(viewer, { heading: 0 })

export const toggleTilt = (viewer) => orbitCenter(viewer, { pitch: isTilted(viewer) ? TOP_DOWN : TILTED })
