import { expect, test } from 'bun:test'
import { loadRouteField } from './route-field'
import { buildGrid, gridSlopes, routeOptions } from './route-options'
import { DEFAULT_LIMITS } from './plan'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const grid = buildGrid([18.4, 77.4], [18.42, 77.4])
const elevation = grid.points.map((_, i) => Math.sin(i / grid.cols) * 3)
const thermal = grid.points.map((_, i) => (i % grid.cols) / grid.cols)
const surface = elevation.map((value) => ({ elevation: value, slope: 7 }))

test('usable routes arrive before slope probes and infrared, with identical final results', async () => {
  const slopeData = deferred()
  const thermalData = deferred()
  const first = deferred()
  const updates = []
  const controller = new AbortController()
  const done = loadRouteField(grid, {
    elevations: async () => elevation,
    surface: () => slopeData.promise,
    thermal: () => thermalData.promise,
  }, (update) => { updates.push(update); first.resolve() }, controller.signal)
  await first.promise
  expect(updates).toHaveLength(1)
  const early = updates[0]
  expect(early.thermalPending).toBe(true)
  expect(early.slopesPending).toBe(true)
  const earlyPlan = routeOptions(grid, early.field, DEFAULT_LIMITS, early.thermalPending)
  expect(earlyPlan.options.map((o) => o.id)).toEqual(['fast', 'flat'])
  slopeData.resolve(surface)
  thermalData.resolve(thermal)
  await done
  const final = updates.at(-1)
  expect(final.thermalPending).toBe(false)
  expect(final.slopesPending).toBe(false)
  const reference = { elevation, slope: surface.map((s) => s.slope), thermal }
  expect(final.field).toEqual(reference)
  const finalPlan = routeOptions(grid, final.field, DEFAULT_LIMITS)
  expect(finalPlan).toEqual(routeOptions(grid, reference, DEFAULT_LIMITS))
  expect(finalPlan.options.slice(0, 2)).toEqual(earlyPlan.options)
})

test('infrared arriving before terrain produces the full route set at first publication', async () => {
  const terrainData = deferred()
  const updates = []
  const done = loadRouteField(grid, {
    elevations: () => terrainData.promise,
    surface: async () => surface,
    thermal: async () => thermal,
  }, (update) => updates.push(update), new AbortController().signal)
  // Let the already-resolved infrared promise settle before terrain arrives.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(updates).toHaveLength(0)
  terrainData.resolve(elevation)
  await done
  expect(updates[0].thermalPending).toBe(false)
  expect(updates[0].field.thermal).toEqual(thermal)
})

test('changing a route discards stale results and skips its later slope work', async () => {
  const terrainData = deferred()
  const thermalData = deferred()
  const updates = []
  let slopes = 0
  const controller = new AbortController()
  const done = loadRouteField(grid, {
    elevations: () => terrainData.promise,
    surface: async () => { slopes++; return surface },
    thermal: () => thermalData.promise,
  }, (update) => updates.push(update), controller.signal)
  controller.abort()
  terrainData.resolve(elevation)
  thermalData.resolve(thermal)
  await done
  expect(updates).toEqual([])
  expect(slopes).toBe(0)
})

test('optional data failures preserve terrain routes and the existing slope fallback', async () => {
  const updates = []
  await loadRouteField(grid, {
    elevations: async () => elevation,
    surface: async () => { throw Error('slope unavailable') },
    thermal: async () => { throw Error('IR unavailable') },
  }, (update) => updates.push(update), new AbortController().signal)
  const final = updates.at(-1)
  expect(final.thermalPending).toBe(false)
  expect(final.field.thermal).toEqual(grid.points.map(() => null))
  expect(final.field.slope).toEqual(gridSlopes(grid, elevation))
  expect(routeOptions(grid, final.field, DEFAULT_LIMITS).status).toBe('ok')
})

test('routes arrive before the ground check, and a failed check leaves the ground unknown', async () => {
  const groundData = deferred()
  const first = deferred()
  const updates = []
  const ground = grid.points.map((_, i) => (i % 7 ? 'none' : 'rocks'))
  const done = loadRouteField(grid, {
    elevations: async () => elevation,
    surface: async () => surface,
    thermal: async () => thermal,
    ground: () => groundData.promise,
  }, (update) => { updates.push(update); first.resolve() }, new AbortController().signal)
  await first.promise
  expect(updates[0].groundPending).toBe(true)
  expect(updates[0].field.ground).toBeUndefined()
  groundData.resolve(ground)
  await done
  expect(updates.at(-1).groundPending).toBe(false)
  expect(updates.at(-1).field.ground).toEqual(ground)

  const failed = []
  await loadRouteField(grid, {
    elevations: async () => elevation,
    surface: async () => surface,
    thermal: async () => thermal,
    ground: async () => { throw Error('HiRISE unavailable') },
  }, (update) => failed.push(update), new AbortController().signal)
  expect(failed.at(-1).groundPending).toBe(false)
  expect(failed.at(-1).field.ground).toEqual(grid.points.map(() => null))
  expect(routeOptions(grid, failed.at(-1).field, DEFAULT_LIMITS).status).toBe('ok')
})
