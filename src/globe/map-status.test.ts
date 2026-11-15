import { expect, test } from 'bun:test'
import { INITIAL_MAP_STATUS, mapStatusReducer, mapStatusState } from './map-status'

test('an empty tile queue cannot declare unloaded terrain ready', () => {
  const state = mapStatusReducer(INITIAL_MAP_STATUS, { type: 'progress', queued: 0 })
  expect(mapStatusState(state)).toBe('loading')
  expect(mapStatusState(mapStatusReducer(state, { type: 'terrain-ready' }))).toBe('ready')
})

test('background loading and queue completion do not hide a terrain failure', () => {
  let state = mapStatusReducer(INITIAL_MAP_STATUS, { type: 'failure', source: 'Terrain' })
  for (const queued of [6, 0]) {
    state = mapStatusReducer(state, { type: 'progress', queued })
    expect(mapStatusState(state)).toBe('error')
  }
})

test('independent failures stay visible without repeated tile-error messages', () => {
  let state = INITIAL_MAP_STATUS
  for (const source of ['CTX imagery', 'Terrain', 'CTX imagery'] as const) {
    state = mapStatusReducer(state, { type: 'failure', source })
  }
  expect(state.failures).toEqual(['CTX imagery', 'Terrain'])
  expect(mapStatusState(state)).toBe('error')
})

test('retry starts loading again and can recover to a loaded view', () => {
  let state = mapStatusReducer(INITIAL_MAP_STATUS, { type: 'failure', source: 'CTX imagery' })
  state = mapStatusReducer(state, { type: 'reset' })
  expect(state.failures).toEqual([])
  expect(mapStatusState(state)).toBe('loading')
  state = mapStatusReducer(state, { type: 'terrain-ready' })
  state = mapStatusReducer(state, { type: 'progress', queued: 3 })
  expect(mapStatusState(state)).toBe('loading')
  state = mapStatusReducer(state, { type: 'progress', queued: 0 })
  expect(mapStatusState(state)).toBe('ready')
})
