import { expect, test } from 'bun:test'
import { Cartesian3, Cartographic, Ellipsoid, Event } from 'cesium'
import { createStreetCamera, EYE_HEIGHT, groundHeight, RUN_SPEED, WALK_SPEED, walkDestination } from './street-view-camera'

const mars = new Ellipsoid(3396190, 3396190, 3396190)

test('WASD follows heading, normalizes diagonals, and caps delayed frames', () => {
  const origin = Cartographic.fromDegrees(137.4, -4.6, 1500)
  const step = (heading, forward, right, seconds = 0.1) => walkDestination(mars, origin, heading, forward, right, seconds)
  expect(step(0, 1, 0).latitude).toBeGreaterThan(origin.latitude)
  expect(step(0, -1, 0).latitude).toBeLessThan(origin.latitude)
  expect(step(0, 0, 1).longitude).toBeGreaterThan(origin.longitude)
  expect(step(0, 0, -1).longitude).toBeLessThan(origin.longitude)
  expect(step(Math.PI / 2, 1, 0).longitude).toBeGreaterThan(origin.longitude)
  expect(step(Math.PI / 2, 0, 1).latitude).toBeLessThan(origin.latitude)
  const distance = (point) => Cartesian3.distance(mars.cartographicToCartesian(origin), mars.cartographicToCartesian(point))
  expect(distance(step(0, 1, 1))).toBeCloseTo(WALK_SPEED * 0.1, 5)
  expect(distance(step(0, 1, 0, 10))).toBeCloseTo(WALK_SPEED * 0.1, 5)
  expect(step(0, 0, 0)).toEqual(origin)
  const run = walkDestination(mars, origin, 0, 1, 0, 0.1, RUN_SPEED)
  expect(distance(run)).toBeCloseTo(RUN_SPEED * 0.1, 5)
})

function sceneFixture() {
  let height = 1500
  const camera = {
    positionWC: Cartesian3.fromDegrees(137.4, -4.6, 5000, mars),
    directionWC: new Cartesian3(0, 0, -1), upWC: new Cartesian3(0, 1, 0),
    heading: 0, frustum: { near: 1 },
    cancelFlight() {},
    setView({ destination, orientation }) {
      if (destination) this.positionWC = Cartesian3.clone(destination)
      if (orientation.direction) this.directionWC = Cartesian3.clone(orientation.direction)
      if (orientation.up) this.upWC = Cartesian3.clone(orientation.up)
      this.orientation = orientation
    },
  }
  const controls = { enableInputs: true, enableCollisionDetection: true }
  const viewer = {
    camera, isDestroyed: () => false,
    scene: {
      verticalExaggeration: 1, verticalExaggerationRelativeHeight: 8201,
      postRender: new Event(),
      ellipsoid: mars, screenSpaceCameraController: controls,
      globe: { getHeight: () => height, maximumScreenSpaceError: 2 }, requestRender() {},
    },
  }
  return { viewer, camera, controls, height: (value) => { height = value } }
}

test('walking tracks terrain refinement and holds position at missing terrain', () => {
  const fixture = sceneFixture()
  const controller = createStreetCamera(fixture.viewer, Cartesian3.fromDegrees(137.4, -4.6, 1500, mars))
  expect(controller).not.toBeNull()
  expect(mars.cartesianToCartographic(fixture.camera.positionWC).height).toBeCloseTo(1500 + EYE_HEIGHT)
  fixture.height(1550)
  controller.step(0.016, 0, 0)
  expect(mars.cartesianToCartographic(fixture.camera.positionWC).height).toBeCloseTo(1550 + EYE_HEIGHT)
  const held = Cartesian3.clone(fixture.camera.positionWC)
  fixture.height(undefined)
  expect(controller.step(0.1, 1, 0)).toBe(false)
  expect(fixture.camera.positionWC).toEqual(held)
  fixture.height(1560)
  expect(controller.step(0.1, 1, 0)).toBe(true)
  expect(mars.cartesianToCartographic(fixture.camera.positionWC).height).toBeCloseTo(1560 + EYE_HEIGHT)
  controller.dispose()
})

test('exit restores camera, clipping and controls after looking and moving', () => {
  const { viewer, camera, controls } = sceneFixture()
  viewer.scene.verticalExaggeration = 3
  const original = Cartesian3.clone(camera.positionWC)
  const controller = createStreetCamera(viewer, Cartesian3.fromDegrees(137.4, -4.6, 1500, mars))
  // The map stays overhead until the first true-scale mesh has rendered.
  expect(camera.positionWC).toEqual(original)
  expect(controller.step(0.016, 1, 0)).toBe(false)
  viewer.scene.postRender.raiseEvent()
  expect(controls.enableInputs).toBe(false)
  expect(controls.enableCollisionDetection).toBe(false)
  expect(camera.frustum.near).toBe(0.1)
  expect(viewer.scene.globe.maximumScreenSpaceError).toBe(1)
  expect(viewer.scene.verticalExaggeration).toBe(1)
  viewer.scene.globe.maximumScreenSpaceError = 6
  controller.step(0.016, 0, 0)
  expect(viewer.scene.globe.maximumScreenSpaceError).toBe(1)
  controller.look(800, -1e6)
  expect(camera.orientation.pitch).toBeLessThan(Math.PI / 2)
  controller.step(0.1, 1, 1)
  controller.dispose()
  controller.dispose()
  expect(camera.positionWC).toEqual(original)
  expect(camera.orientation.direction).toEqual(new Cartesian3(0, 0, -1))
  expect(camera.orientation.up).toEqual(new Cartesian3(0, 1, 0))
  expect(controls.enableInputs).toBe(true)
  expect(controls.enableCollisionDetection).toBe(true)
  expect(camera.frustum.near).toBe(1)
  expect(viewer.scene.globe.maximumScreenSpaceError).toBe(2)
  expect(viewer.scene.verticalExaggeration).toBe(3)
})

test('missing terrain cannot enter walking or take ownership of map controls', () => {
  const fixture = sceneFixture()
  fixture.height(undefined)
  expect(createStreetCamera(fixture.viewer, Cartesian3.fromDegrees(0, 0, 0, mars))).toBeNull()
  expect(fixture.controls.enableInputs).toBe(true)
})

test('the eye stays above a drawn tile that sits higher than the loaded one', () => {
  const at = Cartographic.fromDegrees(-33.2, 19.1, 0)
  const drawnAt = (height) => ({
    ellipsoid: mars,
    globe: {
      getHeight: () => 1500,
      pick: (ray) => height === null ? undefined : mars.cartographicToCartesian(
        new Cartographic(mars.cartesianToCartographic(ray.origin).longitude, mars.cartesianToCartographic(ray.origin).latitude, height)),
    },
  })
  expect(groundHeight(drawnAt(1540), at, 1500)).toBeCloseTo(1540, 3)
  expect(groundHeight(drawnAt(1490), at, 1500)).toBe(1500)
  expect(groundHeight(drawnAt(null), at, 1500)).toBe(1500)
})
