import { expect, test } from 'bun:test'
import { GeographicTilingScheme } from 'cesium'
import { samplingProvider, sampleElevations, sampleSurface } from './terrain-sample'
import { DATUM_OFFSET } from './terrain'

const tile = (height) => ({ interpolateHeight: () => height })

test('sampling shares pending geometry and reuses it across routes and tools', async () => {
  let calls = 0
  const provider = {
    requestTileGeometry: async () => { calls++; return tile(123) },
  }
  const sampler = samplingProvider(provider)
  const a = sampler.requestTileGeometry(1, 2, 14)
  const b = samplingProvider(provider).requestTileGeometry(1, 2, 14)
  expect(a).toBe(b)
  const data = await a
  expect(await sampler.requestTileGeometry(1, 2, 14)).toBe(data)
  expect(calls).toBe(1)
  expect(await samplingProvider({ ...provider }).requestTileGeometry(1, 2, 14)).not.toBe(data)
})

test('sampling retries failed and throttled requests', async () => {
  let calls = 0
  const provider = {
    requestTileGeometry: () => {
      calls++
      if (calls === 1) return undefined
      if (calls === 2) return Promise.reject(Error('network'))
      return Promise.resolve(tile(456))
    },
  }
  const sampler = samplingProvider(provider)
  expect(sampler.requestTileGeometry(0, 0, 14)).toBeUndefined()
  await expect(sampler.requestTileGeometry(0, 0, 14)).rejects.toThrow('network')
  expect((await sampler.requestTileGeometry(0, 0, 14)).interpolateHeight()).toBe(456)
  expect(calls).toBe(3)
})

test('known missing coverage falls back without downloads; unknown coverage still loads', async () => {
  const levels = []
  const provider = {
    tilingScheme: new GeographicTilingScheme(),
    getTileDataAvailable: (_x, _y, level) => level > 10 ? false : undefined,
    requestTileGeometry: async (_x, _y, level) => { levels.push(level); return tile(DATUM_OFFSET + 100) },
  }
  const samples = await sampleSurface(provider, [[18.4, 77.4]], 14)
  expect(levels).toEqual([10])
  expect(samples).toEqual([{ elevation: 100, slope: 0 }])
})

test('the sampling cache evicts least recently used tiles when its memory budget fills', async () => {
  let calls = 0
  const sampler = samplingProvider({ requestTileGeometry: async () => {
    calls++
    return { ...tile(123), buffer: new Uint8Array(512 * 1024) }
  } })
  for (let x = 0; x < 31; x++) await sampler.requestTileGeometry(x, 0, 14)
  await sampler.requestTileGeometry(0, 0, 14)
  await sampler.requestTileGeometry(31, 0, 14)
  await sampler.requestTileGeometry(0, 0, 14)
  expect(calls).toBe(32)
  await sampler.requestTileGeometry(1, 0, 14)
  expect(calls).toBe(33)
})


test('a route with 300 tiles stays cached for the next nearby edit', async () => {
  let calls = 0
  const sampler = samplingProvider({ requestTileGeometry: async () => { calls++; return tile(123) } })
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 0; x < 300; x++) await sampler.requestTileGeometry(x, 0, 14)
  }
  expect(calls).toBe(300)
})

test('cache pressure never evicts an in-flight request', async () => {
  let release
  let calls = 0
  const done = new Promise((resolve) => { release = resolve })
  const sampler = samplingProvider({ requestTileGeometry: () => { calls++; return done } })
  const requests = Array.from({ length: 2100 }, (_, x) => sampler.requestTileGeometry(x, 0, 14))
  expect(sampler.requestTileGeometry(0, 0, 14)).toBe(requests[0])
  expect(calls).toBe(2100)
  release(tile(123))
  await Promise.all(requests)
})

test('elevation-first sampling matches full surface sampling and fallback levels', async () => {
  const provider = {
    tilingScheme: new GeographicTilingScheme(),
    getTileDataAvailable: (_x, _y, level) => level < 14,
    requestTileGeometry: async (_x, _y, level) => ({
      interpolateHeight: (_rectangle, lon, lat) => DATUM_OFFSET + level * 10 + lon * 2 + lat * 3,
    }),
  }
  const points = [[18.4, 77.4], [-4.8, 137.3]]
  const elevations = await sampleElevations(provider, points)
  const surface = await sampleSurface(provider, points)
  expect(elevations).toEqual(surface.map((s) => s.elevation))
  expect(elevations.every((height) => height !== null)).toBe(true)
})

test('canceling a dense cached grid stops before another batch or fallback level', async () => {
  const controller = new AbortController()
  let samples = 0
  const provider = {
    tilingScheme: new GeographicTilingScheme(),
    requestTileGeometry: async () => ({ interpolateHeight() {
      samples++
      if (samples === 512) controller.abort()
      return DATUM_OFFSET + 100
    } }),
  }
  await expect(sampleElevations(provider, Array.from({ length: 5000 }, () => [18.4, 77.4]), 14, controller.signal)).rejects.toThrow()
  expect(samples).toBe(512)
})
