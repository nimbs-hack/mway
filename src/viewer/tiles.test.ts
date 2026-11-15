import { expect, test } from 'bun:test'
import { DATUM_OFFSET } from '../data/terrain-source.js'
import { CELLS, createTileSource, decodeTerrain, patchId, sampleGrid } from './tiles'

const MAX = 32767

// A quantized-mesh tile: vertices as [u, v, height] in 0 to 32767.
function mesh(vertices: number[][], triangles: number[], min: number, max: number): ArrayBuffer {
  const buffer = new ArrayBuffer(92 + vertices.length * 6 + 4 + triangles.length * 2)
  const view = new DataView(buffer)
  view.setFloat32(24, min, true)
  view.setFloat32(28, max, true)
  view.setUint32(88, vertices.length, true)
  let at = 92
  for (const axis of [0, 1, 2]) {
    let last = 0
    for (const vertex of vertices) {
      const delta = vertex[axis]! - last
      last = vertex[axis]!
      view.setUint16(at, (delta << 1) ^ (delta >> 31), true)
      at += 2
    }
  }
  view.setUint32(at, triangles.length / 3, true)
  at += 4
  let highest = 0
  for (const index of triangles) {
    view.setUint16(at, highest - index, true)
    at += 2
    if (index === highest) highest++
  }
  return buffer
}

// Ground that rises from 1000 m at the west edge to 3000 m at the east edge.
const slope = () => mesh([[0, 0, 0], [MAX, 0, MAX], [0, MAX, 0], [MAX, MAX, MAX]], [0, 1, 2, 1, 3, 2], 1000, 3000)

test('a terrain tile decodes to heights across the whole tile', () => {
  const grid = decodeTerrain(slope())
  expect(grid.some(Number.isNaN)).toBe(false)
  expect(sampleGrid(grid, 0, 0)).toBeCloseTo(1000, 1)
  expect(sampleGrid(grid, 1, 1)).toBeCloseTo(3000, 1)
  expect(sampleGrid(grid, 0.25, 0.7)).toBeCloseTo(1500, 1)
})

test('a damaged terrain tile is refused', () => {
  expect(() => decodeTerrain(new ArrayBuffer(40))).toThrow()
  expect(() => decodeTerrain(slope().slice(0, 100))).toThrow()
})

// Terrain exists at level 0 only, as two tiles of the slope above.
function source(fail: { terrain?: boolean; imagery?: boolean } = {}) {
  const asked: string[] = []
  const tiles = createTileSource(
    () => {},
    async (url) => {
      asked.push(url)
      if (url.endsWith('layer.json')) {
        return new TextEncoder().encode(JSON.stringify({ available: [[{ startX: 0, endX: 1, startY: 0, endY: 0 }]] })).buffer as ArrayBuffer
      }
      if (fail.terrain) throw new Error('offline')
      return slope()
    },
    async (url) => {
      asked.push(url)
      if (fail.imagery) throw new Error('offline')
      return { url } as unknown as HTMLImageElement
    },
  )
  return { tiles, asked }
}

const somewhere = { south: 10, north: 11, west: -91, east: -89 }

test('a patch takes its heights from the finest terrain that exists', async () => {
  const { tiles, asked } = source()
  const patch = await tiles.loadPatch(somewhere, 6)
  await patch.pictures
  expect(patch.terrainMissing).toBe(false)
  expect(patch.imageryMissing).toBe(false)
  expect(patch.tiles.some((tile) => tile.waiting || tile.image === null)).toBe(false)
  expect(asked.filter((url) => url.endsWith('.terrain'))).toEqual(['/api/terrain/mars-v14/0/0/0.terrain'])
  // -90 east is the middle of the western tile, halfway up the slope.
  expect(tiles.heightAt(10.5, -90)).toBeCloseTo(2000, 0)
  expect(tiles.heightAt(10.5, 270)).toBeCloseTo(2000, 0)
  const tile = patch.tiles.find((candidate) => candidate.west === -90)!
  expect(tile.heights[0]).toBeCloseTo(2000, 0)
})

test('tiles that share an edge get the same heights along it', async () => {
  const { tiles } = source()
  const patch = await tiles.loadPatch(somewhere, 6)
  const east = patch.tiles.find((tile) => tile.west === -90)!
  const west = patch.tiles.find((tile) => tile.west === -90 - tile.size && tile.north === east.north)!
  for (let row = 0; row <= CELLS; row++) {
    expect(west.heights[row * (CELLS + 1) + CELLS]).toBe(east.heights[row * (CELLS + 1)]!)
  }
})

test('past the finest imagery level a tile shows part of a coarser image', async () => {
  const { tiles, asked } = source()
  const patch = await tiles.loadPatch({ south: 10, north: 10.001, west: -90, east: -89.999 }, 14)
  await patch.pictures
  expect(patch.tiles[0]!.crop[2]).toBe(0.25)
  expect(asked.some((url) => url.includes('/api/imagery/ctx-v01/12/'))).toBe(true)
})

test('missing terrain and imagery are reported, and the ground is drawn level', async () => {
  const { tiles } = source({ terrain: true, imagery: true })
  let pictures = 0
  const patch = await tiles.loadPatch(somewhere, 6, () => pictures++)
  await patch.pictures
  expect(pictures).toBe(patch.tiles.length)
  expect(patch.terrainMissing).toBe(true)
  expect(patch.imageryMissing).toBe(true)
  expect(patch.tiles.every((tile) => tile.image === null && tile.heights.every((height) => height === DATUM_OFFSET))).toBe(true)
  expect(tiles.heightAt(10.5, -90)).toBeNull()
})

test('a patch is named by the tiles it covers', () => {
  expect(patchId(somewhere, 6)).toBe(patchId({ ...somewhere, north: 11.01 }, 6))
  expect(patchId(somewhere, 6)).not.toBe(patchId({ ...somewhere, west: -95 }, 6))
  expect(patchId(somewhere, 6)).not.toBe(patchId(somewhere, 7))
})
