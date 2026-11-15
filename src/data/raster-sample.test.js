import { expect, test } from 'bun:test'
import { loadTile, sampleRaster, tileFor, pixelValue } from './raster-sample'

const source = { maxLevel: 1, tileSize: 2, url: '/tile/{z}/{y}/{x}', legend: { colors: [] } }

test('a batch loads each image once and keeps every pixel sample in order', async () => {
  const pixels = { width: 2, height: 2, data: new Uint8ClampedArray([
    0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 255, 255, 255, 255,
  ]) }
  const points = Array.from({ length: 2000 }, (_, i) => [i % 80, i % 170])
  const calls = []
  const values = await sampleRaster(source, points, async (url) => { calls.push(url); return pixels })
  expect(calls.length).toBe(4)
  expect(values).toEqual(points.map((point) => {
    const { px, py } = tileFor(point, source.maxLevel, source.tileSize)
    return pixelValue(pixels, px, py, [])
  }))
  expect(await sampleRaster(source, points, async () => null)).toEqual(points.map(() => null))
})

test('image failures can be retried and decoded bitmaps are released', async () => {
  const originalFetch = globalThis.fetch
  const originalBitmap = globalThis.createImageBitmap
  const originalCanvas = globalThis.OffscreenCanvas
  let calls = 0
  let closed = 0
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }
  try {
    globalThis.fetch = async () => {
      calls++
      return calls === 1 ? new Response('', { status: 503 }) : new Response('image')
    }
    globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close: () => { closed++ } })
    globalThis.OffscreenCanvas = class {
      getContext() { return { drawImage() {}, getImageData: () => pixels } }
    }
    expect(await loadTile('/retry-image-test')).toBeNull()
    const results = await Promise.all([loadTile('/retry-image-test'), loadTile('/retry-image-test')])
    expect(results).toEqual([pixels, pixels])
    expect(await loadTile('/retry-image-test')).toEqual(pixels)
    expect(calls).toBe(2)
    expect(closed).toBe(1)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.createImageBitmap = originalBitmap
    globalThis.OffscreenCanvas = originalCanvas
  }
})
