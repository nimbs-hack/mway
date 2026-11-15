import { expect, test } from 'bun:test'
import { loadEva, saveEva } from './eva-storage'
import { DEFAULT_LIMITS, EMPTY_PLAN } from './plan'

function memory() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('opening a mission never inherits the standalone route, and switching back restores its own route', () => {
  const storage = memory()
  const old = { plan: { start: [13, -31] as [number, number], target: [14, -30] as [number, number], waypoints: [] }, limits: DEFAULT_LIMITS }
  saveEva(undefined, old, storage)
  expect(loadEva('yellowknife', storage).plan).toEqual(EMPTY_PLAN)
  const local = { plan: { ...old.plan, start: [-4.59, 137.44] as [number, number], when: '2035-01-01T10:00:00Z' }, limits: { ...DEFAULT_LIMITS, work: 7200 } }
  saveEva('yellowknife', local, storage)
  expect(loadEva('another-mission', storage).plan).toEqual(EMPTY_PLAN)
  expect(loadEva('yellowknife', storage)).toMatchObject(local)
  expect(loadEva(undefined, storage)).toMatchObject(old)
  saveEva('yellowknife', { plan: EMPTY_PLAN, limits: DEFAULT_LIMITS }, storage)
  expect(loadEva('yellowknife', storage).plan.target).toBeNull()
  expect(loadEva(undefined, storage).plan.target).toEqual(old.plan.target)
})

test('malformed coordinates and unavailable storage recover to an empty mission route', () => {
  const storage = memory()
  storage.setItem('nimbs.eva-plan:a', JSON.stringify({ plan: { start: [91, 0], target: null, waypoints: [] }, limits: DEFAULT_LIMITS }))
  expect(loadEva('a', storage).plan).toEqual(EMPTY_PLAN)
  storage.setItem('nimbs.eva-plan:a', '{')
  expect(loadEva('a', storage).plan).toEqual(EMPTY_PLAN)
  expect(loadEva('a', { getItem: () => { throw Error('blocked') } }).plan).toEqual(EMPTY_PLAN)
})

test('a route saved before rough-ground speeds existed loads with the preset shares', () => {
  const storage = memory()
  const { rocks, ripples, ...older } = DEFAULT_LIMITS
  storage.setItem('nimbs.eva-plan:a', JSON.stringify({ plan: { start: [18.44, 77.45], target: [18.45, 77.45], waypoints: [] }, limits: { ...older, pace: 0.6 } }))
  expect(loadEva('a', storage).limits).toEqual({ ...DEFAULT_LIMITS, pace: 0.6, rocks, ripples })
})
