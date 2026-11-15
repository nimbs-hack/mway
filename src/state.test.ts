import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { Astronaut } from './api'
import { loadRoster } from './state'

const person: Astronaut = {
  name: 'VEGA', sex: 'female', age: 41, massKg: 70, heightCm: 168,
  role: 'commander', activity: 'active', evaShare: 1,
}
const catalog = { sampleRoster: [{ ...person, name: 'Christina Koch' }] }
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let saved: Astronaut[]

beforeEach(() => {
  saved = []
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => JSON.stringify(saved) },
  })
})

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

test('updating the sample roster keeps edited inputs and custom people', () => {
  const custom = { ...person, name: 'STIVEN', massKg: 82 }
  saved = [person, custom]
  const roster = loadRoster(catalog)
  expect(roster).toEqual([{ ...person, name: 'Christina Koch' }, custom])
  saved = roster
  expect(loadRoster(catalog)).toEqual(roster)
})

test('an existing astronaut profile wins over the former sample entry', () => {
  const edited = { ...person, name: 'Christina Koch', massKg: 75 }
  saved = [person, edited]
  expect(loadRoster(catalog)).toEqual([edited])
})

test('the plan visits sites in its own order, may come back, and never repeats a stop', async () => {
  const { createEdits } = await import('./state')
  const edits = createEdits({ taskKinds: ['sample'] } as unknown as Parameters<typeof createEdits>[0])
  type D = Parameters<typeof edits.addStop>[0]
  const site = (name: string) => ({ name, lat: 0, lon: 0 })
  const task = (at: number) => ({ site: at, phase: 0, crew: [], kind: 'sample', eva: true, hours: 1, note: '' })
  let draft = { sites: [site('A'), site('B'), site('C')], tasks: [task(1), task(2)] } as unknown as D
  // A, B, A, C, A
  for (const stop of [0, 1, 0, 2, 0]) draft = edits.addStop(draft, stop)
  expect(draft.route).toEqual([0, 1, 0, 2, 0])
  // A site cannot follow itself, by adding or by moving.
  expect(edits.addStop(draft, 0)).toBe(draft)
  expect(edits.moveStop(draft, 1, 2)).toBe(draft)
  const three = { ...draft, route: [0, 1, 2] }
  expect(edits.moveStop(three, 2, 0).route).toEqual([2, 0, 1])
  // Removing B leaves A, A, C, A, which becomes A, C, A.
  expect(edits.removeStop(draft, 1).route).toEqual([0, 2, 0])
  // Removing site B drops its stops and its task, and C becomes site 1.
  const gone = edits.removeSite(draft, 1)
  expect(gone.route).toEqual([0, 1, 0])
  expect(gone.tasks.map((t) => t.site)).toEqual([1])
})

test('a task belongs to its plan stop and follows it', async () => {
  const { createEdits } = await import('./state')
  const edits = createEdits({ taskKinds: ['sample'] } as unknown as Parameters<typeof createEdits>[0])
  type D = Parameters<typeof edits.addTask>[0]
  const site = (name: string) => ({ name, lat: 0, lon: 0 })
  const base = { sites: [site('A'), site('B'), site('C')], tasks: [], phases: [{ evaHoursPerWeek: 10 }] } as unknown as D
  // Without a plan, adding a task at the second stop makes the list order the plan.
  const listed = edits.addTask(base, 1)
  expect(listed.route).toEqual([0, 1, 2])
  expect(listed.tasks[0]).toMatchObject({ site: 1, stop: 1 })
  // A, B, A, C, A with a task at each visit to A.
  let draft = { ...base, route: [0, 1, 0, 2, 0] } as D
  for (const stop of [0, 2, 4]) draft = edits.addTask(draft, stop)
  expect(draft.tasks.map((t) => t.stop)).toEqual([0, 2, 4])
  // Moving C before B carries the stops' order, and no site follows itself.
  const moved = edits.moveStop({ ...draft, route: [0, 1, 2, 0] } as D, 2, 1)
  expect(moved.route).toEqual([0, 2, 1, 0])
  // Removing the B stop merges the two A visits around it, with their tasks.
  const merged = edits.removeStop(draft, 1)
  expect(merged.route).toEqual([0, 2, 0])
  expect(merged.tasks.map((t) => t.stop)).toEqual([0, 0, 2])
  // Removing a stop takes its own tasks.
  expect(edits.removeStop(draft, 4).tasks.map((t) => t.stop)).toEqual([0, 2])
})
