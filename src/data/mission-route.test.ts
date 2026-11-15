import { expect, test } from 'bun:test'
import { setRoutePoints, type Draft } from '../state'
import { type LatLon } from './geo'
import { EMPTY_PLAN, type Plan, stopPath, withMissionSites } from './plan'

const a: LatLon = [-4.6, 137.4]
const b: LatLon = [-4.61, 137.41]
const c: LatLon = [-4.62, 137.42]
const blank: Draft = { name: 'Walk', type: 'mars-long-stay', marginPercent: 40, crew: [], phases: [], sites: [], tasks: [] }
const sitesInOrder = (draft: Draft) => draft.route!.map((site) => draft.sites[site]!)

test('right-click endpoints create sites and plan stops, reuse sites, and preserve earlier drafts for undo', () => {
  const start = setRoutePoints(blank, [a])
  const both = setRoutePoints(start, [a, b])
  expect(start.route).toEqual([0])
  expect(both.route).toEqual([0, 1])
  expect(both.sites.map(({ lat, lon }) => [lat, lon])).toEqual([a, b])
  expect(setRoutePoints(both, [a, b]).sites).toEqual(both.sites)
  const moved = setRoutePoints(both, [a, c])
  expect(moved.route).toEqual([0, 2])
  expect(moved.sites[1]).toEqual(both.sites[1])
  expect(blank.sites).toEqual([])
  expect(start.sites).toHaveLength(1)
  expect(both.sites).toHaveLength(2)
  const assessed: Plan = { start: a, target: c, waypoints: [], when: '2026-11-20T12:00', route: 'flat' }
  expect(withMissionSites(assessed, sitesInOrder(both))).toMatchObject({ start: a, target: b, route: 'flat', when: assessed.when })
  expect(withMissionSites(assessed, sitesInOrder(start))).toMatchObject({ start: a, target: null, waypoints: [] })
  expect(withMissionSites(assessed, [])).toMatchObject({ start: null, target: null, waypoints: [] })
})

test('placing B first keeps it as the target, including coordinate rounding, and A goes before it', () => {
  const target = setRoutePoints(blank, [b])
  const map = withMissionSites({ ...EMPTY_PLAN, target: [b[0] + 0.0000001, b[1] - 0.0000001] }, sitesInOrder(target))
  expect(map).toMatchObject({ start: null, target: b })
  const both = setRoutePoints(target, [a, b])
  expect(both.route).toEqual([1, 0])
  expect(withMissionSites(map, sitesInOrder(both))).toMatchObject({ start: a, target: b })
})

test('route edits retain site tasks and the distinct tasks of repeated visits', () => {
  const base = setRoutePoints(blank, [a, b, a])
  const task = (site: number, stop: number) => ({ site, stop, phase: 0, crew: [], kind: 'sample', eva: true, hours: 1, note: '' })
  const draft = { ...base, tasks: [task(0, 0), task(1, 1), task(0, 2)] }
  const extended = setRoutePoints(draft, [c, a, b, a])
  expect(extended.tasks.map((task) => [task.site, task.stop])).toEqual([[0, 1], [1, 2], [0, 3]])
  const changed = setRoutePoints(draft, [a, c, a])
  expect(changed.tasks.map((task) => [task.site, task.stop])).toEqual([[0, 0], [1, undefined], [0, 2]])
  expect(changed.sites[1]).toEqual(draft.sites[1])
  expect(setRoutePoints(draft, [a, a, b]).route).toEqual([0, 1])
})

test('generated route bends do not become mission sites or plan stops', () => {
  const bend: LatLon = [-4.605, 137.405]
  const map: Plan = { start: a, target: c, waypoints: [bend, b], generated: [bend], route: 'flat' }
  const draft = setRoutePoints(blank, stopPath(map))
  expect(draft.sites.map(({ lat, lon }) => [lat, lon])).toEqual([a, b, c])
  expect(withMissionSites(map, sitesInOrder(draft))).toBe(map)
})
