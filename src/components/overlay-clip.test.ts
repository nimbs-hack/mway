import { expect, test } from 'bun:test'
import { Cartesian2, Cartesian3 } from 'cesium'
import type { EllipsoidalOccluder, Scene } from 'cesium'
import { clipToBox, groundFraction, screenFraction, segmentClipper, type End } from './overlay-clip'

const WIDTH = 1000
const HEIGHT = 800
const FOCAL = 500

// A pinhole camera at the origin looking down -z, with y up. Like Cesium,
// it projects nothing behind the near plane.
function pinhole(limbZ = -Infinity) {
  const scene = {
    camera: { positionWC: Cartesian3.ZERO, directionWC: new Cartesian3(0, 0, -1), frustum: { near: 0.1 } },
    canvas: { clientWidth: WIDTH, clientHeight: HEIGHT },
    cartesianToCanvasCoordinates(p: Cartesian3, result: Cartesian2) {
      if (-p.z < 0.2) return undefined
      result.x = WIDTH / 2 + (FOCAL * p.x) / -p.z
      result.y = HEIGHT / 2 - (FOCAL * p.y) / -p.z
      return result
    },
  } as unknown as Scene
  // Everything farther than limbZ is over the limb.
  const occluder = { isPointVisible: (p: Cartesian3) => p.z > limbZ } as unknown as EllipsoidalOccluder
  const clipper = segmentClipper(scene, occluder)
  clipper.frame()
  const end = (x: number, y: number, z: number): End => {
    const placed: End = { position: new Cartesian3(x, y, z), screen: null, depth: 0, hidden: false }
    clipper.place(placed)
    return placed
  }
  return { clipper, end }
}

test('a segment across the box is cut to it', () => {
  expect(clipToBox(-100, 50, 300, 50, 0, 0, 100, 100)).toEqual([0.25, 0.5])
  expect(clipToBox(10, 10, 90, 90, 0, 0, 100, 100)).toEqual([0, 1])
})

test('a segment that misses the box is dropped', () => {
  expect(clipToBox(-100, -50, 300, -50, 0, 0, 100, 100)).toBeNull()
  expect(clipToBox(150, 0, 150, 100, 0, 0, 100, 100)).toBeNull()
})

test('the near half of a receding segment takes most of its length on screen', () => {
  expect(screenFraction(0.5, 1, 3)).toBeCloseTo(0.75)
  expect(groundFraction(0.75, 1, 3)).toBeCloseTo(0.5)
  expect(screenFraction(0.5, 2, 2)).toBeCloseTo(0.5)
})

test('a segment in view is drawn whole', () => {
  const { clipper, end } = pinhole()
  const [piece] = clipper.pieces([end(-10, 0, -100), end(10, 0, -100)])
  expect(piece).toMatchObject({ index: 1, ax: 450, ay: 400, bx: 550, by: 400, ta: 0, tb: 1 })
})

// The bug: zoomed in on a waypoint, the previous route point is behind the
// camera, and the whole leg into the waypoint vanished.
test('a leg whose far end is behind the camera is still drawn', () => {
  const { clipper, end } = pinhole()
  const behind = end(0, -70, 500)
  const waypoint = end(0, -70, -70)
  expect(behind.screen).toBeNull()
  const [piece] = clipper.pieces([behind, waypoint])
  expect(piece.bx).toBeCloseTo(500)
  expect(piece.by).toBeCloseTo(900)
  expect(piece.tb).toBe(1)
  // It runs straight down from the waypoint and off the canvas.
  expect(piece.ax).toBeCloseTo(500)
  expect(piece.ay).toBeGreaterThan(HEIGHT)
  expect(piece.ta).toBeGreaterThan(0.8)
  expect(piece.wa).toBeGreaterThan(0)
})

test('a leg with both ends behind the camera is dropped', () => {
  const { clipper, end } = pinhole()
  expect(clipper.pieces([end(0, -70, 500), end(50, -70, 20)])).toEqual([])
})

test('a leg over the limb stops at the limb', () => {
  const { clipper, end } = pinhole(-1000)
  const [piece] = clipper.pieces([end(0, -100, -500), end(0, -100, -1500)])
  expect(piece.ta).toBe(0)
  expect(piece.tb).toBeCloseTo(0.5, 2)
  expect(clipper.pieces([end(0, -100, -1200), end(0, -100, -1500)])).toEqual([])
})

test('a leg that passes the view on both sides keeps only the part in view', () => {
  const { clipper, end } = pinhole()
  const [piece] = clipper.pieces([end(-1000, 0, -100), end(1000, 0, -100)], 0)
  expect(piece.ax).toBeCloseTo(0)
  expect(piece.bx).toBeCloseTo(WIDTH)
  expect(piece.ta).toBeCloseTo(0.45)
  expect(piece.tb).toBeCloseTo(0.55)
})
