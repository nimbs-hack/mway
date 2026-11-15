import { expect, test } from 'bun:test'
import { type Vec3, type View, basis, ground, matrix, pixelsPerMeter, project } from './view'

const view: View = { heading: 0.7, pitch: 0.9, dist: 5000, width: 1200, height: 800 }

test('the WebGL matrix and the overlay projection agree', () => {
  const b = basis(view)
  const m = matrix(b, view, 100, 100000)
  for (const point of [[0, 0, 0], [1200, -800, 150], [-3000, 2500, -40]] as Vec3[]) {
    const clip = [0, 1, 3].map((row) => m[row]! * point[0] + m[4 + row]! * point[1] + m[8 + row]! * point[2] + m[12 + row]!)
    const [x, y] = project(b, view, point)!
    expect(view.width / 2 + (clip[0]! / clip[2]!) * (view.width / 2)).toBeCloseTo(x, 3)
    expect(view.height / 2 - (clip[1]! / clip[2]!) * (view.height / 2)).toBeCloseTo(y, 3)
  }
})

test('a pixel leads back to the ground point drawn there', () => {
  const b = basis(view)
  const [x, y] = project(b, view, [700, -1300, 0])!
  const hit = ground(b, view, x, y)!
  expect(hit[0]).toBeCloseTo(700, 4)
  expect(hit[1]).toBeCloseTo(-1300, 4)
})

test('the target is drawn at the middle, and north is up when looking north', () => {
  const north: View = { ...view, heading: 0, pitch: Math.PI / 2 }
  const b = basis(north)
  expect(project(b, north, [0, 0, 0])).toEqual([600, 400])
  const [x, y] = project(b, north, [0, 100, 0])!
  expect(x).toBeCloseTo(600, 6)
  expect(y).toBeCloseTo(400 - 100 * pixelsPerMeter(north), 6)
})

test('a point behind the camera and a pixel on the sky give nothing', () => {
  const low: View = { ...view, heading: 0, pitch: 0.2 }
  const b = basis(low)
  expect(project(b, low, [0, -20000, 0])).toBeNull()
  expect(ground(b, low, 600, 0)).toBeNull()
})
