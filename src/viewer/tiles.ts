// Terrain and imagery for the viewer's map, read straight from the tile
// proxy. The editor draws the same tiles with a map library of tens of
// megabytes. This file is what the viewer needs of it.
//
// Coordinates are planetocentric latitude and east longitude in degrees on
// the Mars sphere the tiles use. Longitude may run past 180 here, so a patch
// that crosses the date line stays in one piece. Heights are meters as the
// terrain stores them, DATUM_OFFSET above the areoid.
//
// Both tile sets use one grid: two columns by one row at level 0, each tile
// 180 / 2^level degrees wide and high. Rows count from the north, as imagery
// files do. Terrain files count from the south.

import { CTX_LATITUDE_LIMIT, CTX_MAX_LEVEL, ctxTileUrl } from '../data/ctx.js'
import { MARS_RADIUS } from '../data/geo'
import { HIRISE_LAYERS, hiriseTileUrl } from '../data/imagery.js'
import { DATUM_OFFSET, TERRAIN_API_PATH } from '../data/terrain-source.js'

export const METERS_PER_DEGREE = (MARS_RADIUS * Math.PI) / 180
// The finest level drawn. A tile is about 165 m across there, and each of its
// mesh cells about 5 m, the detail of the best terrain around the rovers.
export const MAX_LEVEL = 16
// Mesh cells along one side of a drawn tile.
export const CELLS = 32

// Height samples along one side of a decoded terrain tile.
const GRID = 65
const QUANTIZED_MAX = 32767
const MAX_IMAGES = 64
const MAX_GRIDS = 320

const tileKey = (z: number, x: number, y: number) => (z * 2 ** 18 + x) * 2 ** 17 + y

// A quantized-mesh terrain tile as a square grid of heights, row 0 at the
// south edge. The format is Cesium's quantized-mesh-1.0: an 88 byte header,
// three delta-coded vertex columns, then triangles.
export function decodeTerrain(buffer: ArrayBuffer): Float32Array {
  const fail = () => new Error('terrain tile is damaged')
  if (buffer.byteLength < 96) throw fail()
  const view = new DataView(buffer)
  const min = view.getFloat32(24, true)
  const span = view.getFloat32(28, true) - min
  const count = view.getUint32(88, true)
  let at = 92
  if (count === 0 || at + count * 6 + 4 > buffer.byteLength) throw fail()
  const column = (scale: number, base: number) => {
    const out = new Float32Array(count)
    let value = 0
    for (let i = 0; i < count; i++, at += 2) {
      const coded = view.getUint16(at, true)
      value += (coded >> 1) ^ -(coded & 1)
      out[i] = base + value * scale
    }
    return out
  }
  const xs = column((GRID - 1) / QUANTIZED_MAX, 0)
  const ys = column((GRID - 1) / QUANTIZED_MAX, 0)
  const hs = column(span / QUANTIZED_MAX, min)

  const wide = count > 65536
  const bytes = wide ? 4 : 2
  at = Math.ceil(at / bytes) * bytes
  const triangles = view.getUint32(at, true)
  at += 4
  if (at + triangles * 3 * bytes > buffer.byteLength) throw fail()
  let highest = 0
  const next = () => {
    const code = wide ? view.getUint32(at, true) : view.getUint16(at, true)
    at += bytes
    const index = highest - code
    if (code === 0) highest++
    if (index < 0 || index >= count) throw fail()
    return index
  }

  const grid = new Float32Array(GRID * GRID).fill(NaN)
  for (let t = 0; t < triangles; t++) {
    const a = next()
    const b = next()
    const c = next()
    const det = (ys[b] - ys[c]) * (xs[a] - xs[c]) + (xs[c] - xs[b]) * (ys[a] - ys[c])
    if (det === 0) continue
    const x1 = Math.min(GRID - 1, Math.floor(Math.max(xs[a], xs[b], xs[c]) + 1e-3))
    const y1 = Math.min(GRID - 1, Math.floor(Math.max(ys[a], ys[b], ys[c]) + 1e-3))
    for (let y = Math.max(0, Math.ceil(Math.min(ys[a], ys[b], ys[c]) - 1e-3)); y <= y1; y++) {
      for (let x = Math.max(0, Math.ceil(Math.min(xs[a], xs[b], xs[c]) - 1e-3)); x <= x1; x++) {
        const wa = ((ys[b] - ys[c]) * (x - xs[c]) + (xs[c] - xs[b]) * (y - ys[c])) / det
        const wb = ((ys[c] - ys[a]) * (x - xs[c]) + (xs[a] - xs[c]) * (y - ys[c])) / det
        const wc = 1 - wa - wb
        if (wa >= -1e-3 && wb >= -1e-3 && wc >= -1e-3) grid[y * GRID + x] = wa * hs[a] + wb * hs[b] + wc * hs[c]
      }
    }
  }

  // A node no triangle covered takes the mean of its neighbours.
  for (let holes = true, pass = 0; holes && pass < GRID; pass++) {
    holes = false
    for (let i = 0; i < grid.length; i++) {
      if (!Number.isNaN(grid[i])) continue
      const x = i % GRID
      let sum = 0
      let known = 0
      for (const j of [x > 0 ? i - 1 : -1, x < GRID - 1 ? i + 1 : -1, i - GRID, i + GRID]) {
        if (j >= 0 && j < grid.length && !Number.isNaN(grid[j])) {
          sum += grid[j]
          known++
        }
      }
      if (known > 0) grid[i] = sum / known
      else holes = true
    }
  }
  if (Number.isNaN(grid[0])) throw fail()
  return grid
}

