import { expect, test } from 'bun:test'
import fileSymbols from '../../apps/api/internal/planner/marker-symbols.json'
import { MIL2525C_SYMBOLS, MIL2525C_THEMES } from './mil2525c'
import { addMarker, loadMarkers, removeMarker, saveMarkers, symbolImage, updateMarker } from './markers'

function memory() {
  const data = {}
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}

test('mission files accept exactly the map symbol catalog', () => {
  expect(fileSymbols.toSorted()).toEqual(MIL2525C_SYMBOLS.map((symbol) => symbol.id).toSorted())
})

test('every symbol has a 15-character SIDC and a known theme', () => {
  const themes = new Set(MIL2525C_THEMES.map((t) => t.id))
  expect(MIL2525C_SYMBOLS).toHaveLength(30)
  for (const symbol of MIL2525C_SYMBOLS) {
    expect(symbol.sidc).toHaveLength(15)
    expect(themes.has(symbol.theme)).toBe(true)
  }
})

test('markers add, rename, move and remove', () => {
  let markers = addMarker([], 'mil2525c-habitat', [-4.6, 137.4], 'a')
  expect(markers[0]).toEqual({ id: 'a', symbol: 'mil2525c-habitat', point: [-4.6, 137.4], label: 'Habitat' })
  markers = updateMarker(markers, 'a', { label: 'Base camp', symbol: 'mil2525c-airlock' })
  expect(markers[0].label).toBe('Base camp')
  expect(removeMarker(markers, 'a')).toEqual([])
})

test('saved markers survive a reload and bad entries are dropped', () => {
  const storage = memory()
  saveMarkers(addMarker([], 'mil2525c-crater', [1, 2], 'a'), storage)
  expect(loadMarkers(storage)).toHaveLength(1)
  storage.setItem('nimbs.markers.v1', JSON.stringify([{ id: 'x', symbol: 'nope', point: [0, 0], label: '' }, 'junk']))
  expect(loadMarkers(storage)).toEqual([])
  storage.setItem('nimbs.markers.v1', '{broken')
  expect(loadMarkers(storage)).toEqual([])
})

test('symbol images are SVG data URLs in the given color', () => {
  const url = symbolImage('mil2525c-habitat', '#fff8f3', '#050709')
  expect(url.startsWith('data:image/svg+xml')).toBe(true)
  expect(decodeURIComponent(url)).toContain('#fff8f3')
})
