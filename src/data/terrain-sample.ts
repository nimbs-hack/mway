import { Cartographic, sampleTerrain } from 'cesium'
import type { TerrainData, TerrainProvider } from 'cesium'
import { indexTerrainHeights } from './terrain-height'
import { offset } from './geo'
import type { LatLon } from './geo'
import { DATUM_OFFSET } from './terrain.js'
import { yieldTask } from './yield-task'

// Elevation and slope from the Mars Trek terrain mesh the globe renders.
// Elevation is meters above the MOLA areoid. Slope is the steepest slope at
// the point in degrees, from a centered difference over SLOPE_BASELINE.
// Trek blends MOLA, HRSC and HiRISE, so slope detail depends on location.

export const SLOPE_BASELINE = 60 // meters between the point and each neighbor

export function slopeFromNeighbors(north: number, south: number, east: number, west: number, spacing: number) {
  const dx = (east - west) / (2 * spacing)
  const dy = (north - south) / (2 * spacing)
  return Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI
}

export type SurfaceSample = { elevation: number | null; slope: number | null }

// Sampling owns these tiles. Sharing mutable TerrainData with the renderer
// would let mesh creation discard the buffers while another caller uses them.
const samplers = new WeakMap<TerrainProvider, TerrainProvider>()

export function samplingProvider(provider: TerrainProvider): TerrainProvider {
  const existing = samplers.get(provider)
  if (existing) return existing
  const tiles = new Map<string, { data: TerrainData; bytes: number }>()
  const pending = new Map<string, Promise<TerrainData>>()
  let usedBytes = 0
  const sampler: TerrainProvider = Object.create(provider)
  sampler.requestTileGeometry = (x, y, level) => {
    // A single-layer Cesium provider still downloads tiles explicitly marked
    // absent. Skip those requests so sampleSurface can try its next level now.
    if (provider.getTileDataAvailable?.(x, y, level) === false) {
      return Promise.reject(new Error('Terrain tile outside measured coverage'))
    }
    const key = `${level}/${x}/${y}`
    const hit = tiles.get(key)
    if (hit) {
      tiles.delete(key)
      tiles.set(key, hit)
      return Promise.resolve(hit.data)
    }
    const active = pending.get(key)
    if (active) return active
    const request = provider.requestTileGeometry(x, y, level)
    if (!request) return undefined
    const job = request.then(indexTerrainHeights).then((data) => {
      // Count each backing buffer once. Allow room for the triangle index and
      // object overhead as well as the decoded mesh. A 10 km grid can use 300
      // tiles, so a small tile-count limit discards data still in active use.
      const buffers = new Set(Object.values(data).filter(ArrayBuffer.isView).map((view) => view.buffer))
      const bytes = 4096 + [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) * 4
      if (bytes <= 64 * 1024 * 1024) {
        tiles.set(key, { data, bytes })
        usedBytes += bytes
        while (usedBytes > 64 * 1024 * 1024 || tiles.size > 2048) {
          const oldest = tiles.keys().next().value!
          usedBytes -= tiles.get(oldest)!.bytes
          tiles.delete(oldest)
        }
      }
      return data
    }).finally(() => pending.delete(key))
    // Pending requests have their own map. Evicting a completed tile must not
    // duplicate a download that another route or the profile is still using.
    pending.set(key, job)
    return job
  }
  samplers.set(provider, sampler)
  return sampler
}

// Bound the interpolation and request queue for each edit. Cached tiles can
// otherwise resolve an entire dense grid in one uninterrupted microtask.
async function sampleBatches(provider: TerrainProvider, level: number, positions: Cartographic[], signal?: AbortSignal) {
  const samples: Cartographic[] = []
  for (let i = 0; i < positions.length; i += 512) {
    signal?.throwIfAborted()
    if (i) await yieldTask()
    signal?.throwIfAborted()
    const batch = await sampleTerrain(samplingProvider(provider), level, positions.slice(i, i + 512))
    signal?.throwIfAborted()
    samples.push(...batch)
  }
  return samples
}

async function sampleAt(provider: TerrainProvider, level: number, points: LatLon[], baseline: number, signal?: AbortSignal) {
  const positions = points.flatMap((point) => [point,
    offset(point, baseline, 0), offset(point, -baseline, 0),
    offset(point, 0, baseline), offset(point, 0, -baseline),
  ].map(([lat, lon]) => Cartographic.fromDegrees(lon, lat)))
  const heights = (await sampleBatches(provider, level, positions, signal)).map((c) => c.height)
  return points.map((_, i): SurfaceSample => {
    const [center, north, south, east, west] = heights.slice(i * 5, i * 5 + 5)
    const known = (h: number | undefined): h is number => typeof h === 'number' && Number.isFinite(h)
    return {
      elevation: known(center) ? center - DATUM_OFFSET : null,
      slope: [north, south, east, west].every(known)
        ? slopeFromNeighbors(north as number, south as number, east as number, west as number, baseline)
        : null,
    }
  })
}

// Tries a detailed level first, then coarser ones where tiles are missing.
// `baseline` is the neighbor distance for slope. Fine terrain can use a short
// one; on the global terrain anything under 60 m only measures mesh noise.
export async function sampleSurface(provider: TerrainProvider, points: LatLon[], level = 14, baseline = SLOPE_BASELINE, signal?: AbortSignal) {
  let samples = points.map((): SurfaceSample => ({ elevation: null, slope: null }))
  for (let current = level; current >= 8; current -= 2) {
    signal?.throwIfAborted()
    const missing = samples.map((s, i) => (s.elevation === null ? i : -1)).filter((i) => i >= 0)
    if (missing.length === 0) break
    const found = await sampleAt(provider, current, missing.map((i) => points[i]), baseline, signal).catch(() => [])
    signal?.throwIfAborted()
    missing.forEach((index, k) => { if (found[k]) samples[index] = found[k] })
    samples = [...samples]
  }
  return samples
}

// The search uses elevation differences between grid nodes. Sample those
// first; the surrounding slope probes only explain why alternatives agree.
export async function sampleElevations(provider: TerrainProvider, points: LatLon[], level = 14, signal?: AbortSignal) {
  const elevations: (number | null)[] = points.map(() => null)
  for (let current = level; current >= 8; current -= 2) {
    signal?.throwIfAborted()
    const missing = elevations.flatMap((height, i) => height === null ? [i] : [])
    if (!missing.length) break
    const positions = missing.map((i) => Cartographic.fromDegrees(points[i][1], points[i][0]))
    const sampled = await sampleBatches(provider, current, positions, signal).catch(() => [])
    signal?.throwIfAborted()
    missing.forEach((index, i) => {
      const height = sampled[i]?.height
      if (Number.isFinite(height)) elevations[index] = height - DATUM_OFFSET
    })
  }
  return elevations
}