// Height at a place in a tile: u from the west edge, v from the south, 0 to 1.
export function sampleGrid(grid: Float32Array, u: number, v: number): number {
  const x = Math.min(Math.max(u, 0), 1) * (GRID - 1)
  const y = Math.min(Math.max(v, 0), 1) * (GRID - 1)
  const x0 = Math.min(Math.floor(x), GRID - 2)
  const y0 = Math.min(Math.floor(y), GRID - 2)
  const tx = x - x0
  const ty = y - y0
  const i = y0 * GRID + x0
  return (grid[i] * (1 - tx) + grid[i + 1] * tx) * (1 - ty) + (grid[i + GRID] * (1 - tx) + grid[i + GRID + 1] * tx) * ty
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

// One square of ground as it is drawn.
export interface RenderTile {
  // West and north edges and the side, degrees.
  west: number
  north: number
  size: number
  // (CELLS + 1) squared heights, row 0 at the south edge.
  heights: Float32Array
  // Null where there is no imagery to show.
  image: HTMLImageElement | null
  // The picture has not arrived. The tile is not drawn until it does, so
  // the coarser ground under it keeps showing.
  waiting: boolean
  // The part of the image this tile shows: left, top and side, 0 to 1.
  // Past the imagery's finest level a tile shows part of a coarser image.
  crop: [left: number, top: number, side: number]
}

// The tiles covering one area at one level. A patch is handed over once its
// terrain is in. Its pictures follow one by one.
export interface Patch {
  id: string
  level: number
  tiles: RenderTile[]
  // Settles when every picture has arrived or failed.
  pictures: Promise<void>
  // What failed to load. The ground still draws, flat or without a picture.
  imageryMissing: boolean
  terrainMissing: boolean
  // What the patch keeps in the caches.
  grids: number[]
}

interface Range {
  startX: number
  endX: number
  startY: number
  endY: number
}

// The tile columns and rows that cover the bounds at a level.
function span(bounds: Bounds, level: number) {
  const size = 180 / 2 ** level
  const rows = 2 ** level
  const x0 = Math.floor((bounds.west + 180) / size)
  const y0 = Math.max(0, Math.floor((90 - bounds.north) / size))
  return {
    size,
    rows,
    x0,
    // Never more than once around the planet.
    x1: Math.min(Math.max(x0, Math.ceil((bounds.east + 180) / size) - 1), x0 + rows * 2 - 1),
    y0,
    y1: Math.min(rows - 1, Math.max(y0, Math.ceil((90 - bounds.south) / size) - 1)),
  }
}

// Names the tile set, so the map can tell when a move needs a new one.
export function patchId(bounds: Bounds, level: number): string {
  const { x0, x1, y0, y1 } = span(bounds, level)
  return `${level}/${x0}-${x1}/${y0}-${y1}`
}

export interface TileSource {
  // Raw terrain height at a point from the finest tile loaded there, or null.
  heightAt(lat: number, lon: number): number | null
  // `onPicture` is called as each picture arrives.
  loadPatch(bounds: Bounds, level: number, onPicture?: () => void): Promise<Patch>
  // Drops what the given patches no longer need, oldest first.
  trim(patches: Patch[]): void
}

// `fetchBytes` and `loadImage` are parameters so the tests can run without a
// network or a browser. `onEvict` hears of each image dropped from the cache.
export function createTileSource(
  onEvict: (image: HTMLImageElement) => void = () => {},
  fetchBytes: (url: string) => Promise<ArrayBuffer> = async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`terrain answered ${response.status}`)
    return response.arrayBuffer()
  },
  loadImage: (url: string) => Promise<HTMLImageElement> = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('imagery tile failed'))
      image.src = url
    }),
): TileSource {
  const grids = new Map<number, Float32Array>()
  const loadingGrids = new Map<number, Promise<void>>()
  const images = new Map<string, HTMLImageElement>()
  const loadingImages = new Map<string, Promise<HTMLImageElement>>()
  // How many grids are loaded at each level, to bound the search in heightAt.
  const loaded: number[] = []
  let ranges: Promise<Range[][]> | null = null
  // Mean height of the last patch that had terrain. Ground with none is
  // drawn level at this height.
  let typical = DATUM_OFFSET

  // Which terrain tiles exist. Levels 0 to 9 cover the planet. Deeper ones
  // exist only where an elevation model was mapped.
  const availability = () =>
    (ranges ??= fetchBytes(`${TERRAIN_API_PATH}/layer.json`)
      .then((bytes) => {
        const { available } = JSON.parse(new TextDecoder().decode(bytes)) as { available?: Range[][] }
        if (!Array.isArray(available)) throw new Error('terrain metadata has no availability')
        return available
      })
      .catch((error: unknown) => {
        ranges = null
        throw error
      }))

  // `only` limits the search to some terrain tiles.
  function heightAt(lat: number, lon: number, only?: Set<number>): number | null {
    const fx = ((((lon + 180) % 360) + 360) % 360) / 180
    const fy = (90 - lat) / 180
    if (!(fy >= 0 && fy <= 1)) return null
    for (let z = loaded.length - 1; z >= 0; z--) {
      if (!loaded[z]) continue
      const rows = 2 ** z
      const cx = fx * rows
      const cy = Math.min(fy * rows, rows - 1e-9)
      const x = Math.floor(cx)
      const y = Math.floor(cy)
      const key = tileKey(z, x, y)
      const grid = only && !only.has(key) ? undefined : grids.get(key)
      if (grid) return sampleGrid(grid, cx - x, 1 - (cy - y))
    }
    return null
  }

  // Loads the finest terrain tile that exists over a drawn tile, and returns
  // its cache key.
  async function terrainOver(z: number, x: number, y: number): Promise<number> {
    const available = await availability()
    for (let level = Math.min(z, available.length - 1); level >= 0; level--) {
      const tx = Math.floor(x / 2 ** (z - level))
      const ty = Math.floor(y / 2 ** (z - level))
      const south = 2 ** level - 1 - ty
      const exists = available[level]?.some(
        (r) => tx >= r.startX && tx <= r.endX && south >= r.startY && south <= r.endY,
      )
      if (!exists) continue
      const key = tileKey(level, tx, ty)
      if (grids.has(key)) return key
      let job = loadingGrids.get(key)
      if (!job) {
        job = fetchBytes(`${TERRAIN_API_PATH}/${level}/${tx}/${south}.terrain`)
          .then((bytes) => {
            grids.set(key, decodeTerrain(bytes))
            loaded[level] = (loaded[level] ?? 0) + 1
          })
          .finally(() => loadingGrids.delete(key))
        loadingGrids.set(key, job)
      }
      await job
      return key
    }
    throw new Error('no terrain here')
  }

  function imagery(url: string): Promise<HTMLImageElement> {
    const hit = images.get(url)
    if (hit) return Promise.resolve(hit)
    let job = loadingImages.get(url)
    if (!job) {
      job = loadImage(url)
        .then((image) => {
          images.set(url, image)
          return image
        })
        .finally(() => loadingImages.delete(url))
      loadingImages.set(url, job)
    }
    return job
  }

  async function loadPatch(bounds: Bounds, level: number, onPicture: () => void = () => {}): Promise<Patch> {
    const { size, rows, x0, x1, y0, y1 } = span(bounds, level)
    const cols = rows * 2
    const patch: Patch = { id: patchId(bounds, level), level, tiles: [], pictures: Promise.resolve(), imageryMissing: false, terrainMissing: false, grids: [] }
    const terrain: Promise<void>[] = []
    const pictures: Promise<void>[] = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const column = ((x % cols) + cols) % cols
        const tile: RenderTile = { west: x * size - 180, north: 90 - y * size, size, heights: new Float32Array((CELLS + 1) ** 2), image: null, waiting: false, crop: [0, 0, 1] }
        patch.tiles.push(tile)
        terrain.push(
          terrainOver(level, column, y).then(
            (key) => void patch.grids.push(key),
            () => void (patch.terrainMissing = true),
          ),
        )
        // The mosaic stops short of the poles. That is no failure.
        if (Math.abs(tile.north - size / 2) > CTX_LATITUDE_LIMIT) continue
        // Past the CTX mosaic's finest level, a tile wholly inside a HiRISE
        // mosaic shows that. Where HiRISE has no tile, CTX stays.
        const west = column * size - 180
        const hirise =
          level > CTX_MAX_LEVEL &&
          HIRISE_LAYERS.find(({ bounds: [w, s, e, n] }) => west >= w && west + size <= e && tile.north - size >= s && tile.north <= n)
        const sources: Array<[finest: number, url: (z: number, row: number, col: number) => string]> = [[CTX_MAX_LEVEL, ctxTileUrl]]
        if (hirise) {
          const template = hiriseTileUrl(hirise.id)
          sources.unshift([hirise.maxLevel, (z, row, col) => template.replace('{z}', String(z)).replace('{y}', String(row)).replace('{x}', String(col))])
        }
        tile.waiting = true
        pictures.push(
          (async () => {
            for (const [finest, url] of sources) {
              const zoom = 2 ** Math.max(0, level - finest)
              try {
                tile.image = await imagery(url(Math.min(level, finest), Math.floor(y / zoom), Math.floor(column / zoom)))
                tile.crop = [(column % zoom) / zoom, (y % zoom) / zoom, 1 / zoom]
                return
              } catch {
                // The next source may have this ground.
              }
            }
            patch.imageryMissing = true
          })().finally(() => {
            tile.waiting = false
            onPicture()
          }),
        )
      }
    }
    patch.pictures = Promise.all(pictures).then(() => {})
    await Promise.all(terrain)

    // Every terrain tile is in before any height is read. Two drawn tiles
    // then get the same height along the edge they share, and no gap shows.
    // Only this patch's terrain is read: coarser terrain left from another
    // patch can sit hundreds of meters off where two elevation models meet.
    const own = new Set(patch.grids)
    const step = size / CELLS
    let sum = 0
    let known = 0
    patch.tiles.forEach((tile, n) => {
      const x = x0 + (n % (x1 - x0 + 1))
      const y = y0 + Math.floor(n / (x1 - x0 + 1))
      for (let j = 0; j <= CELLS; j++) {
        for (let i = 0; i <= CELLS; i++) {
          const lon = (x * CELLS + i) * step - 180
          const lat = 90 - (y * CELLS + CELLS - j) * step
          // A point on the patch's east or south edge belongs to a tile that
          // is not loaded. Step back inside for it.
          const height = heightAt(lat, lon, own) ?? heightAt(lat + step * 1e-3, lon - step * 1e-3, own) ?? NaN
          tile.heights[j * (CELLS + 1) + i] = height
          if (!Number.isNaN(height)) {
            sum += height
            known++
          }
        }
      }
    })
    if (known > 0) typical = sum / known
    for (const tile of patch.tiles) {
      for (let i = 0; i < tile.heights.length; i++) if (Number.isNaN(tile.heights[i])) tile.heights[i] = typical
    }
    return patch
  }

  function trim(patches: Patch[]) {
    const keptGrids = new Set(patches.flatMap((patch) => patch.grids))
    for (const key of grids.keys()) {
      if (grids.size <= MAX_GRIDS) break
      if (keptGrids.has(key)) continue
      grids.delete(key)
      loaded[Math.floor(key / 2 ** 35)]--
    }
    const keptImages = new Set(patches.flatMap((patch) => patch.tiles.map((tile) => tile.image)))
    for (const [url, image] of images) {
      if (images.size <= MAX_IMAGES) break
      if (keptImages.has(image)) continue
      images.delete(url)
      onEvict(image)
    }
  }

  return { heightAt, loadPatch, trim }
}
