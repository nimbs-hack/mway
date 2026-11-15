import { expect, test } from 'bun:test'
import { GROUND_MIN_LEVEL, groundAt, groundLevel, measureTile, sampleGround } from './ground'

const SIZE = 256
// Level 17 HiRISE tiles are about 0.32 m per pixel.
const PIXEL = 0.32

// A grey tile. `paint(x, y)` returns a brightness, or null for no data.
function tile(paint) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const value = paint(x, y)
      data.set(value === null ? [0, 0, 0, 0] : [value, value, value, 255], (y * SIZE + x) * 4)
    }
  }
  return { width: SIZE, height: SIZE, data }
}

// The same pseudo-random numbers on every run.
function random(seed) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

// Dark 3 px blocks scattered over bright ground, like boulder shadows.
function boulders(share) {
  const next = random(7)
  const dark = new Uint8Array(SIZE * SIZE)
  for (let n = 0; n < (share * SIZE * SIZE) / 9; n++) {
    const x = Math.floor(next() * (SIZE - 3))
    const y = Math.floor(next() * (SIZE - 3))
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) dark[(y + dy) * SIZE + x + dx] = 1
  }
  return tile((x, y) => (dark[y * SIZE + x] ? 60 : 180))
}

const smooth = tile(() => 150)
const ripples = tile((x) => (x % 8 < 2 ? 100 : 200))

test('even ground has nothing to report', () => {
  expect(groundAt(measureTile(smooth, PIXEL), 128, 128)).toBe('none')
})

test('scattered shadows read as rocks and lined-up shadows as ripples', () => {
  expect(groundAt(measureTile(boulders(0.2), PIXEL), 128, 128)).toBe('rocks')
  expect(groundAt(measureTile(ripples, PIXEL), 128, 128)).toBe('ripples')
})

test('a few boulders on open ground stay under the rough share', () => {
  expect(groundAt(measureTile(boulders(0.02), PIXEL), 128, 128)).toBe('none')
})

test('brightness of the whole image does not change the reading', () => {
  const dim = tile((x) => (x % 8 < 2 ? 40 : 80))
  expect(groundAt(measureTile(dim, PIXEL), 128, 128)).toBe('ripples')
})

test('a gap in the mosaic is unknown, and readings stop at its edge', () => {
  const half = tile((x) => (x < 128 ? null : 150))
  const measured = measureTile(half, PIXEL)
  expect(groundAt(measured, 20, 128)).toBeNull()
  expect(groundAt(measured, 220, 128)).toBe('none')
})

test('the window covers the same ground at every tile level', () => {
  // A band of ripples 40 m wide on a level 15 tile, 1.27 m per pixel.
  const coarse = measureTile(tile((x) => (x >= 112 && x < 144 && x % 4 < 1 ? 60 : 180)), 1.27)
  expect(groundAt(coarse, 128, 128)).toBe('ripples')
  expect(groundAt(coarse, 40, 128)).toBe('none')
})

const jezero = [18.4447, 77.4508]

test('the deepest level within the tile budget is used', () => {
  expect(groundLevel([jezero], 17)).toBe(17)
  // Points about 110 m apart: 12 tiles at level 17, 9 at 16 and 5 at 15.
  const line = Array.from({ length: 12 }, (_, i) => [18.4447, 77.40 + i * 0.002])
  expect(groundLevel(line, 17, 12)).toBe(17)
  expect(groundLevel(line, 17, 9)).toBe(16)
  expect(groundLevel(line, 17, 5)).toBe(15)
  expect(groundLevel(line, 17, 4)).toBeNull()
  expect(GROUND_MIN_LEVEL).toBe(15)
})

test('points are read from the mosaic that covers them', async () => {
  const urls = []
  const load = async (url) => { urls.push(url); return ripples }
  const result = await sampleGround([jezero, [40, 10], [-4.6, 137.44]], { load })
  expect(result).toEqual(['ripples', null, 'ripples'])
  expect(urls.sort()).toEqual([
    expect.stringMatching(/^\/api\/imagery\/hirise\/gale\/16\/\d+\/\d+\.png$/),
    expect.stringMatching(/^\/api\/imagery\/hirise\/jezero\/17\/\d+\/\d+\.png$/),
  ])
})

test('a missing tile or a leg over the tile budget leaves the ground unknown', async () => {
  expect(await sampleGround([jezero], { load: async () => null })).toEqual([null])
  const line = Array.from({ length: 12 }, (_, i) => [18.4447, 77.40 + i * 0.002])
  let requests = 0
  const result = await sampleGround(line, { load: async () => { requests++; return smooth }, maxTiles: 2 })
  expect(result).toEqual(line.map(() => null))
  expect(requests).toBe(0)
})
