import { expect, test } from 'bun:test'
import { createRouteFields } from './route-fields'
import { buildGrid } from './route-options'
import type { LatLon } from './geo'
import type { RouteField } from './route-field'

function field(start: LatLon, target: LatLon): RouteField {
  const grid = buildGrid(start, target, 4)
  return { grid, field: { elevation: grid.points.map(() => 0), slope: grid.points.map(() => 0), thermal: grid.points.map(() => null) }, thermalPending: false, slopesPending: false, groundPending: false }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test('adding a waypoint to twenty legs samples only the two replacement legs', async () => {
  const stops: LatLon[] = Array.from({ length: 21 }, (_, i) => [18.4, 77.4 + i / 1000])
  let calls = 0
  let active = 0
  let peak = 0
  const loader = createRouteFields(async (a, b, publish) => {
    calls++
    active++
    peak = Math.max(peak, active)
    await tick()
    publish(field(a, b))
    active--
  })
  const load = (points: LatLon[]) => new Promise<RouteField[]>((resolve, reject) => loader.update(points, resolve, () => reject(Error('load failed'))))
  try {
    const first = await load(stops)
    const second = await load([...stops.slice(0, 10), [18.4001, 77.4095], ...stops.slice(10)])
    expect(calls).toBe(22)
    expect(peak).toBeLessThanOrEqual(2)
    expect(second).toHaveLength(21)
    expect(second[0]).toBe(first[0])
    expect(second[20]).toBe(first[19])
  } finally { loader.destroy() }
})

test('edits retain shared in-flight legs and cancel obsolete ones', async () => {
  const a: LatLon = [0, 0], b: LatLon = [0, 1], c: LatLon = [0, 2], d: LatLon = [1, 2]
  const pending: { a: LatLon; b: LatLon; signal: AbortSignal; finish: () => void }[] = []
  const loader = createRouteFields((a, b, publish, signal) => new Promise<void>((resolve) => {
    pending.push({ a, b, signal, finish: () => { publish(field(a, b)); resolve() } })
  }))
  const old: RouteField[][] = []
  const current: RouteField[][] = []
  try {
    loader.update([a, b, c], (value) => old.push(value), () => {})
    await tick()
    loader.update([a, b, d], (value) => current.push(value), () => {})
    expect(pending[0].signal.aborted).toBe(false)
    expect(pending[1].signal.aborted).toBe(true)
    pending[0].finish()
    pending[1].finish()
    await tick()
    await tick()
    expect(pending).toHaveLength(3)
    pending[2].finish()
    await tick()
    expect(old).toEqual([])
    expect(current).toHaveLength(1)
    expect(current[0][1].grid.points[current[0][1].grid.target]).toEqual(d)
  } finally { loader.destroy() }
})

test('repeated directed legs share work and retain the stop order', async () => {
  const a: LatLon = [0, 0], b: LatLon = [0, 1]
  let calls = 0
  const loader = createRouteFields(async (a, b, publish) => { calls++; publish(field(a, b)) })
  try {
    const result = await new Promise<RouteField[]>((resolve) => loader.update([a, b, a, b], resolve, () => {}))
    expect(calls).toBe(2)
    expect(result[0]).toBe(result[2])
    expect(result[1]).not.toBe(result[0])
  } finally { loader.destroy() }
})

test('slow optional imagery does not hold up terrain for later legs', async () => {
  const stops: LatLon[] = Array.from({ length: 6 }, (_, i) => [0, i])
  const finish: (() => void)[] = []
  const loader = createRouteFields((a, b, publish) => {
    publish({ ...field(a, b), groundPending: true })
    return new Promise<void>((resolve) => finish.push(resolve))
  })
  try {
    const result = await new Promise<RouteField[]>((resolve) => loader.update(stops, resolve, () => {}))
    expect(result).toHaveLength(5)
    expect(result.every((leg) => leg.groundPending)).toBe(true)
    expect(finish).toHaveLength(5)
  } finally { loader.destroy(); finish.forEach((done) => done()) }
})
