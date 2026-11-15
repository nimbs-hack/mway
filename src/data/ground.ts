import { MARS_RADIUS } from './geo'
import type { LatLon } from './geo'
import { HIRISE_LAYERS, hiriseTileUrl } from './imagery.js'
import { fetchTile, tileFor } from './raster-sample'
import type { Pixels, TileLoader } from './raster-sample'

// Rough ground seen in the HiRISE mosaics: rocks and ripples. An ESTIMATE
// from image shadows, not a rock count. Rocks, ledges and ripples cast sharp
// shadows, so the share of pixels much darker than the ground around them
// marks rough ground, the idea behind the HiRISE rock maps made for landing
// site selection (Golombek et al. 2008). Where the shadows line up the ground
// is rippled, which on Mars means wind-blown sand. Where they point every way
// it is blocky: boulders, outcrop and ledges.
//
// The thresholds were set on Jezero tiles, where they mark the Séítah ripple
// field and leave the crater floor Perseverance drove on. They miss rocks
// smaller than a few pixels, about 1 m, and low-contrast ground such as the
// ripples near Curiosity. So 'none' means nothing was seen, not that the
// ground is clear, and null means no image was read at all.
// Coordinates are planetocentric latitude and east longitude, -180 to 180.

export type Ground = 'rocks' | 'ripples' | 'none'

export const GROUND_NAME: Record<Exclude<Ground, 'none'>, string> = { rocks: 'Rocks', ripples: 'Ripples' }

// A pixel is in shadow when it is this much darker than the mean of the
// ground within SHADOW_REACH meters of it.
const SHADOW_RATIO = 0.85
const SHADOW_REACH = 2.5
// Ground is rough when at least this share of it is in shadow.
export const ROUGH_SHARE = 0.1
// Rough ground is rippled when its image gradients line up at least this
// much, from 0 for no common direction to 1 for parallel stripes.
export const ALIGNED = 0.35
// Meters around a point that one reading covers.
export const GROUND_RADIUS = 7.5
// Coarser tiles than this level, 1.3 m per pixel, blur the shadows away.
export const GROUND_MIN_LEVEL = 15
// Most tiles one request reads, about 9 MB. A longer leg is left unread.
const MAX_TILES = 160
// Pixels along the side of one block of sums.
const BLOCK = 4

// Sums over blocks of BLOCK by BLOCK pixels, enough to classify any window
// of blocks without keeping the image.
export type GroundTile = {
  cols: number
  rows: number
  pixelMeters: number
  valid: Float32Array
  dark: Float32Array
  // Sums of the image gradient products, the structure tensor.
  xx: Float32Array
  yy: Float32Array
  xy: Float32Array
}

export function measureTile(pixels: Pixels, pixelMeters: number): GroundTile {
  const { width, height, data } = pixels
  const light = new Float32Array(width * height)
  const known = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    known[i] = data[i * 4 + 3] >= 128 ? 1 : 0
    light[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
  }
  // Summed-area tables of brightness and of known pixels, for local means.
  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  const counts = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    let rowCount = 0
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      rowSum += known[i] ? light[i] : 0
      rowCount += known[i]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum
      counts[(y + 1) * stride + x + 1] = counts[y * stride + x + 1] + rowCount
    }
  }
  const reach = Math.max(1, Math.round(SHADOW_REACH / pixelMeters))
  const cols = Math.ceil(width / BLOCK)
  const rows = Math.ceil(height / BLOCK)
  const tile: GroundTile = {
    cols,
    rows,
    pixelMeters,
    valid: new Float32Array(cols * rows),
    dark: new Float32Array(cols * rows),
    xx: new Float32Array(cols * rows),
    yy: new Float32Array(cols * rows),
    xy: new Float32Array(cols * rows),
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - reach)
    const y1 = Math.min(height, y + reach + 1)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!known[i]) continue
      const x0 = Math.max(0, x - reach)
      const x1 = Math.min(width, x + reach + 1)
      const a = y1 * stride + x1
      const b = y0 * stride + x1
      const c = y1 * stride + x0
      const d = y0 * stride + x0
      const mean = (sums[a] - sums[b] - sums[c] + sums[d]) / (counts[a] - counts[b] - counts[c] + counts[d])
      const block = Math.floor(y / BLOCK) * cols + Math.floor(x / BLOCK)
      tile.valid[block]++
      if (light[i] < SHADOW_RATIO * mean) tile.dark[block]++
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue
      if (!known[i - 1] || !known[i + 1] || !known[i - width] || !known[i + width]) continue
      const gx = light[i + 1] - light[i - 1]
      const gy = light[i + width] - light[i - width]
      tile.xx[block] += gx * gx
      tile.yy[block] += gy * gy
      tile.xy[block] += gx * gy
    }
  }
  return tile
}

