import { expect, test } from 'bun:test'
import { createRouteSearch } from './route-search'
import { buildGrid, joinLegs, routeOptions } from './route-options'
import { DEFAULT_LIMITS } from './limits'
import { findWindows } from './eva-window'

function leg(a, b) {
  const grid = buildGrid(a, b, 12)
  return { grid, field: { elevation: grid.points.map((_, i) => (i % grid.cols) * 0.1), slope: grid.points.map(() => 1), thermal: grid.points.map(() => null) }, thermalPending: false, slopesPending: false, groundPending: false }
}

function fakeWorker() {
  const messages = []
  return {
    messages, onmessage: null, onerror: null, terminated: false,
    postMessage(message) { messages.push(message) },
    terminate() { this.terminated = true },
    finish() {
      const data = messages.shift()
      const result = data.kind === 'route'
        ? { kind: 'route', plan: routeOptions(data.leg.grid, data.leg.field, data.limits, data.leg.thermalPending) }
        : { kind: 'join', plan: joinLegs(data.plans, data.stops), note: null }
      this.onmessage({ data: result })
      return data
    },
  }
}

test('search reuses unchanged legs and returns the same paths as the synchronous solver', () => {
  const worker = fakeWorker()
  const search = createRouteSearch(() => worker)
  const stops = [[18.4, 77.4], [18.41, 77.4], [18.42, 77.4], [18.43, 77.4]]
  const legs = stops.slice(1).map((p, i) => leg(stops[i], p))
  let result
  const publish = (plan) => { result = plan }
  search.update(legs, DEFAULT_LIMITS, stops.slice(1, -1), publish, () => { throw Error('failed') })
  const jobs = []
  while (worker.messages.length) jobs.push(worker.finish())
  expect(jobs.filter((job) => job.kind === 'route')).toHaveLength(3)
  expect(result).toEqual(joinLegs(legs.map((item) => routeOptions(item.grid, item.field, DEFAULT_LIMITS)), stops.slice(1, -1)))
  const replacement = leg(stops[2], [18.44, 77.41])
  search.update([...legs.slice(0, 2), replacement], DEFAULT_LIMITS, stops.slice(1, -1), publish, () => {})
  expect(worker.finish().leg).toBe(replacement)
  expect(worker.finish().kind).toBe('join')
  expect(worker.messages).toEqual([])
  search.destroy()
})

test('rapid edits skip queued old legs and never publish stale limits or stops', () => {
  const worker = fakeWorker()
  const search = createRouteSearch(() => worker)
  const a = leg([0, 0], [0, 0.01]), b = leg([0, 0.01], [0, 0.02]), c = leg([0, 0], [0.01, 0.02])
  const old = [], current = []
  search.update([a, b], DEFAULT_LIMITS, [[0, 0.01]], (p) => old.push(p), () => {})
  search.update([c], { ...DEFAULT_LIMITS, slope: 15 }, [], (p) => current.push(p), () => {})
  worker.finish()
  expect(worker.messages[0].leg).toBe(c)
  worker.finish()
  worker.finish()
  expect(old).toEqual([])
  expect(current).toHaveLength(1)
  search.destroy()
})

test('worker failure can be retried and closing a map terminates its worker', () => {
  const workers = []
  const search = createRouteSearch(() => { const worker = fakeWorker(); workers.push(worker); return worker })
  const a = leg([0, 0], [0, 0.01])
  let failures = 0
  search.update([a], DEFAULT_LIMITS, [], () => {}, () => { failures++ })
  workers[0].onerror()
  expect(failures).toBe(1)
  expect(workers[0].terminated).toBe(true)
  search.update([a], DEFAULT_LIMITS, [], () => {}, () => {})
  expect(workers).toHaveLength(2)
  search.destroy()
  expect(workers[1].terminated).toBe(true)
})

test('the real worker preserves route and daylight-search results', async () => {
  const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' })
  const request = (task) => new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => resolve(data)
    worker.onerror = reject
    worker.postMessage(task)
  })
  try {
    const a = leg([18.4, 77.4], [18.41, 77.4])
    const result = await request({ kind: 'route', leg: a, limits: DEFAULT_LIMITS })
    expect(result.plan).toEqual(routeOptions(a.grid, a.field, DEFAULT_LIMITS))
    const input = { point: [18.4, 77.4], duration: 14400, now: Date.UTC(2026, 10, 15) }
    const windows = await request({ kind: 'windows', input, sols: 7 })
    expect(windows.search).toEqual(findWindows({ ...input, sols: 7 }))
  } finally { worker.terminate() }
})