// The ground within `radius` meters of a pixel, from the blocks around it.
// The window stops at the tile edge. Null where under half of it has data.
export function groundAt(tile: GroundTile, px: number, py: number, radius = GROUND_RADIUS): Ground | null {
  const reach = Math.max(1, Math.round(radius / (BLOCK * tile.pixelMeters)))
  const bx = Math.floor(px / BLOCK)
  const by = Math.floor(py / BLOCK)
  const x0 = Math.max(0, bx - reach)
  const x1 = Math.min(tile.cols, bx + reach + 1)
  const y0 = Math.max(0, by - reach)
  const y1 = Math.min(tile.rows, by + reach + 1)
  let valid = 0
  let dark = 0
  let xx = 0
  let yy = 0
  let xy = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * tile.cols + x
      valid += tile.valid[i]
      dark += tile.dark[i]
      xx += tile.xx[i]
      yy += tile.yy[i]
      xy += tile.xy[i]
    }
  }
  if (valid < 0.5 * (x1 - x0) * (y1 - y0) * BLOCK * BLOCK) return null
  if (dark / valid < ROUGH_SHARE) return 'none'
  const aligned = Math.hypot(xx - yy, 2 * xy) / Math.max(1e-9, xx + yy)
  return aligned >= ALIGNED ? 'ripples' : 'rocks'
}

type Mosaic = { id: string, bounds: [west: number, south: number, east: number, north: number], maxLevel: number }
const MOSAICS = HIRISE_LAYERS as unknown as Mosaic[]

function mosaicAt([lat, lon]: LatLon) {
  return MOSAICS.find(({ bounds: [west, south, east, north] }) => lon >= west && lon <= east && lat >= south && lat <= north) ?? null
}

const TILE_SIZE = 256

function tileKey(point: LatLon, level: number) {
  const { x, y } = tileFor(point, level, TILE_SIZE)
  return `${level}/${y}/${x}`
}

// The deepest level that reads all the points within the tile budget, or
// null when even the coarsest usable level needs too many tiles.
export function groundLevel(points: LatLon[], maxLevel: number, maxTiles = MAX_TILES) {
  for (let level = maxLevel; level >= GROUND_MIN_LEVEL; level--) {
    const tiles = new Set<string>()
    for (const point of points) {
      tiles.add(tileKey(point, level))
      if (tiles.size > maxTiles) break
    }
    if (tiles.size <= maxTiles) return level
  }
  return null
}

// Measured tiles, most recently used last. A tile is about 80 kB of sums.
const measured = new Map<string, Promise<GroundTile | null>>()

function measuredTile(url: string, pixelMeters: number, load: TileLoader) {
  const measure = () => load(url).then((pixels) => (pixels ? measureTile(pixels, pixelMeters) : null))
  // Only the real loader is cached, so tests with fake tiles stay separate.
  if (load !== fetchTile) return measure()
  const hit = measured.get(url)
  if (hit) {
    measured.delete(url)
    measured.set(url, hit)
    return hit
  }
  const promise = measure().then((tile) => {
    // A failed tile stays out of the cache so the next request retries it.
    if (!tile && measured.get(url) === promise) measured.delete(url)
    return tile
  })
  measured.set(url, promise)
  if (measured.size > 512) measured.delete(measured.keys().next().value as string)
  return promise
}

/**
 * The ground at each point. Null where no HiRISE mosaic covers the point,
 * where its tile is missing, or where the points span too many tiles to
 * read at GROUND_MIN_LEVEL.
 */
export async function sampleGround(points: LatLon[], options: { radius?: number, load?: TileLoader, maxTiles?: number, signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted()
  const load = options.load ?? fetchTile
  const result: (Ground | null)[] = points.map(() => null)
  const byMosaic = new Map<Mosaic, number[]>()
  points.forEach((point, index) => {
    const mosaic = mosaicAt(point)
    if (!mosaic) return
    const indices = byMosaic.get(mosaic)
    if (indices) indices.push(index)
    else byMosaic.set(mosaic, [index])
  })
  await Promise.all([...byMosaic].map(async ([mosaic, indices]) => {
    const level = groundLevel(indices.map((i) => points[i]), mosaic.maxLevel, options.maxTiles)
    if (level === null) return
    // One tile spans 180° / 2^level of latitude. Pixels are narrower east
    // to west by the cosine of latitude, under 5% at the four sites.
    const pixelMeters = (Math.PI * MARS_RADIUS) / 2 ** level / TILE_SIZE
    const groups = new Map<string, { index: number, px: number, py: number }[]>()
    for (const index of indices) {
      const { x, y, px, py } = tileFor(points[index], level, TILE_SIZE)
      const url = hiriseTileUrl(mosaic.id).replace('{z}', String(level)).replace('{y}', String(y)).replace('{x}', String(x))
      const group = groups.get(url)
      if (group) group.push({ index, px, py })
      else groups.set(url, [{ index, px, py }])
    }
    await Promise.all([...groups].map(async ([url, group]) => {
      const tile = await measuredTile(url, pixelMeters, load)
      options.signal?.throwIfAborted()
      if (!tile) return
      for (const { index, px, py } of group) result[index] = groundAt(tile, px, py, options.radius)
    }))
  }))
  return result
}
